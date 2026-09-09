import { Server } from 'socket.io';
import { Card } from '../engine/index.ts';
import { getPlayer } from '../engine/index.ts';
import { RoomState } from './rooms.js';
import { persistRoom } from './db.js';

export function broadcastGameState(io: Server, room: RoomState): void {
  if (!room.gameState) return;

  const state = room.gameState;

  for (const [playerId, info] of room.players) {
    const playerSocket = io.sockets.sockets.get(info.socketId);
    if (!playerSocket) continue;

    const publicState = {
      players: state.players.map((p) => ({
        id: p.id,
        name: p.name,
        alive: p.alive,
        cardCount: p.hand.length,
      })),
      deckCount: state.deck.length,
      discardTop:
        state.discard.length > 0
          ? state.discard[state.discard.length - 1]
          : null,
      discardCount: state.discard.length,
      currentPlayerId: (() => {
        const cur = state.players[state.currentPlayerIndex];
        return cur && cur.alive ? cur.id : null;
      })(),
      drawObligations: state.drawObligations,
      pendingAction: state.pendingAction,
      pendingPrompt: room.pendingFavor
        ? 'favor'
        : room.pendingDefuse
          ? 'defuse'
          : null,
      status: state.status,
      winnerId: state.winnerId,
    };

    playerSocket.emit('GAME_STATE_UPDATE', publicState);

    const player = getPlayer(state, playerId);
    playerSocket.emit('PRIVATE_HAND', { hand: player.hand });
  }

  persistRoom(room.code, room);
}

export function broadcastPublicState(io: Server, room: RoomState): void {
  if (!room.gameState) return;

  const state = room.gameState;
  const publicState = {
    players: state.players.map((p) => ({
      id: p.id,
      name: p.name,
      alive: p.alive,
      cardCount: p.hand.length,
    })),
    deckCount: state.deck.length,
    discardTop:
      state.discard.length > 0
        ? state.discard[state.discard.length - 1]
        : null,
    discardCount: state.discard.length,
    currentPlayerId: (() => {
      const cur = state.players[state.currentPlayerIndex];
      return cur && cur.alive ? cur.id : null;
    })(),
    drawObligations: state.drawObligations,
    pendingAction: state.pendingAction,
    pendingPrompt: room.pendingFavor
      ? 'favor'
      : room.pendingDefuse
        ? 'defuse'
        : null,
    status: state.status,
    winnerId: state.winnerId,
  };

  for (const [, info] of room.players) {
    const playerSocket = io.sockets.sockets.get(info.socketId);
    if (playerSocket) {
      playerSocket.emit('GAME_STATE_UPDATE', publicState);
    }
  }
}

export function sendPrivateHand(
  io: Server,
  room: RoomState,
  playerId: string
): void {
  if (!room.gameState) return;

  const info = room.players.get(playerId);
  if (!info) return;

  const playerSocket = io.sockets.sockets.get(info.socketId);
  if (!playerSocket) return;

  const player = getPlayer(room.gameState, playerId);
  playerSocket.emit('PRIVATE_HAND', { hand: player.hand });
}

export function sendFutureView(
  io: Server,
  room: RoomState,
  playerId: string,
  cards: Card[]
): void {
  const info = room.players.get(playerId);
  if (!info) return;

  const playerSocket = io.sockets.sockets.get(info.socketId);
  if (!playerSocket) return;

  playerSocket.emit('PRIVATE_FUTURE_VIEW', { cards });
}
