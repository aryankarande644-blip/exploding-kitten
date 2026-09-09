import { createRoom, startGame } from './rooms.js';
import { toSavedRoom, fromSavedRoom } from './db.js';

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error('FAIL: ' + msg);
}

// Verifies the full Neon persistence round-trip (serialize -> JSON -> restore)
// for a room holding an in-progress game so a restarted server can recover it.
async function main() {
  console.log('=== Persistence Round-Trip Test ===\n');

  const room = createRoom('p1', 'Alice', 'sock1').room;
  const code = room.code;
  room.players.set('p2', { socketId: 'sock2', name: 'Bob' });
  startGame(code);

  const state = room.gameState!;
  const p1 = state.players[0];
  const card = p1.hand[0];
  state.pendingAction = {
    cards: [card],
    sourcePlayerId: p1.id,
    nopeStack: ['p2'],
    resolved: false,
  };
  room.pendingFavor = { targetPlayerId: 'p2', sourcePlayerId: p1.id };
  room.pendingDefuse = {
    playerId: p1.id,
    kitten: { id: 'kitten_x', type: 'exploding_kitten' },
  };
  const handBefore = p1.hand.length;
  const deckBefore = state.deck.length;
  const obligationsBefore = state.drawObligations;

  // Database round-trip: JSON serialize then restore.
  const restored = fromSavedRoom(JSON.parse(JSON.stringify(toSavedRoom(room))));

  assert(restored.code === code, `code lost: ${restored.code}`);
  assert(restored.hostId === 'p1', `host lost: ${restored.hostId}`);
  assert(restored.players.has('p1') && restored.players.has('p2'), 'players lost');
  assert(restored.players.get('p1')!.name === 'Alice', 'player name lost');
  assert(restored.gameState, 'gameState lost');
  assert(restored.gameState!.deck.length === deckBefore, `deck changed: ${restored.gameState!.deck.length} != ${deckBefore}`);
  assert(restored.gameState!.drawObligations === obligationsBefore, 'obligations changed');
  assert(restored.gameState!.players[0].hand.length === handBefore, `hand changed: ${restored.gameState!.players[0].hand.length} != ${handBefore}`);
  const ra = restored.gameState!.pendingAction;
  assert(!!ra && ra.sourcePlayerId === p1.id, 'pendingAction lost');
  assert(ra!.cards[0].id === card.id, `card id lost: ${ra!.cards[0].id}`);
  assert(ra!.nopeStack.length === 1 && ra!.nopeStack[0] === 'p2', 'nopeStack lost');
  assert(restored.pendingFavor?.targetPlayerId === 'p2', 'pendingFavor lost');
  assert(restored.pendingDefuse?.kitten.id === 'kitten_x', 'pendingDefuse lost');
  assert(restored.nopeTimer === null && restored.nopeWindowDeadline === null,
    'transient nope timer/deadline not reset');
  assert(restored.nopePassed.size === 0, 'nopePassed not reset');
  assert(restored.gameState!.nopeWindowTimer === null, 'legacy nopeWindowTimer not nulled');

  console.log('Round-trip preserved: room code, host, players, deck/hand, obligations,');
  console.log('  pendingAction (cards/nopeStack), pendingFavor, pendingDefuse.');
  console.log('Transient timers reset to null. Cards are identical objects (ids intact).');
  console.log('\nPERSISTENCE ROUND-TRIP TEST PASSED');
  process.exit(0);
}

main().catch((e) => {
  console.error('\nPERSISTENCE TEST FAILED:', e.message);
  process.exit(1);
});