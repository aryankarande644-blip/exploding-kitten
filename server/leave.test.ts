import { io, Socket } from 'socket.io-client';

const SERVER_URL = process.env.SERVER_URL || 'http://localhost:3001';
const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

class TC {
  socket: Socket;
  playerId: string | null = null;
  roomCode: string | null = null;
  hand: any[] = [];
  gameState: any = null;
  left = false;

  constructor(name: string) {
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
  await Promise.all([new Promise((r) => alice.socket.on('connect', r)), new Promise((r) => bob.socket.on('connect', r))]);

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
  if (!aliceTurn) throw new Error('Alice should start');

  const beforeCount = alice.gameState?.players.length;
  const leftOk = alice.waitFor('LEFT_ROOM');
  alice.socket.emit('LEAVE_ROOM');
  const lr = await leftOk;
  if (lr.room_code !== alice.roomCode) throw new Error('Bad LEFT_ROOM payload');
  await delay(400);

  const remaining = alice.gameState?.players?.length ?? null;
  const aliceInBobView = bob.gameState?.players?.find((p: any) => p.id === alice.playerId);
  const stateAfter = bob.gameState?.players?.map((p: any) => `${p.name}:${p.alive ? 'alive' : 'out'}`).join(', ') ?? 'none';

  console.log(`Alice left. players before=${beforeCount}, after on her stale state=${remaining}`);
  console.log(`Bob's view: ${stateAfter} | aliceAlive=${aliceInBobView?.alive} | bobHasHand=${bob.hand.length}`);
  console.log(`Bob current=${bob.gameState?.currentPlayerId === bob.playerId} obligations=${bob.gameState?.drawObligations}`);

  if (!aliceInBobView) throw new Error('Bug: Alice disappeared from game state');
  if (aliceInBobView.alive) throw new Error('Bug: Alice still alive in Bob state');
  if (bob.hand.length !== 8) throw new Error('Bug: Bob hand changed unexpectedly');

  const topDeck = bob.gameState?.drawObligations;
  bob.socket.emit('DRAW_CARD');
  await delay(300);
  if (bob.gameState?.drawObligations !== topDeck - 1) {
    console.log(`    Bob drew; obligations ${topDeck} -> ${bob.gameState?.drawObligations}`);
  }

  console.log('\nLEAVE TEST PASSED.');
  process.exit(0);
}

main().catch((e) => {
  console.error('\nLEAVE TEST FAILED:', e.message);
  process.exit(1);
});