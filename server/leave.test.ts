import { io, Socket } from 'socket.io-client';

const SERVER_URL = process.env.SERVER_URL || 'http://localhost:3001';
const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

class TC {
  socket: Socket;
  name: string;
  playerId: string | null = null;
  roomCode: string | null = null;
  hand: any[] = [];
  gameState: any = null;
  left = false;

  constructor(name: string) {
    this.name = name;
    this.socket = io(SERVER_URL, { transports: ['websocket'], reconnection: false });
    this.socket.on('GAME_STATE_UPDATE', (d: any) => (this.gameState = d));
    this.socket.on('PRIVATE_HAND', (d: any) => (this.hand = d.hand));
    this.socket.on('LEFT_ROOM', () => (this.left = true));
  }

  waitFor(event: string): Promise<any> {
    return new Promise((resolve, reject) => {
      this.socket.once(event, resolve);
      setTimeout(() => reject(new Error(`[${this.name}] timeout ${event}`)), 6000);
    });
  }
}

async function main() {
  const alice = new TC('Alice');
  const bob = new TC('Bob');
  await Promise.all([
    new Promise<void>((r) => alice.socket.on('connect', () => r())),
    new Promise<void>((r) => bob.socket.on('connect', () => r())),
  ]);

  const created = alice.waitFor('ROOM_CREATED');
  alice.socket.emit('CREATE_ROOM', { player_name: 'Alice' });
  const c = await created;
  alice.playerId = c.player_id;
  alice.roomCode = c.room_code;

  const joined = bob.waitFor('ROOM_JOINED');
  bob.socket.emit('JOIN_ROOM', { room_code: c.room_code, player_name: 'Bob' });
  const j = await joined;
  bob.playerId = j.player_id;

  const start = alice.waitFor('GAME_STATE_UPDATE');
  alice.socket.emit('START_GAME');
  await start;
  await delay(300);

  const aliceTurn = alice.gameState?.currentPlayerId === alice.playerId;
  console.log(`Game started. current=${alice.gameState?.currentPlayerId} aliceIsCurrent=${aliceTurn}`);
  const starter = aliceTurn ? alice : bob;
  const other = aliceTurn ? bob : alice;

  const beforeCount = alice.gameState?.players.length;
  const leftOk = starter.waitFor('LEFT_ROOM');
  starter.socket.emit('LEAVE_ROOM');
  const lr = await leftOk;
  if (lr.room_code !== starter.roomCode) throw new Error('Bad LEFT_ROOM payload');
  await delay(400);

  const remaining = starter.gameState?.players?.length ?? null;
  const starterInOtherView = other.gameState?.players?.find((p: any) => p.id === starter.playerId);
  const stateAfter = other.gameState?.players?.map((p: any) => `${p.name}:${p.alive ? 'alive' : 'out'}`).join(', ') ?? 'none';

  console.log(`Starter left. players before=${beforeCount}, after on their stale state=${remaining}`);
  console.log(`Other's view: ${stateAfter} | starterAlive=${starterInOtherView?.alive} | otherHasHand=${other.hand.length}`);
  console.log(`Other current=${other.gameState?.currentPlayerId === other.playerId} obligations=${other.gameState?.drawObligations}`);

  if (!starterInOtherView) throw new Error('Bug: leaver disappeared from game state');
  if (starterInOtherView.alive) throw new Error('Bug: leaver still alive in other state');
  if (other.hand.length !== 8) throw new Error('Bug: other hand changed unexpectedly');
  if (other.gameState?.currentPlayerId !== other.playerId)
    throw new Error('Bug: turn did not advance to remaining player');

  const topDeck = other.gameState?.drawObligations;
  other.socket.emit('DRAW_CARD');
  await delay(300);
  if (other.gameState?.drawObligations !== topDeck - 1) {
    console.log(`    Other drew; obligations ${topDeck} -> ${other.gameState?.drawObligations}`);
  }

  console.log('\nLEAVE TEST PASSED.');
  process.exit(0);
}

main().catch((e) => {
  console.error('\nLEAVE TEST FAILED:', e.message);
  process.exit(1);
});