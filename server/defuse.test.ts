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
  errors: string[] = [];
  exploded: any = null;

  constructor(name: string) {
    this.name = name;
    this.socket = io(SERVER_URL, { transports: ['websocket'], reconnection: false });
    this.socket.on('GAME_STATE_UPDATE', (d: any) => (this.gameState = d));
    this.socket.on('PRIVATE_HAND', (d: any) => (this.hand = d.hand));
    this.socket.on('ERROR', (d: any) => this.errors.push(`${this.name}: ${d.message}`));
    this.socket.on('EXPLODED', (d: any) => (this.exploded = d));
  }

  waitFor(event: string): Promise<any> {
    return new Promise((resolve, reject) => {
      this.socket.once(event, resolve);
      setTimeout(() => reject(new Error(`[${this.name}] timeout ${event}`)), 6000);
    });
  }

  emit(event: string, payload: any = {}): void {
    this.socket.emit(event, payload);
  }

  get isCurrent(): boolean {
    return this.gameState?.currentPlayerId === this.playerId;
  }

  get prompt(): string | null {
    return this.gameState?.pendingPrompt ?? null;
  }
}

async function main() {
  console.log('=== DEFUSE FLOW TEST ===\n');

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
  await delay(400);

  if (alice.gameState.status !== 'in_progress') throw new Error('Game did not start');
  console.log('1. Game started. Alice hand:', alice.hand.length, '| Bob hand:', bob.hand.length);

  // Drive the current player to draw until they hit a kitten (all players hold exactly 1 defuse at the start)
  let defuser: TC = alice;
  let draws = 0;
  while (!defuser.exploded && draws < 40) {
    defuser.exploded = null;
    defuser.emit('DRAW_CARD');
    await delay(250);
    draws++;
    if (defuser.exploded) break;
    if (defuser.errors.length) {
      throw new Error(`Unexpected errors while drawing: ${defuser.errors.join('; ')}`);
    }
    const next = [alice, bob].find((c) => c.isCurrent);
    if (!next) throw new Error('No current player after a draw — TURN STATE LOST');
    defuser = next;
  }
  if (!defuser.exploded) throw new Error('Never drew a kitten in 40 draws');

  console.log(`2. ${defuser.name} drew the kitten on draw #${draws}. Exploded payload: ${JSON.stringify(defuser.exploded)}`);
  console.log(`   prompt='${defuser.prompt}' | obligations before resolve=${defuser.gameState.drawObligations}`);
  if (defuser.prompt !== 'defuse') throw new Error('BUG: DEFUSE prompt missing after drawing a kitten');

  const beforeHand = defuser.hand.length;
  const beforeDeck = defuser.gameState.deckCount;
  const defusesBefore = defuser.hand.filter((cd: any) => cd.type === 'defuse').length;
  const defusesAfter = defuser.hand.filter((cd: any) => cd.type === 'defuse').length;
  if (defusesBefore === 0) throw new Error('BUG: defuser has no defuse in hand');
  console.log(`   ${defuser.name} has ${defusesBefore} defuse(s), hand=${beforeHand}, deck=${beforeDeck}`);

  // Resolve: server should clear the prompt, consume the defuse, reinsert the kitten, and advance the turn.
  defuser.emit('DEFUSE_BOMB', { insert_index: Math.floor(beforeDeck / 2) });
  await delay(400);

  const other = defuser === alice ? bob : alice;
  const otherHandBefore = other.hand.length;
  const promptAfter = other.gameState?.pendingPrompt ?? null;
  const obligationsAfter = other.gameState?.drawObligations;
  const currentAfter = other.gameState?.currentPlayerId;
  const defusesConsumed = defusesBefore - defuser.hand.filter((cd: any) => cd.type === 'defuse').length;

  console.log(`3. After DEFUSE_BOMB: prompt='${promptAfter}' | obligations=${obligationsAfter} | current=${currentAfter === other.playerId ? 'other' : currentAfter === defuser.playerId ? 'SAME (BUG)' : '???'}`);
  console.log(`   ${defuser.name} hand ${beforeHand} -> ${defuser.hand.length} (defuse consumed: ${defusesConsumed}) | deck ${beforeDeck} -> ${other.gameState?.deckCount} (kitten reinserted: ${other.gameState?.deckCount !== beforeDeck - 1})`);

  if (promptAfter !== null) throw new Error('BUG: game stuck on DEFUSE prompt');
  if (currentAfter !== other.playerId) throw new Error('BUG: turn did not advance to next player');
  if (obligationsAfter !== 1) throw new Error(`BUG: next obligations should be 1, got ${obligationsAfter}`);
  if (defusesConsumed !== 1) throw new Error(`BUG: exactly one defuse should be consumed, got ${defusesConsumed}`);
  if (other.hand.length !== otherHandBefore) throw new Error(`BUG: other player's hand changed during defuse: ${otherHandBefore} -> ${other.hand.length}`);

  // Game must continue: next player draws without error.
  const errBefore = other.errors.length;
  other.emit('DRAW_CARD');
  await delay(300);
  const newErrs = other.errors.slice(errBefore);
  console.log(`4. Next player drew. obligations now=${other.gameState?.drawObligations} | deck=${other.gameState?.deckCount} | errors=${newErrs.length ? newErrs.join('; ') : 'none'}`);
  if (newErrs.length) throw new Error(`BUG: game cannot continue after defuse: ${newErrs.join('; ')}`);

  console.log('\nDEFUSE FLOW TEST PASSED');
  process.exit(0);
}

main().catch((e) => {
  console.error('\nDEFUSE FLOW TEST FAILED:', e.message);
  process.exit(1);
});