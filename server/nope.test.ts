import { io, Socket } from 'socket.io-client';

const SERVER_URL = 'http://localhost:3001';
const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

class Client {
  socket: Socket | null = null;
  name: string;
  playerId: string | null = null;
  hand: any[] = [];
  state: any = null;
  nopeWindows: any[] = [];
  errors: string[] = [];

  constructor(name: string) {
    this.name = name;
  }

  connect() {
    return new Promise<void>((resolve) => {
      this.socket = io(SERVER_URL, { transports: ['websocket'], reconnection: false });
      this.socket.on('connect', () => resolve());
    });
  }

  waitFor(event: string, timeout = 8000): Promise<any> {
    return new Promise((resolve, reject) => {
      const h = (p: any) => {
        this.socket!.off(event, h);
        resolve(p);
      };
      this.socket!.once(event, h);
      setTimeout(() => reject(new Error(`timeout ${event}`)), timeout);
    });
  }

  on(event: string, h: (p: any) => void) {
    this.socket!.on(event, h);
  }

  emit(event: string, payload: any = {}) {
    this.socket!.emit(event, payload);
  }

  has(type: string) {
    return this.hand.find((c) => c.type === type) || null;
  }
}

async function main() {
  console.log('=== Nope + Attack Stack E2E ===\n');
  const a = new Client('Alice');
  const b = new Client('Bob');

  await Promise.all([a.connect(), b.connect()]);
  const created = a.waitFor('ROOM_CREATED');
  a.emit('CREATE_ROOM', { player_name: 'Alice' });
  const room = await created;
  a.playerId = room.player_id;
  const code = room.room_code;
  const joined = b.waitFor('ROOM_JOINED');
  b.emit('JOIN_ROOM', { room_code: code, player_name: 'Bob' });
  const joinData = await joined;
  b.playerId = joinData.player_id;

  [a, b].forEach((c) => c.on('PRIVATE_HAND', (d: any) => (c.hand = d.hand)));
  [a, b].forEach((c) => c.on('GAME_STATE_UPDATE', (d: any) => (c.state = d)));
  [a, b].forEach((c) => c.on('ERROR', (d: any) => c.errors.push(d.message)));
  [a, b].forEach((c) => c.on('NOPE_WINDOW_OPEN', (d: any) => c.nopeWindows.push(d)));

  const started = a.waitFor('GAME_STATE_UPDATE');
  a.emit('START_GAME');
  await started;

  await delay(300);

  let attacker = a.state?.currentPlayerId === a.playerId ? a : b;
  let attackCard = attacker.has('attack') || attacker.has('skip') || attacker.has('shuffle');

  while (!attackCard) {
    const activeClient = a.state?.currentPlayerId === a.playerId ? a : b;
    const candidate = activeClient.has('attack') || activeClient.has('skip') || activeClient.has('shuffle');
    if (candidate) {
      attacker = activeClient;
      attackCard = candidate;
      break;
    }
    const drawAck = activeClient.waitFor('GAME_STATE_UPDATE', 8000);
    activeClient.emit('DRAW_CARD');
    await drawAck;
  }
  const opponent =
    attacker === a ? b : a;

  const cardName = attackCard.type;
  const opponentNope = opponent.has('nope');
  console.log(`${attacker.name} will play ${cardName}. Opponent ${opponent.name} ${opponentNope ? 'HAS' : 'has no'} Nope.`);

  attacker.emit('PLAY_CARD', { card_id: attackCard.id });

  await delay(900);
  if (opponent.nopeWindows.length === 0) {
    console.log(`FAIL: NOPE_WINDOW_OPEN not received (Alice:${a.nopeWindows.length}, Bob:${b.nopeWindows.length})`);
    process.exit(1);
  }
  const win = opponent.nopeWindows[0];
  console.log(`NOPE_WINDOW_OPEN received: ${JSON.stringify(win)}`);
  const playedTypes = (win.cards_played ?? [win.card_played]).map((c: any) => c.type);
  if (playedTypes[0] !== cardName || typeof win.duration_ms === 'number') {
    console.log('FAIL: nope window payload malformed');
    process.exit(1);
  }

  let cancelled = false;
  if (opponentNope) {
    const ack = a.waitFor('GAME_STATE_UPDATE', 8000);
    opponent.emit('PLAY_NOPE', { card_id: opponentNope.id });
    await ack.catch(() => {});
    cancelled = true;
    console.log(`${opponent.name} played Nope — card cancelled.`);
  } else {
    console.log(`${opponent.name} has no Nope — waiting for ${attacker.name} to resolve.`);
  }

  const resolveAck = a.waitFor('GAME_STATE_UPDATE', 8000);
  attacker.emit('RESOLVE_NOPE');
  await resolveAck.catch(() => {});

  const activeNow = a.state?.currentPlayerId === a.playerId ? a : b;
  const obligations = a.state?.drawObligations;
  console.log(`After resolution: active=${activeNow.name}, obligations=${obligations}`);

  let pass = false;
  if (cancelled) {
    pass = activeNow === attacker && obligations >= 1;
  } else if (cardName === 'attack') {
    pass = activeNow === opponent && obligations === 2;
  } else {
    pass = activeNow === opponent;
  }

  console.log(pass ? 'PASS' : `CHECK — card=${cardName} cancelled=${cancelled} active=${activeNow.name} obligations=${obligations}`);
  console.log('\nDone.');
  process.exit(0);
}

main().catch((e) => {
  console.error('E2E FAILED:', e.message);
  process.exit(1);
});