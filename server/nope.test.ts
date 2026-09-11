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

async function setupGame(): Promise<{ a: Client; b: Client; code: string }> {
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
  return { a, b, code };
}

// Returns the player who can play an action card (attack/skip/shuffle) and
// their card, drawing to advance turns until one is found.
async function findActionPlayable(
  a: Client,
  b: Client
): Promise<{ attacker: Client; attackCard: any; opponent: Client }> {
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
  return { attacker, attackCard, opponent: attacker === a ? b : a };
}

async function waitForClear(a: Client, ms: number): Promise<boolean> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (!a.state?.pendingAction) return true;
    await delay(100);
  }
  return !a.state?.pendingAction;
}

async function main() {
  console.log('=== Nope Window E2E (server-timed, no actor race) ===\n');

  // ---- Scenario A: no eligible Nopers → instant resolve, no window ----
  {
    const { a, b } = await setupGame();
    const { attacker, attackCard, opponent } = await findActionPlayable(a, b);
    const opponentNope = opponent.has('nope');
    console.log(`[A] ${attacker.name} will play ${attackCard.type}. Opponent ${opponent.name} ${opponentNope ? 'HAS' : 'has no'} Nope.`);

    const winPromise = Promise.race([
      attacker.waitFor('NOPE_WINDOW_OPEN', 3000),
      delay(1800).then(() => null),
    ]);
    attacker.emit('PLAY_CARD', { card_id: attackCard.id });
    let win: any = await winPromise;

    if (!opponentNope) {
      if (win !== null) {
        console.log('FAIL: a window opened even though nobody can Nope', JSON.stringify(win));
        process.exit(1);
      }
      if (!(await waitForClear(attacker, 2000))) {
        console.log('FAIL: action with no eligible Nopers did not auto-resolve');
        process.exit(1);
      }
      console.log('  no eligible Nopers → resolved instantly, no window opened. PASS');
    } else {
      if (!win) {
        console.log('FAIL: NOPE_WINDOW_OPEN not received while opponent holds a Nope');
        process.exit(1);
      }
      await delay(150);
      if (typeof win.deadline !== 'number' || typeof win.duration_ms !== 'number' ||
          win.duration_ms < 1000 ||
          win.is_actor !== true || win.may_pass !== false || win.eligible_count !== 1) {
        console.log('FAIL: nope window payload malformed', JSON.stringify(win));
        process.exit(1);
      }
      const oppWin = opponent.nopeWindows[opponent.nopeWindows.length - 1];
      if (!oppWin || oppWin.may_pass !== true || oppWin.eligible_count !== 1) {
        console.log('FAIL: opponent window payload missing may_pass/eligible info');
        process.exit(1);
      }
      console.log(`  window opened: deadline=${win.deadline} duration=${win.duration_ms}ms eligible=1`);
      await waitForClear(attacker, 300);
      if (!attacker.state?.pendingAction) {
        console.log('FAIL: window auto-resolved while an eligible Noper has not acted');
        process.exit(1);
      }

      // Guard: the actor must not be able to race the window by resolving.
      attacker.emit('RESOLVE_NOPE');
      await delay(400);
      const guardErr = attacker.errors.find((e) => e.includes('Waiting for other players'));
      if (!guardErr) {
        console.log('FAIL: actor could race the window by resolving instantly');
        process.exit(1);
      }
      const aErrs = attacker.errors.length;
      const bErrs = opponent.errors.length;
      console.log('  actor RESOLVE_NOPE rejected while a Noper is present. GOOD');

      // Opponent passes → all eligible bowed out → instant resolution.
      opponent.emit('PASS_NOPE');
      if (!(await waitForClear(attacker, 6000))) {
        console.log('FAIL: action did not resolve after all eligible players passed');
        process.exit(1);
      }
      if (attacker.errors.length !== aErrs || opponent.errors.length !== bErrs) {
        console.log('FAIL: unexpected errors during pass flow');
        process.exit(1);
      }
      console.log('  PASS_NOPE → instant resolution (not cancelled). PASS');
    }

    const activeNow = a.state?.currentPlayerId === a.playerId ? a : b;
    console.log(`  after: active=${activeNow.name}, obligations=${a.state?.drawObligations}`);
  }

  // ---- Scenario B: eligible Noper idles → the 5s server timer resolves it ----
  console.log('\n[B] Timer expiry (Noper idles):');
  let expiryChecked = false;
  for (let attempt = 1; attempt <= 3 && !expiryChecked; attempt++) {
    const { a, b } = await setupGame();
    const { attacker, attackCard, opponent } = await findActionPlayable(a, b);
    const opponentNope = opponent.has('nope');
    console.log(`  attempt ${attempt}: ${attacker.name} has ${attackCard.type}; opponent ${opponentNope ? 'HAS' : 'has no'} Nope`);
    if (!opponentNope) continue;

    const winPromise = Promise.race([
      attacker.waitFor('NOPE_WINDOW_OPEN', 3000),
      delay(1800).then(() => null),
    ]);
    attacker.emit('PLAY_CARD', { card_id: attackCard.id });
    const win: any = await winPromise;
    if (!win || typeof win.deadline !== 'number' || win.duration_ms < 1000) {
      console.log('FAIL: window payload missing server countdown');
      process.exit(1);
    }

    // Nobody acts — the countdown must resolve the action automatically.
    if (!(await waitForClear(attacker, 19500))) {
      console.log('FAIL: server timer never resolved the idle window');
      process.exit(1);
    }
    const elapsedMs = Date.now() - (win.deadline - win.duration_ms);
    if (elapsedMs < 15000) {
      console.log(`FAIL: resolved too early (${elapsedMs}ms) — countdown ignored`);
      process.exit(1);
    }
    expiryChecked = true;
    console.log(`  idle window auto-resolved after ${elapsedMs}ms (~18s). PASS`);
  }
  if (!expiryChecked) {
    console.log('  skipped — opponent never held a Nope in 3 attempts');
  }

  console.log('\nDone.');
  process.exit(0);
}

main().catch((e) => {
  console.error('E2E FAILED:', e.message);
  process.exit(1);
});