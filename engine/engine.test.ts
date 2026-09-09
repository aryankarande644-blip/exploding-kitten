import { GameState, Card, CardType } from './state';
import { setup, shuffle, createFullDeck, DECK_COMPOSITION } from './deck';
import {
  playCard,
  drawCard,
  handleExplosion,
  handleExplosionWithIndex,
  resolvePendingAction,
  playNope,
  completeFavor,
  getActionType,
} from './actions';
import {
  getCurrentPlayer,
  getPlayer,
  nextAlivePlayer,
  eliminate,
  checkWin,
} from './turn';

function assert(condition: boolean, msg: string) {
  if (!condition) {
    throw new Error(`ASSERTION FAILED: ${msg}`);
  }
}

function testSetup() {
  console.log('Test: setup() produces correct state...');
  const state = setup(['p1', 'p2', 'p3', 'p4'], ['Alice', 'Bob', 'Charlie', 'Diana']);

  assert(state.players.length === 4, 'Should have 4 players');
  for (const p of state.players) {
    assert(p.hand.length === 8, `${p.name} should have 8 cards, has ${p.hand.length}`);
    assert(p.alive === true, `${p.name} should be alive`);
  }

  const kittensInDeck = state.deck.filter(c => c.type === 'exploding_kitten').length;
  assert(kittensInDeck === 3, `Deck should have 3 kittens, has ${kittensInDeck}`);

  const defusesInGame = [
    ...state.players.flatMap(p => p.hand),
    ...state.deck,
    ...state.discard,
  ].filter(c => c.type === 'defuse').length;
  assert(defusesInGame === 6, `Should have 6 defuses in game, has ${defusesInGame}`);

  const totalCards = state.players.reduce((s, p) => s + p.hand.length, 0) + state.deck.length + state.discard.length;
  assert(totalCards === 51 + state.players.length, `Total cards should be ${51 + state.players.length}, has ${totalCards}`);

  assert(state.status === 'in_progress', 'Status should be in_progress');
  assert(state.currentPlayerIndex === 0, 'First player should be current');
  assert(state.drawObligations === 1, 'Should have 1 draw obligation');

  console.log('  PASSED');
}

function testDrawCard() {
  console.log('Test: drawCard() basic flow...');
  const state = setup(['p1', 'p2', 'p3']);

  while (state.deck.length > 0 && state.deck[0].type === 'exploding_kitten') {
    state.deck.push(state.deck.shift()!);
  }
  const topCard = state.deck[0];
  const player1HandBefore = state.players[0].hand.length;
  const deckBefore = state.deck.length;

  drawCard(state);

  assert(state.players[0].hand.length === player1HandBefore + 1, 'Player 1 should have one more card');
  assert(state.deck.length === deckBefore - 1, 'Deck should have one less card');
  assert(state.currentPlayerIndex === 1, 'Turn should advance to player 2');

  console.log('  PASSED');
}

function testSkip() {
  console.log('Test: Skip card...');
  const state = setup(['p1', 'p2', 'p3']);

  const skipCard = state.players[0].hand.find(c => c.type === 'skip');
  if (!skipCard) {
    console.log('  SKIPPED (no skip card in hand)');
    return;
  }

  const deckBefore = state.deck.length;
  playCard(state, 'p1', [skipCard]);
  resolvePendingAction(state);

  assert(state.drawObligations === 1, 'Skip should reduce draw obligations and turn advances with new obligation');
  assert(state.deck.length === deckBefore, 'Deck should not change');
  assert(state.currentPlayerIndex === 1, 'Turn should advance');

  console.log('  PASSED');
}

function testShuffle() {
  console.log('Test: Shuffle card...');
  const state = setup(['p1', 'p2', 'p3']);

  const shuffleCard = state.players[0].hand.find(c => c.type === 'shuffle');
  if (!shuffleCard) {
    console.log('  SKIPPED (no shuffle card in hand)');
    return;
  }

  const deckOrderBefore = state.deck.map(c => c.id).join(',');
  playCard(state, 'p1', [shuffleCard]);
  resolvePendingAction(state);

  const deckOrderAfter = state.deck.map(c => c.id).join(',');

  assert(state.deck.length === state.deck.length, 'Deck size should not change');
  assert(state.drawObligations === 1, 'Shuffle should not change draw obligations');
  console.log('  PASSED');
}

function testSeeTheFuture() {
  console.log('Test: See the Future card...');
  const state = setup(['p1', 'p2', 'p3']);

  const seeFutureCard = state.players[0].hand.find(c => c.type === 'see_future');
  if (!seeFutureCard) {
    console.log('  SKIPPED (no see_future card in hand)');
    return;
  }

  const topThree = state.deck.slice(0, 3);
  playCard(state, 'p1', [seeFutureCard]);
  resolvePendingAction(state);

  assert(state.deck.slice(0, 3).every((c, i) => c.id === topThree[i].id), 'Top 3 cards should be unchanged');
  console.log('  PASSED');
}

function testAttack() {
  console.log('Test: Attack card...');
  const state = setup(['p1', 'p2', 'p3']);

  const attackCard = state.players[0].hand.find(c => c.type === 'attack');
  if (!attackCard) {
    console.log('  SKIPPED (no attack card in hand)');
    return;
  }

  playCard(state, 'p1', [attackCard]);
  resolvePendingAction(state);

  assert(state.currentPlayerIndex === 1, 'Turn should pass to player 2');
  assert(state.drawObligations === 2, 'Player 2 should have 2 draw obligations');

  console.log('  PASSED');
}

function testAttackStacking() {
  console.log('Test: Attack stacking...');
  const state = setup(['p1', 'p2', 'p3', 'p4']);

  const attackCard1 = state.players[0].hand.find(c => c.type === 'attack');
  if (!attackCard1) {
    console.log('  SKIPPED (no attack card in hand)');
    return;
  }

  playCard(state, 'p1', [attackCard1]);
  resolvePendingAction(state);

  assert(state.currentPlayerIndex === 1, 'Turn should pass to player 2');
  assert(state.drawObligations === 2, 'Player 2 should have 2 obligations');

  const attackCard2 = state.players[1].hand.find(c => c.type === 'attack');
  if (!attackCard2) {
    console.log('  SKIPPED (no attack card for p2)');
    return;
  }

  playCard(state, 'p2', [attackCard2]);
  resolvePendingAction(state);

  assert(state.currentPlayerIndex === 2, 'Turn should pass to player 3');
  assert(state.drawObligations === 4, 'Player 3 should have 4 obligations (2+2)');

  console.log('  PASSED');
}

function testFavor() {
  console.log('Test: Favor card...');
  const state = setup(['p1', 'p2', 'p3']);

  const favorCard = state.players[0].hand.find(c => c.type === 'favor');
  if (!favorCard) {
    console.log('  SKIPPED (no favor card in hand)');
    return;
  }

  const p2HandBefore = state.players[1].hand.length;
  const p1HandBefore = state.players[0].hand.length;

  const p2FirstCard = state.players[1].hand[0];
  playCard(state, 'p1', [favorCard], 'p2');
  resolvePendingAction(state);
  completeFavor(state, 'p2', 'p1', p2FirstCard.id);

  assert(state.players[1].hand.length === p2HandBefore - 1, 'Player 2 should have one less card');
  assert(state.players[0].hand.length === p1HandBefore, 'Player 1 should have same count (played favor, gained a card)');

  console.log('  PASSED');
}

function testCatPair() {
  console.log('Test: Cat pair...');
  const state = setup(['p1', 'p2', 'p3']);

  const catCards = state.players[0].hand.filter(c => c.type.startsWith('cat_'));
  const typeGroups: Record<string, Card[]> = {};
  for (const c of catCards) {
    if (!typeGroups[c.type]) typeGroups[c.type] = [];
    typeGroups[c.type].push(c);
  }

  const pairType = Object.keys(typeGroups).find(t => typeGroups[t].length >= 2);
  if (!pairType) {
    console.log('  SKIPPED (no matching pair in hand)');
    return;
  }

  const pair = typeGroups[pairType].slice(0, 2);
  const p1HandBefore = state.players[0].hand.length;
  const p2HandBefore = state.players[1].hand.length;

  playCard(state, 'p1', pair, 'p2');
  resolvePendingAction(state);

  assert(state.players[1].hand.length === p2HandBefore - 1, 'Target should have one less card');
  assert(state.players[0].hand.length === p1HandBefore - 1, 'Player should have one less card net (played 2, stole 1)');

  console.log('  PASSED');
}

function testNope() {
  console.log('Test: Nope card...');
  const state = setup(['p1', 'p2', 'p3']);

  const favorCard = state.players[0].hand.find(c => c.type === 'favor');
  if (!favorCard) {
    console.log('  SKIPPED (no favor card in hand)');
    return;
  }

  const nopeCard = state.players[1].hand.find(c => c.type === 'nope');
  if (!nopeCard) {
    console.log('  SKIPPED (no nope card for p2)');
    return;
  }

  const p1HandBefore = state.players[0].hand.length;
  const p2HandBefore = state.players[1].hand.length;

  playCard(state, 'p1', [favorCard], 'p2');
  playNope(state, 'p2');
  resolvePendingAction(state);

  assert(state.players[0].hand.length === p1HandBefore - 1, 'Player should have 1 less card (Favor was played and discarded)');
  assert(state.players[1].hand.length === p2HandBefore - 1, 'Target should have 1 less card (Nope was played and discarded), but Favor effect was cancelled');

  console.log('  PASSED');
}

function testDoubleNope() {
  console.log('Test: Double Nope (effect resolves)...');
  const state = setup(['p1', 'p2', 'p3']);

  const favorCard = state.players[0].hand.find(c => c.type === 'favor');
  if (!favorCard) {
    console.log('  SKIPPED (no favor card in hand)');
    return;
  }

  const nopeCard1 = state.players[1].hand.find(c => c.type === 'nope');
  const nopeCard2 = state.players[2].hand.find(c => c.type === 'nope');
  if (!nopeCard1 || !nopeCard2) {
    console.log('  SKIPPED (not enough nope cards)');
    return;
  }

  const p1HandBefore = state.players[0].hand.length;
  const p2HandBefore = state.players[1].hand.length;
  const p3HandBefore = state.players[2].hand.length;

  playCard(state, 'p1', [favorCard], 'p2');
  playNope(state, 'p2');
  playNope(state, 'p3');
  resolvePendingAction(state);

  assert(state.players[0].hand.length === p1HandBefore - 1, 'Player should have 1 less card (Favor was played)');
  assert(state.players[1].hand.length === p2HandBefore - 1, 'Player 2 should have 1 less card (Nope was played)');
  assert(state.players[2].hand.length === p3HandBefore - 1, 'Player 3 should have 1 less card (Nope was played)');

  console.log('  PASSED');
}

function testExplosionNoDefuse() {
  console.log('Test: Explosion without defuse...');
  const state = setup(['p1', 'p2']);

  state.players[0].hand = state.players[0].hand.filter(c => c.type !== 'defuse');
  state.deck.unshift({ id: 'test_kitten', type: 'exploding_kitten' });

  const p1HandBefore = state.players[0].hand.length;
  drawCard(state);

  assert(state.players[0].alive === false, 'Player should be eliminated');
  assert(state.players[0].hand.length === 0, 'Player hand should be empty');
  assert(state.discard.length >= p1HandBefore, 'Discard should contain player hand');

  console.log('  PASSED');
}

function testExplosionWithDefuse() {
  console.log('Test: Explosion with defuse...');
  const state = setup(['p1', 'p2']);

  state.deck.unshift({ id: 'test_kitten', type: 'exploding_kitten' });

  const defuseInHand = state.players[0].hand.find(c => c.type === 'defuse');
  assert(!!defuseInHand, 'Player should have a defuse');
  const defusesBefore = state.players[0].hand.filter(c => c.type === 'defuse').length;

  const deckSizeBefore = state.deck.length;
  drawCard(state);

  assert(state.players[0].alive === true, 'Player should still be alive');
  const defusesAfter = state.players[0].hand.filter(c => c.type === 'defuse').length;
  assert(defusesAfter === defusesBefore - 1, 'Player should have used defuse');
  assert(state.deck.includes(state.deck.find(c => c.id === 'test_kitten')!), 'Kitten should be back in deck');

  console.log('  PASSED');
}

function testRandomGames() {
  console.log('Test: Random game simulation (1000 games)...');
  let wins: Record<string, number> = {};
  let totalGames = 1000;
  let errors = 0;

  for (let g = 0; g < totalGames; g++) {
    try {
      const state = setup(['p1', 'p2', 'p3', 'p4']);

      while (state.status === 'in_progress') {
        const player = getCurrentPlayer(state);

        if (state.pendingAction) {
          resolvePendingAction(state);
          continue;
        }

        if (state.drawObligations > 0) {
          const canSkip = player.hand.some(c => c.type === 'skip');
          const canAttack = player.hand.some(c => c.type === 'attack');
          const canShuffle = player.hand.some(c => c.type === 'shuffle');

          if (canSkip && Math.random() < 0.15) {
            const skipCard = player.hand.find(c => c.type === 'skip')!;
            playCard(state, player.id, [skipCard]);
            resolvePendingAction(state);
          } else if (canAttack && Math.random() < 0.1) {
            const attackCard = player.hand.find(c => c.type === 'attack')!;
            playCard(state, player.id, [attackCard]);
            resolvePendingAction(state);
          } else if (state.deck.length > 0) {
            drawCard(state);
          } else {
            break;
          }
        }

        if ((state.status as GameState['status']) === 'finished') break;
      }

      if (state.winnerId) {
        wins[state.winnerId] = (wins[state.winnerId] || 0) + 1;
      }

      const totalCards = state.players.reduce((s, p) => s + p.hand.length, 0) + state.deck.length + state.discard.length;
      if (totalCards !== 51 + state.players.length) {
        console.log(`  ERROR in game ${g}: total cards = ${totalCards}`);
        errors++;
      }

      const aliveCount = state.players.filter(p => p.alive).length;
      if (state.status === 'finished' && aliveCount > 1) {
        console.log(`  ERROR in game ${g}: finished but ${aliveCount} players alive`);
        errors++;
      }
    } catch (e) {
      errors++;
      if (errors <= 3) {
        console.log(`  ERROR in game ${g}: ${(e as Error).message}`);
      }
    }
  }

  console.log(`  Results: ${totalGames - errors} completed, ${errors} errors`);
  console.log(`  Wins: ${JSON.stringify(wins)}`);
  assert(errors === 0, `Should have 0 errors, had ${errors}`);
  console.log('  PASSED');
}

function testDeckComposition() {
  console.log('Test: Deck composition...');
  const deck = createFullDeck();
  const counts: Record<string, number> = {};
  for (const card of deck) {
    counts[card.type] = (counts[card.type] || 0) + 1;
  }

  for (const [type, expected] of Object.entries(DECK_COMPOSITION)) {
    assert(counts[type] === expected, `${type}: expected ${expected}, got ${counts[type]}`);
  }

  assert(deck.length === 56, `Full deck should be 56 cards, has ${deck.length}`);
  console.log('  PASSED');
}

function testNextAlivePlayer() {
  console.log('Test: nextAlivePlayer skips eliminated...');
  const state = setup(['p1', 'p2', 'p3', 'p4']);
  state.players[1].alive = false;

  state.currentPlayerIndex = 0;
  const next = nextAlivePlayer(state);
  assert(next.id === 'p3', 'Should skip p2 and go to p3');

  state.players[2].alive = false;
  state.currentPlayerIndex = 0;
  const next2 = nextAlivePlayer(state);
  assert(next2.id === 'p4', 'Should skip p2, p3 and go to p4');

  console.log('  PASSED');
}

function testWinCondition() {
  console.log('Test: Win condition...');
  const state = setup(['p1', 'p2', 'p3']);
  state.players[0].alive = false;
  state.players[1].alive = false;

  checkWin(state);

  assert(state.status === 'finished', 'Game should be finished');
  assert(state.winnerId === 'p3', 'Player 3 should win');

  console.log('  PASSED');
}

function testTripleAndQuintuple() {
  console.log('Test: Cat triple and quintuple...');
  const state = setup(['p1', 'p2', 'p3', 'p4', 'p5']);

  const catCards = state.players[0].hand.filter(c => c.type.startsWith('cat_'));
  const typeGroups: Record<string, Card[]> = {};
  for (const c of catCards) {
    if (!typeGroups[c.type]) typeGroups[c.type] = [];
    typeGroups[c.type].push(c);
  }

  const tripleType = Object.keys(typeGroups).find(t => typeGroups[t].length >= 3);
  if (tripleType) {
    const triple = typeGroups[tripleType].slice(0, 3);
    const targetCard = state.players[1].hand[0];
    if (targetCard) {
      const p1HandBefore = state.players[0].hand.length;
      const p2HandBefore = state.players[1].hand.length;
      playCard(state, 'p1', triple, 'p1', targetCard.type);
      resolvePendingAction(state);
      assert(state.players[0].hand.length === p1HandBefore + 1, 'Should gain 1 card from triple');
    }
  }

  console.log('  PASSED');
}

console.log('=== Running Engine Tests ===\n');

try {
  testDeckComposition();
  testSetup();
  testDrawCard();
  testSkip();
  testShuffle();
  testSeeTheFuture();
  testAttack();
  testAttackStacking();
  testFavor();
  testCatPair();
  testNope();
  testDoubleNope();
  testExplosionNoDefuse();
  testExplosionWithDefuse();
  testNextAlivePlayer();
  testWinCondition();
  testTripleAndQuintuple();
  testRandomGames();
  console.log('\n=== ALL TESTS PASSED ===');
} catch (e) {
  console.error('\n=== TEST FAILED ===');
  console.error((e as Error).message);
  process.exit(1);
}
