import crypto from 'node:crypto';
import { GameState, Card } from '../engine/index.ts';
import { setup } from '../engine/index.ts';

export interface PlayerInfo {
  socketId: string;
  name: string;
}

export interface RoomState {
  code: string;
  gameState: GameState | null;
  players: Map<string, PlayerInfo>;
  hostId: string;
  pendingFavor: { targetPlayerId: string; sourcePlayerId: string } | null;
  pendingDefuse: { playerId: string; kitten: Card } | null;
  nopeTimer: ReturnType<typeof setTimeout> | null;
  nopePassed: Set<string>;
  nopeWindowDeadline: number | null;
}

const rooms = new Map<string, RoomState>();

const ROOM_CODE_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

export function generateRoomCode(): string {
  let code: string;
  do {
    code = '';
    for (let i = 0; i < 4; i++) {
      code += ROOM_CODE_CHARS[Math.floor(Math.random() * ROOM_CODE_CHARS.length)];
    }
  } while (rooms.has(code));
  return code;
}

export function createRoom(
  hostId: string,
  hostName: string,
  hostSocketId: string
): { roomCode: string; room: RoomState } {
  const roomCode = generateRoomCode();
  const room: RoomState = {
    code: roomCode,
    gameState: null,
    players: new Map([[hostId, { socketId: hostSocketId, name: hostName }]]),
    hostId,
    pendingFavor: null,
    pendingDefuse: null,
    nopeTimer: null,
    nopePassed: new Set<string>(),
    nopeWindowDeadline: null,
  };
  rooms.set(roomCode, room);
  return { roomCode, room };
}

export function getRoom(roomCode: string): RoomState | null {
  return rooms.get(roomCode) ?? null;
}

export function joinRoom(
  roomCode: string,
  playerId: string,
  playerName: string,
  playerSocketId: string
): void {
  const room = rooms.get(roomCode);
  if (!room) throw new Error('Room not found');
  if (room.gameState) throw new Error('Game already in progress');
  if (room.players.size >= 5) throw new Error('Room is full');
  if (room.players.has(playerId)) throw new Error('Already in room');
  room.players.set(playerId, { socketId: playerSocketId, name: playerName });
}

export function startGame(roomCode: string): void {
  const room = rooms.get(roomCode);
  if (!room) throw new Error('Room not found');
  if (room.players.size < 2) throw new Error('Need at least 2 players');
  if (room.gameState) throw new Error('Game already started');

  const playerIds = Array.from(room.players.keys());
  const playerNames = playerIds.map((id) => room.players.get(id)!.name);

  room.gameState = setup(playerIds, playerNames);
}

export function removeRoom(roomCode: string): void {
  rooms.delete(roomCode);
}

export function restoreRoom(roomCode: string, room: RoomState): void {
  rooms.set(roomCode, room);
}

export function findRoomByPlayerId(
  playerId: string
): { roomCode: string; room: RoomState } | null {
  for (const [code, room] of rooms) {
    if (room.players.has(playerId)) {
      return { roomCode: code, room };
    }
  }
  return null;
}

export function getLobbyState(room: RoomState) {
  return {
    players: Array.from(room.players.entries()).map(([id, info]) => ({
      id,
      name: info.name,
    })),
    host_id: room.hostId,
    status: (room.gameState?.status ?? 'waiting') as
      | 'waiting'
      | 'in_progress'
      | 'finished',
  };
}
