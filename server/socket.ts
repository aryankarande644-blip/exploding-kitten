import { Server, Socket } from 'socket.io';
import crypto from 'node:crypto';
import {
  Card,
  CardType,
  playCard,
  drawCard,
  resolvePendingAction,
  playNope,
  handleExplosionWithIndex,
  completeFavor,
  getCurrentPlayer,
  getPlayer,
  checkTurnAdvance,
  eliminate,
  checkWin,
  nextAlivePlayer,
  advanceToPlayer,
} from '../engine/index.ts';
import {
  createRoom,
  getRoom,
  joinRoom,
  startGame,
  removeRoom,
  restoreRoom,
  RoomState,
  getLobbyState,
} from './rooms.js';
import { loadRoom, persistRoom, deleteRoom } from './db.js';
import {
  broadcastGameState,
  broadcastPublicState,
  sendPrivateHand,
  sendFutureView,
} from './broadcast.js';

const NOPE_WINDOW_MS = 18000;
const ACTIVITY_LIMIT = 60;

const CARD_LABELS: Record<string, string> = {
  skip: 'Skip',
  shuffle: 'Shuffle',
  see_future: 'See the Future',
  favor: 'Favor',
  attack: 'Attack',
  nope: 'Nope',
  defuse: 'Defuse',
  exploding_kitten: 'Exploding Kitten',
};

function playerName(room: RoomState, playerId: string | null | undefined): string {
  if (!playerId) return 'Someone';
  return room.players.get(playerId)?.name ?? 'Someone';
}

function logActivity(room: RoomState, text: string): void {
  room.activity.push({ id: crypto.randomUUID(), text, ts: Date.now() });
  if (room.activity.length > ACTIVITY_LIMIT) {
    room.activity.splice(0, room.activity.length - ACTIVITY_LIMIT);
  }
}

function clearNopeTimer(room: RoomState): void {
  if (room.nopeTimer) {
    clearTimeout(room.nopeTimer);
    room.nopeTimer = null;
  }
  room.nopeWindowDeadline = null;
  room.nopePassed.clear();
}

function eligibleNopePlayerIds(room: RoomState): string[] {
  if (!room.gameState || room.gameState.status !== 'in_progress') return [];
  const action = room.gameState.pendingAction;
  if (!action) return [];
  const ids: string[] = [];
  for (const [id, info] of room.players) {
    if (!info.socketId) continue;
    if (id === action.sourcePlayerId) continue;
    const player = getPlayer(room.gameState, id);
    if (!player.alive) continue;
    if (player.hand.some((c) => c.type === 'nope')) ids.push(id);
  }
  return ids;
}

function emitGameOver(io: Server, room: RoomState): void {
  const state = room.gameState;
  if (!state || state.status !== 'finished') return;
  if (!room.gameOverLogged) {
    if (state.winnerId) {
      room.gameOverLogged = true;
      logActivity(room, `🏆 ${playerName(room, state.winnerId)} won the game!`);
    }
  }
  clearNopeTimer(room);
  for (const [, info] of room.players) {
    const s = io.sockets.sockets.get(info.socketId);
    if (s) {
      s.emit('GAME_OVER', {
        winner_id: state.winnerId,
        winner_name: state.winnerId
          ? room.players.get(state.winnerId)?.name ?? null
          : null,
      });
    }
  }
}

function assertNoPendingPrompt(room: RoomState): void {
  if (room.pendingFavor) throw new Error('Waiting for favor response');
  if (room.pendingDefuse) throw new Error('Resolve your pending defuse first');
}

function openNopeWindow(io: Server, room: RoomState): void {
  if (!room.gameState || room.gameState.status !== 'in_progress') return;
  const action = room.gameState.pendingAction;
  if (!action) return;

  clearNopeTimer(room);
  room.nopePassed.clear();

  const eligible = eligibleNopePlayerIds(room);
  if (eligible.length === 0) {
    resolveNopeAction(io, room);
    return;
  }

  const deadline = Date.now() + NOPE_WINDOW_MS;
  room.nopeWindowDeadline = deadline;
  room.nopeTimer = setTimeout(() => {
    room.nopeTimer = null;
    room.nopeWindowDeadline = null;
    resolveNopeAction(io, room);
  }, NOPE_WINDOW_MS);

  const targetPlayerId = action.targetPlayerId ?? null;
  let attackVictimId: string | null = null;
  if (action.cards[0].type === 'attack') {
    const victim = nextAlivePlayer(room.gameState);
    attackVictimId = victim?.id ?? null;
  }
  const actionLabel =
    action.cards.length >= 2
      ? `${action.cards.length}× Cats`
      : (CARD_LABELS[action.cards[0].type] ?? action.cards[0].type);

  for (const [id, info] of room.players) {
    const s = io.sockets.sockets.get(info.socketId);
    if (s) {
      s.emit('NOPE_WINDOW_OPEN', {
        triggering_player: action.sourcePlayerId,
        target_player_id: targetPlayerId,
        attack_victim_id: attackVictimId,
        card_played: action.cards[0],
        cards_played: action.cards,
        action_label: actionLabel,
        nope_stack: [...action.nopeStack],
        is_cancelled: action.nopeStack.length % 2 === 1,
        deadline,
        duration_ms: NOPE_WINDOW_MS,
        eligible_count: eligible.length,
        is_actor: id === action.sourcePlayerId,
        may_pass: eligible.includes(id),
      });
    }
  }
}

function resolveNopeAction(io: Server, room: RoomState): void {
  if (!room.gameState || room.gameState.status !== 'in_progress') return;

  clearNopeTimer(room);

  const action = room.gameState.pendingAction;
  if (!action) return;

  const actionType = action.cards[0].type;
  const sourcePlayerId = action.sourcePlayerId;
  const targetPlayerId = action.targetPlayerId;
  const wasCancelled = action.nopeStack.length % 2 === 1;

  const attackVictim =
    actionType === 'attack' && !wasCancelled
      ? nextAlivePlayer(room.gameState)
      : null;

  const isFavor = actionType === 'favor' && !wasCancelled && targetPlayerId;
  const isSeeFuture = actionType === 'see_future' && !wasCancelled;

  const futureCards = isSeeFuture
    ? room.gameState.deck.slice(0, 3)
    : null;

  resolvePendingAction(room.gameState);

  const sourceName = playerName(room, sourcePlayerId);
  const label = CARD_LABELS[actionType] ?? actionType;

  if (wasCancelled) {
    logActivity(room, `${sourceName}'s ${label} was Noped!`);
  } else {
    switch (actionType) {
      case 'attack':
        logActivity(room, `${sourceName} attacked ${playerName(room, attackVictim?.id)}`);
        break;
      case 'favor':
        logActivity(
          room,
          `${sourceName} demanded a card from ${playerName(room, targetPlayerId)}`
        );
        break;
      case 'see_future':
        logActivity(room, `${sourceName} peeked at the top 3 cards of the deck`);
        break;
      case 'shuffle':
        logActivity(room, `${sourceName} shuffled the deck`);
        break;
      case 'skip':
        logActivity(room, `${sourceName} played Skip`);
        break;
      default:
        if (actionType.startsWith('cat_')) {
          if (action.cards.length === 5) {
            logActivity(room, `${sourceName} used a cat quintuple to steal a discard`);
          } else if (action.cards.length === 3) {
            const named =
              CARD_LABELS[action.namedCardType ?? ''] ??
              action.namedCardType ??
              'card';
            logActivity(
              room,
              `${sourceName} stole a ${named} from ${playerName(room, targetPlayerId)}`
            );
          } else {
            logActivity(
              room,
              `${sourceName} stole a card from ${playerName(room, targetPlayerId)}`
            );
          }
        }
        break;
    }
  }

  if (isSeeFuture && futureCards) {
    sendFutureView(io, room, sourcePlayerId, futureCards);
  }

  if (isFavor && targetPlayerId) {
    room.pendingFavor = { targetPlayerId, sourcePlayerId };
    const targetInfo = room.players.get(targetPlayerId);
    if (targetInfo) {
      const targetSocket = io.sockets.sockets.get(targetInfo.socketId);
      if (targetSocket) {
        const targetPlayer = getPlayer(room.gameState, targetPlayerId);
        targetSocket.emit('FAVOR_REQUEST', {
          cards: targetPlayer.hand,
          source_player_id: sourcePlayerId,
        });
      }
    }
  }

  broadcastGameState(io, room);

  emitGameOver(io, room);
}

export function setupSocketHandlers(io: Server): void {
  const socketToRoom = new Map<string, string>();
  const socketToPlayer = new Map<string, string>();

  function getContext(
    socket: Socket
  ): { room: RoomState; roomCode: string; playerId: string } | null {
    const roomCode = socketToRoom.get(socket.id);
    const playerId = socketToPlayer.get(socket.id);
    if (!roomCode || !playerId) return null;
    const room = getRoom(roomCode);
    if (!room) return null;
    return { room, roomCode, playerId };
  }

  function emitLobby(io: Server, room: RoomState): void {
    const lobby = getLobbyState(room);
    for (const [, info] of room.players) {
      const s = io.sockets.sockets.get(info.socketId);
      if (s) s.emit('LOBBY_UPDATE', lobby);
    }
    persistRoom(room.code, room);
  }

  io.on('connection', (socket: Socket) => {
    socket.on(
      'CREATE_ROOM',
      (data: { player_name: string }) => {
        try {
          if (!data?.player_name?.trim()) {
            throw new Error('Player name required');
          }

          const playerId = crypto.randomUUID();
          const { roomCode, room } = createRoom(
            playerId,
            data.player_name.trim(),
            socket.id
          );

          socketToRoom.set(socket.id, roomCode);
          socketToPlayer.set(socket.id, playerId);
          socket.join(roomCode);

          socket.emit('ROOM_CREATED', {
            room_code: roomCode,
            player_id: playerId,
          });

          socket.emit('ROOM_STATE', {
            room_code: roomCode,
            player_id: playerId,
            ...getLobbyState(room),
          });

          persistRoom(roomCode, room);
        } catch (e: any) {
          socket.emit('ERROR', { message: e.message });
        }
      }
    );

    socket.on(
      'JOIN_ROOM',
      async (data: { room_code: string; player_name: string }) => {
        try {
          if (!data?.room_code || !data?.player_name?.trim()) {
            throw new Error('Room code and player name required');
          }

          const roomCode = data.room_code.toUpperCase();
          const playerId = crypto.randomUUID();

          let room = getRoom(roomCode);
          if (!room) {
            const loaded = await loadRoom(roomCode);
            if (loaded) {
              restoreRoom(roomCode, loaded);
              room = loaded;
            }
          }
          if (!room) throw new Error('Room not found');

          joinRoom(roomCode, playerId, data.player_name.trim(), socket.id);

          socketToRoom.set(socket.id, roomCode);
          socketToPlayer.set(socket.id, playerId);
          socket.join(roomCode);

          socket.emit('ROOM_JOINED', {
            room_code: roomCode,
            player_id: playerId,
          });

          socket.emit('ROOM_STATE', {
            room_code: roomCode,
            player_id: playerId,
            ...getLobbyState(room),
          });

          emitLobby(io, room);
        } catch (e: any) {
          socket.emit('ERROR', { message: e.message });
        }
      }
    );

    socket.on('START_GAME', () => {
      try {
        const ctx = getContext(socket);
        if (!ctx) throw new Error('Not in a room');

        const { room, roomCode, playerId } = ctx;

        if (room.hostId !== playerId) throw new Error('Only host can start');
        if (room.players.size < 2)
          throw new Error('Need at least 2 players');
        if (room.gameState && room.gameState.status !== 'finished')
          throw new Error('Game already started');

        if (room.gameState) {
          clearNopeTimer(room);
          room.pendingFavor = null;
          room.pendingDefuse = null;
          room.gameOverLogged = false;
          room.activity = [];
        }

        startGame(roomCode);

        logActivity(room, 'Game started — good luck, kittens!');
        const firstKey = Array.from(room.players.keys())[0];
        if (firstKey) logActivity(room, `${playerName(room, firstKey)} goes first`);

        broadcastGameState(io, room);
      } catch (e: any) {
        socket.emit('ERROR', { message: e.message });
      }
    });

    socket.on(
      'LEAVE_ROOM',
      () => {
        try {
          const ctx = getContext(socket);
          if (!ctx) return;

          const { room, roomCode, playerId } = ctx;
          const state = room.gameState;
          const inProgress = state?.status === 'in_progress';
          const leaverName = room.players.get(playerId)?.name ?? 'Someone';

          if (inProgress && state!.pendingAction && state!.pendingAction.sourcePlayerId === playerId) {
            resolveNopeAction(io, room);
          }

          const gs = state?.status === 'in_progress' ? state : null;

          if (gs && room.pendingDefuse?.playerId === playerId) {
            const kitten = room.pendingDefuse.kitten;
            room.pendingDefuse = null;
            gs.discard.push(kitten);
            const player = getPlayer(gs, playerId);
            eliminate(gs, player);
            checkWin(gs);
            if (gs.status !== 'finished') {
              advanceToPlayer(gs, nextAlivePlayer(gs), 1);
            }
          }

          if (
            room.pendingFavor &&
            (room.pendingFavor.targetPlayerId === playerId ||
              room.pendingFavor.sourcePlayerId === playerId)
          ) {
            room.pendingFavor = null;
          }
if (gs && gs.status === 'in_progress') {
            const player = getPlayer(gs, playerId);
            if (player.alive) {
              eliminate(gs, player);
              checkWin(gs);
              const isCurrent = gs.players[gs.currentPlayerIndex]?.id === playerId;

              if (isCurrent) {
                advanceToPlayer(gs, nextAlivePlayer(gs), 1);
              }
            }
          }

          if (gs && gs.pendingAction) {
            openNopeWindow(io, room);
          }

          if (room.gameState) {
            logActivity(room, `${leaverName} left the game`);
          }

          room.players.delete(playerId);
          socket.leave(roomCode);
          socketToRoom.delete(socket.id);
          socketToPlayer.delete(socket.id);

          socket.emit('LEFT_ROOM', { room_code: roomCode });

          if (room.players.size === 0) {
            clearNopeTimer(room);
            deleteRoom(roomCode);
            removeRoom(roomCode);
            return;
          }

          if (room.hostId === playerId) {
            room.hostId = Array.from(room.players.keys())[0];
          }

          if (room.gameState) {
            broadcastGameState(io, room);
            emitGameOver(io, room);
          } else {
            emitLobby(io, room);
          }
        } catch (e: any) {
          socket.emit('ERROR', { message: e.message });
        }
      }
    );

    socket.on(
      'PLAY_CARD',
      (data: {
        card_id?: string;
        card_ids?: string[];
        target_player_id?: string;
        named_card_type?: CardType;
      }) => {
        try {
          const ctx = getContext(socket);
          if (!ctx) throw new Error('Not in a room');

          const { room, playerId } = ctx;
          const state = room.gameState;
          if (!state) throw new Error('Game not started');
          if (state.status !== 'in_progress')
            throw new Error('Game not in progress');

          assertNoPendingPrompt(room);

          const player = getPlayer(state, playerId);
          if (!player.alive) throw new Error('Player is eliminated');
          if (getCurrentPlayer(state).id !== playerId)
            throw new Error('Not your turn');
          if (state.pendingAction)
            throw new Error('Cannot play card during nope window');

          const cardIds = data.card_ids ?? (data.card_id ? [data.card_id] : []);
          if (cardIds.length === 0) throw new Error('No card specified');

          const cards: Card[] = [];
          for (const id of cardIds) {
            const card = player.hand.find((c) => c.id === id);
            if (!card) throw new Error(`Card ${id} not in hand`);
            cards.push(card);
          }

          playCard(
            state,
            playerId,
            cards,
            data.target_player_id,
            data.named_card_type
          );

          const sourceName = playerName(room, playerId);
          const targetName = data.target_player_id
            ? playerName(room, data.target_player_id)
            : null;
          if (cards.length === 2) {
            logActivity(
              room,
              targetName
                ? `${sourceName} played 2 cat cards on ${targetName}`
                : `${sourceName} played 2 cat cards`
            );
          } else if (cards.length === 3) {
            logActivity(
              room,
              targetName
                ? `${sourceName} played 3 cat cards on ${targetName}`
                : `${sourceName} played 3 cat cards`
            );
          } else if (cards.length === 5) {
            logActivity(room, `${sourceName} played a cat quintuple`);
          } else {
            const label = CARD_LABELS[cards[0].type] ?? cards[0].type;
            logActivity(
              room,
              targetName
                ? `${sourceName} played ${label} on ${targetName}`
                : `${sourceName} played ${label}`
            );
          }

          broadcastGameState(io, room);

          openNopeWindow(io, room);
        } catch (e: any) {
          socket.emit('ERROR', { message: e.message });
        }
      }
    );

    socket.on('PLAY_NOPE', (data: { card_id: string }) => {
      try {
        const ctx = getContext(socket);
        if (!ctx) throw new Error('Not in a room');

        const { room, playerId } = ctx;
        const state = room.gameState;
        if (!state) throw new Error('Game not started');
        if (!state.pendingAction) throw new Error('No pending action to nope');

        assertNoPendingPrompt(room);

        const player = getPlayer(state, playerId);
        if (!player.alive) throw new Error('Player is eliminated');

        playNope(state, playerId);

        const nopeAction = state.pendingAction;
        const nopedLabel =
          CARD_LABELS[nopeAction.cards[0]?.type] ?? nopeAction.cards[0]?.type ?? 'card';
        logActivity(
          room,
          `${playerName(room, playerId)} played Nope on ${playerName(
            room,
            nopeAction.sourcePlayerId
          )}'s ${nopedLabel}`
        );

        openNopeWindow(io, room);

        broadcastGameState(io, room);
      } catch (e: any) {
        socket.emit('ERROR', { message: e.message });
      }
    });

    socket.on(
      'RESOLVE_NOPE',
      () => {
        try {
          const ctx = getContext(socket);
          if (!ctx) throw new Error('Not in a room');

          const { room, playerId } = ctx;
          const state = room.gameState;
          if (!state) throw new Error('Game not started');
          if (!state.pendingAction) throw new Error('No pending action');

          const action = state.pendingAction;
          if (action.sourcePlayerId !== playerId)
            throw new Error('Only the acting player can resolve');

          if (eligibleNopePlayerIds(room).length > 0)
            throw new Error('Waiting for other players to Nope or pass');

          const player = getPlayer(state, playerId);
          if (!player.alive) throw new Error('Player is eliminated');

          resolveNopeAction(io, room);
        } catch (e: any) {
          socket.emit('ERROR', { message: e.message });
        }
      }
    );

    socket.on('PASS_NOPE', () => {
      try {
        const ctx = getContext(socket);
        if (!ctx) throw new Error('Not in a room');

        const { room, playerId } = ctx;
        const state = room.gameState;
        if (!state) throw new Error('Game not started');
        if (!state.pendingAction) throw new Error('No pending action');

        const player = getPlayer(state, playerId);
        if (!player.alive) throw new Error('Player is eliminated');

        const eligible = eligibleNopePlayerIds(room);
        if (!eligible.includes(playerId))
          throw new Error('You cannot pass on this action');
        if (room.nopePassed.has(playerId))
          throw new Error('Already passed');

        room.nopePassed.add(playerId);

        if (eligible.every((id) => room.nopePassed.has(id))) {
          resolveNopeAction(io, room);
        } else {
          for (const [, info] of room.players) {
            const s = io.sockets.sockets.get(info.socketId);
            if (s) {
              s.emit('NOPE_PASSED', {
                player_id: playerId,
                deadline: room.nopeWindowDeadline,
              });
            }
          }
        }
      } catch (e: any) {
        socket.emit('ERROR', { message: e.message });
      }
    });

    socket.on('SKIP_ACTION_TIMER', () => {
      try {
        const ctx = getContext(socket);
        if (!ctx) throw new Error('Not in a room');

        const { room } = ctx;
        const state = room.gameState;
        if (!state) throw new Error('Game not started');
        if (state.status !== 'in_progress')
          throw new Error('Game not in progress');
        if (!state.pendingAction) throw new Error('No action timer to skip');

        resolveNopeAction(io, room);
      } catch (e: any) {
        socket.emit('ERROR', { message: e.message });
      }
    });

    socket.on('DRAW_CARD', () => {
      try {
        const ctx = getContext(socket);
        if (!ctx) throw new Error('Not in a room');

        const { room, playerId } = ctx;
        const state = room.gameState;
        if (!state) throw new Error('Game not started');
        if (state.status !== 'in_progress')
          throw new Error('Game not in progress');

        assertNoPendingPrompt(room);

        const player = getPlayer(state, playerId);
        if (!player.alive) throw new Error('Player is eliminated');
        if (getCurrentPlayer(state).id !== playerId)
          throw new Error('Not your turn');
        if (state.drawObligations <= 0)
          throw new Error('No draw obligations');
        if (state.pendingAction)
          throw new Error('Cannot draw during nope window');

        if (state.deck.length === 0) {
          state.drawObligations = 0;
          checkTurnAdvance(state);
          broadcastGameState(io, room);
          return;
        }

        const topCard = state.deck[0];

        if (topCard.type === 'exploding_kitten') {
          const kitten = state.deck.shift()!;
          const hasDefuse = player.hand.some((c) => c.type === 'defuse');
          const playerDisplay = playerName(room, playerId);

          if (!hasDefuse) {
            logActivity(
              room,
              `💥 ${playerDisplay} drew an Exploding Kitten and exploded!`
            );
            handleExplosionWithIndex(state, player, kitten, 0);
            broadcastGameState(io, room);

            emitGameOver(io, room);
          } else {
            logActivity(
              room,
              `💥 ${playerDisplay} drew an Exploding Kitten!`
            );
            room.pendingDefuse = { playerId, kitten };
            socket.emit('EXPLODED', {
              card: { id: kitten.id, type: kitten.type },
              deck_size: state.deck.length,
            });
            broadcastGameState(io, room);
          }
        } else {
          logActivity(room, `${playerName(room, playerId)} drew a card`);
          drawCard(state);
          broadcastGameState(io, room);

          emitGameOver(io, room);
        }
      } catch (e: any) {
        socket.emit('ERROR', { message: e.message });
      }
    });

    socket.on('DEFUSE_BOMB', (data: { insert_index: number }) => {
      try {
        const ctx = getContext(socket);
        if (!ctx) throw new Error('Not in a room');

        const { room, playerId } = ctx;
        const state = room.gameState;
        if (!state) throw new Error('Game not started');
        if (!room.pendingDefuse) throw new Error('No pending defuse');
        if (room.pendingDefuse.playerId !== playerId)
          throw new Error('Not your defuse to resolve');

        const { kitten } = room.pendingDefuse;
        const player = getPlayer(state, playerId);

        room.pendingDefuse = null;

        logActivity(room, `🛡️ ${playerName(room, playerId)} defused an Exploding Kitten`);

        const insertIndex = Math.max(
          0,
          Math.min(data.insert_index, state.deck.length)
        );
        handleExplosionWithIndex(state, player, kitten, insertIndex);

        broadcastGameState(io, room);

        emitGameOver(io, room);
      } catch (e: any) {
        socket.emit('ERROR', { message: e.message });
      }
    });

    socket.on('FAVOR_CHOOSE', (data: { card_id: string }) => {
      try {
        const ctx = getContext(socket);
        if (!ctx) throw new Error('Not in a room');

        const { room, playerId } = ctx;
        const state = room.gameState;
        if (!state) throw new Error('Game not started');
        if (!room.pendingFavor) throw new Error('No pending favor');
        if (room.pendingFavor.targetPlayerId !== playerId)
          throw new Error('Not your favor to resolve');

        const { targetPlayerId, sourcePlayerId } = room.pendingFavor;

        room.pendingFavor = null;

        completeFavor(state, targetPlayerId, sourcePlayerId, data.card_id);

        logActivity(
          room,
          `${playerName(room, targetPlayerId)} gave a card to ${playerName(
            room,
            sourcePlayerId
          )}`
        );

        broadcastGameState(io, room);
      } catch (e: any) {
        socket.emit('ERROR', { message: e.message });
      }
    });

    socket.on(
      'RECONNECT',
      async (data: { room_code: string; player_id: string }) => {
        try {
          if (!data?.room_code || !data?.player_id)
            throw new Error('Room code and player ID required');

          const roomCode = data.room_code.toUpperCase();

          let room = getRoom(roomCode);
          if (!room) {
            const loaded = await loadRoom(roomCode);
            if (!loaded) throw new Error('Room not found');
            restoreRoom(roomCode, loaded);
            room = loaded;
          }
          if (!room.players.has(data.player_id))
            throw new Error('Player not in room');

          const oldSocketId = room.players.get(data.player_id)!.socketId;
          socketToRoom.delete(oldSocketId);
          socketToPlayer.delete(oldSocketId);

          room.players.get(data.player_id)!.socketId = socket.id;
          socketToRoom.set(socket.id, roomCode);
          socketToPlayer.set(socket.id, data.player_id);
          socket.join(roomCode);

          socket.emit('ROOM_STATE', {
            room_code: roomCode,
            player_id: data.player_id,
            ...getLobbyState(room),
          });

          if (room.gameState) {
            broadcastGameState(io, room);

            if (
              room.pendingFavor &&
              room.pendingFavor.targetPlayerId === data.player_id
            ) {
              const targetPlayer = getPlayer(
                room.gameState,
                data.player_id
              );
              socket.emit('FAVOR_REQUEST', {
                cards: targetPlayer.hand,
                source_player_id: room.pendingFavor.sourcePlayerId,
              });
            }

            if (
              room.pendingDefuse &&
              room.pendingDefuse.playerId === data.player_id
            ) {
              socket.emit('EXPLODED', {
                card: {
                  id: room.pendingDefuse.kitten.id,
                  type: room.pendingDefuse.kitten.type,
                },
                deck_size: room.gameState.deck.length,
              });
            }

            // Re-open the nope window with a fresh countdown if an action was
            // mid-flight when the server restarted.
            if (room.gameState.pendingAction) {
              openNopeWindow(io, room);
            }
          } else {
            emitLobby(io, room);
          }

          persistRoom(roomCode, room);
        } catch (e: any) {
          socket.emit('ERROR', { message: e.message });
        }
      }
    );

    socket.on('disconnect', () => {
      const playerId = socketToPlayer.get(socket.id);

      socketToRoom.delete(socket.id);
      socketToPlayer.delete(socket.id);
    });
  });
}
