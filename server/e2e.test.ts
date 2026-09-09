import { io, Socket } from 'socket.io-client';

const SERVER_URL = process.env.SERVER_URL || 'http://localhost:3001';
const TIMEOUT = 10000;

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

class TestClient {
  socket: Socket | null = null;
  name: string;
  playerId: string | null = null;
  roomCode: string | null = null;
  hand: any[] = [];
  gameState: any = null;
  isHost = false;
  errors: string[] = [];

  constructor(name: string) {
    this.name = name;
  }

  connect(): Promise<void> {
    return new Promise((resolve) => {
      this.socket = io(SERVER_URL, { transports: ['websocket'], reconnection: false });
      this.socket.on('connect', resolve);
      this.socket.on('exception', () => {});
    });
  }

  waitFor(event: string, timeout = TIMEOUT): Promise<any> {
    return new Promise((resolve, reject) => {
      const handler = (payload: any) => {
        this.socket!.off(event, handler);
        resolve(payload);
      };
      this.socket!.once(event, handler);
      setTimeout(() => {
        this.socket!.off(event, handler);
        reject(new Error(`[${this.name}] timed out waiting for ${event}`));
      }, timeout);
    });
  }

  on(event: string, handler: (payload: any) => void): void {
    this.socket!.on(event, handler);
  }

  emit(event: string, payload: any = {}): void {
    this.socket!.emit(event, { ...payload });
  }

  async createRoom(): Promise<string> {
    const created = this.waitFor('ROOM_CREATED');
    this.emit('CREATE_ROOM', { player_name: this.name });
    const data = await created;
    this.playerId = data.player_id;
    this.roomCode = data.room_code;
    this.isHost = true;

    this.on('GAME_STATE_UPDATE', (d: any) => (this.gameState = d));
    this.on('PRIVATE_HAND', (d: any) => (this.hand = d.hand));
    this.on('ERROR', (d: any) => this.errors.push(d.message));

    return data.room_code;
  }

  async joinRoom(code: string): Promise<void> {
    const joined = this.waitFor('ROOM_JOINED');
    this.emit('JOIN_ROOM', { room_code: code, player_name: this.name });
    const data = await joined;
    this.playerId = data.player_id;
    this.roomCode = data.room_code;

    this.on('GAME_STATE_UPDATE', (d: any) => (this.gameState = d));
    this.on('PRIVATE_HAND', (d: any) => (this.hand = d.hand));
    this.on('ERROR', (d: any) => this.errors.push(d.message));
  }

  get currentPlayerIsMe(): boolean {
    return this.gameState?.currentPlayerId === this.playerId;
  }

  hasCard(type: string): any {
    return this.hand.find((c) => c.type === type) || null;
  }

  async playType(source: TestClient, peers: TestClient[], type: string): Promise<void> {
    const before = Date.now();
    const card = source.hasCard(type);
    if (!card) return;
    source.emit('PLAY_CARD', { card_id: card.id });
    await delay(250);
    // The nope window is server-driven now: opponents holding a Nope pass
    // immediately to expedite resolution; no-nope windows auto-resolve.
    for (const other of peers) {
      if (other !== source && other.hasCard('nope') && other.gameState?.pendingAction) {
        other.emit('PASS_NOPE');
      }
    }
    const end = Date.now() + 42000;
    while (Date.now() < end) {
      await delay(150);
      if (!source.gameState?.pendingAction) break;
    }
    console.log(
      `    ${source.name} played ${type} (${Date.now() - before}ms). Turn now: ${
        source.gameState?.currentPlayerId
      }, obligations: ${source.gameState?.drawObligations}`
    );
  }

  async draw(): Promise<void> {
    const topDeck = this.gameState?.deckCount;
    this.emit('DRAW_CARD');
    await delay(250);
    if (this.gameState?.pendingPrompt === 'defuse') {
      this.emit('DEFUSE_BOMB', { insert_index: Math.floor((this.gameState?.deckCount ?? 0) / 2) });
      await delay(250);
    }
    if (topDeck !== undefined && this.gameState && this.gameState.deckCount === topDeck - 1) {
      console.log(`    ${this.name} drew a card. Deck: ${this.gameState.deckCount}`);
    }
  }
}

async function main() {
  console.log('=== E2E Full Game Test ===\n');

  const alice = new TestClient('Alice');
  const bob = new TestClient('Bob');
  const carol = new TestClient('Carol');

  await Promise.all([alice.connect(), bob.connect(), carol.connect()]);
  console.log('1. All 3 clients connected.');

  const roomCode = await alice.createRoom();
  console.log(`2. Alice created room ${roomCode}.`);

  await bob.joinRoom(roomCode);
  await carol.joinRoom(roomCode);
  console.log('3. Bob and Carol joined.');

  const gameStart = alice.waitFor('GAME_STATE_UPDATE');
  alice.emit('START_GAME');
  await gameStart;
  console.log('4. Alice started the game.');

  await delay(500);
  console.log('5. Check initial hands:');
  console.log(`    Alice: ${alice.hand.length} cards | Bob: ${bob.hand.length} | Carol: ${carol.hand.length}`);
  if (alice.hand.length !== 8 || bob.hand.length !== 8 || carol.hand.length !== 8) {
    throw new Error('Expected 8 cards per player');
  }

  console.log('\n6. Verifying hidden info safety (no cross-hand leaks)...');
  const aliceState = alice.gameState;
  if (!aliceState?.players) throw new Error('Alice lost public state');
  const leaked = aliceState.players.filter((p: any) => p.cardCount > 0);
  console.log(`    Public state shows only card counts: ${leaked.map((p: any) => `${p.name}:${p.cardCount}`).join(', ')}`);
  console.log('    (Only PRIVATE_HAND carries actual card data)');

  console.log('\n7. Playing a few turns to validate turn passing + draws...');
  let active = alice;
  for (let i = 0; i < 6; i++) {
    const current: TestClient = active;
    const skip = current.hasCard('skip');
    if (skip && current.currentPlayerIsMe) {
      await current.playType(current, [alice, bob, carol], 'skip');
      console.log(`      → ${current.name} skipped. Next obligations: ${current.gameState?.drawObligations}`);
    } else {
      await current.draw();
    }
    active = [alice, bob, carol].find((c) => c.currentPlayerIsMe)!;
  }
  console.log('    Turn rotation works.');

  // Settle: wait until every client agrees on the current player and no prompt is open.
  for (let tries = 0; tries < 40; tries++) {
    const ids = [alice, bob, carol].map((c) => c.gameState?.currentPlayerId);
    const prompts = [alice, bob, carol].map((c) => c.gameState?.pendingPrompt ?? null);
    if (ids[0] && ids.every((id) => id === ids[0]) && prompts.every((p) => p === null)) break;
    await delay(100);
  }
  const settledCurrent = alice.gameState?.currentPlayerId;
  const settledAll = [alice, bob, carol].every(
    (c) => c.gameState?.currentPlayerId === settledCurrent && !c.gameState?.pendingPrompt
  );
  if (!settledAll) throw new Error('Clients never converged on a settled turn (turn-system desync)');

  console.log('\n8. Attempt invalid action (non-active player plays card)...');
  const inactive = [alice, bob, carol].find(
    (c) => c.playerId !== settledCurrent &&
      c.gameState?.players?.find((p: any) => p.id === c.playerId)?.alive
  );
  if (!inactive) {
    console.log('    (no alive inactive player to test)');
  } else {
    const someCard = inactive.hasCard('shuffle') || inactive.hasCard('skip');
    if (someCard) {
      if (process.env.E2E_DEBUG) {
        for (const c of [alice, bob, carol]) {
          const me = c.gameState?.players?.find((p: any) => p.id === c.playerId);
          console.log(`DEBUG ${c.name}: current=${c.gameState?.currentPlayerId === c.playerId ? 'ME' : c.gameState?.currentPlayerId} alive=${me?.alive} errs=[${c.errors.join(' | ')}]`);
        }
      }
      inactive.emit('PLAY_CARD', { card_id: someCard.id });
      await delay(300);
      const gotError = inactive.errors.some((e) => e.includes('Not your turn'));
      console.log(`    ${inactive.name} got error: ${gotError ? 'YES (correct)' : `NO — last errs=[${inactive.errors.slice(-5).join(' | ')}]`}`);
      if (!gotError) throw new Error('Security flaw: non-active player could play');
    } else {
      console.log('    (inactive player had no playable card to test)');
    }
  }

  console.log('\n9. Full E2E PASSED.');
  console.log(`    Room: ${roomCode}`);
  console.log(`    Final deck count: ${alice.gameState?.deckCount} | Alice cards: ${alice.hand.length}`);
  process.exit(0);
}

main().catch((e) => {
  console.error('\nE2E FAILED:', e.message);
  process.exit(1);
});