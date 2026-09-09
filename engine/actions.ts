import { Card, CardType, GameState, PendingAction, Player } from './state';
import {
  getPlayer,
  getCurrentPlayer,
  nextAlivePlayer,
  advanceToPlayer,
  checkTurnAdvance,
  checkWin,
  removeFromHand,
  stealRandomCard,
  eliminate,
} from './turn';
import { shuffle } from './deck';

export function playCard(
  state: GameState,
  playerId: string,
  cards: Card[],
  targetId?: string,
  namedCardType?: CardType
): void {
  const player = getPlayer(state, playerId);
  if (state.pendingAction) {
    throw new Error('Cannot play card while another action is pending');
  }

  for (const card of cards) {
    if (card.type === 'defuse') {
      throw new Error('Defuse is never played via this path');
    }
    if (card.type === 'exploding_kitten') {
      throw new Error('Cannot play Exploding Kitten');
    }
  }

  if (cards.length === 2) {
    if (cards[0].type !== cards[1].type) {
      throw new Error('Cat pair requires 2 matching cards');
    }
    if (!cards[0].type.startsWith('cat_')) {
      throw new Error('Cat pair requires cat cards');
    }
  }

  if (cards.length === 3) {
    if (!cards.every(c => c.type === cards[0].type)) {
      throw new Error('Cat triple requires 3 matching cards');
    }
    if (!cards[0].type.startsWith('cat_')) {
      throw new Error('Cat triple requires cat cards');
    }
  }

  if (cards.length === 5) {
    const types = new Set(cards.map(c => c.type));
    if (types.size !== 5) {
      throw new Error('Cat quintuple requires 5 different cat types');
    }
    for (const c of cards) {
      if (!c.type.startsWith('cat_')) {
        throw new Error('Cat quintuple requires cat cards');
      }
    }
  }

  if (cards.length === 1 && cards[0].type === 'attack') {
    if (targetId) throw new Error('Attack does not target a player');
  }

  if (cards.length === 1 && cards[0].type === 'favor') {
    if (!targetId) throw new Error('Favor requires a target player');
    if (targetId === playerId) throw new Error('Cannot Favor yourself');
  }

  if (cards.length === 2 || cards.length === 3) {
    if (!targetId) throw new Error('Cat pair/triple requires a target player');
    if (targetId === playerId) throw new Error('Cannot target yourself');
  }

  if (cards.length === 5) {
    if (!targetId) throw new Error('Cat quintuple requires a target discard');
  }

  for (const card of cards) {
    removeFromHand(state, playerId, card);
  }

  const actionType = getActionType(cards);

  state.pendingAction = {
    cards,
    sourcePlayerId: playerId,
    targetPlayerId: targetId,
    namedCardType,
    nopeStack: [],
    resolved: false,
  };
}

export function getActionType(cards: Card[]): CardType {
  if (cards.length === 1) return cards[0].type;
  if (cards.length === 2) return 'cat_a' as CardType;
  if (cards.length === 3) return 'cat_b' as CardType;
  if (cards.length === 5) return 'cat_c' as CardType;
  throw new Error('Invalid card combination');
}

export function playNope(state: GameState, playerId: string): void {
  if (!state.pendingAction) throw new Error('No pending action to Nope');

  const nopeCard = getPlayer(state, playerId).hand.find(c => c.type === 'nope');
  if (!nopeCard) throw new Error('No Nope card in hand');

  removeFromHand(state, playerId, nopeCard);
  state.discard.push(nopeCard);

  state.pendingAction.nopeStack.push(playerId);
}

export function resolvePendingAction(state: GameState): void {
  const action = state.pendingAction;
  if (!action) return;

  for (const card of action.cards) {
    state.discard.push(card);
  }

  const cancelled = action.nopeStack.length % 2 === 1;

  if (!cancelled) {
    applyEffect(state, action);
  }

  action.resolved = true;
  state.pendingAction = null;
}

function applyEffect(state: GameState, action: PendingAction): void {
  const primaryCard = action.cards[0];

  switch (primaryCard.type) {
    case 'skip':
      state.drawObligations -= 1;
      checkTurnAdvance(state);
      break;

    case 'shuffle':
      shuffle(state.deck);
      checkTurnAdvance(state);
      break;

    case 'see_future':
      checkTurnAdvance(state);
      break;

    case 'favor':
      checkTurnAdvance(state);
      break;

    case 'attack': {
      const carried = state.drawObligations;
      state.drawObligations = 0;
      const next = nextAlivePlayer(state);
      const nextObs = carried >= 2 ? carried + 2 : 2;
      advanceToPlayer(state, next, nextObs);
      return;
    }

    case 'nope':
      break;

    default:
      if (primaryCard.type.startsWith('cat_')) {
        if (action.cards.length === 2) {
          const targetId = action.targetPlayerId!;
          stealRandomCard(state, targetId, action.sourcePlayerId);
        } else if (action.cards.length === 3) {
          const target = getPlayer(state, action.targetPlayerId!);
          const namedType = action.namedCardType;
          if (namedType) {
            const idx = target.hand.findIndex(c => c.type === namedType);
            if (idx !== -1) {
              const [card] = target.hand.splice(idx, 1);
              getPlayer(state, action.sourcePlayerId).hand.push(card);
            }
          }
        } else if (action.cards.length === 5) {
          const topDiscardIndex = state.discard.length - action.cards.length - 1;
          if (topDiscardIndex >= 0) {
            const [topDiscard] = state.discard.splice(topDiscardIndex, 1);
            getPlayer(state, action.sourcePlayerId).hand.push(topDiscard);
          }
        }
        checkTurnAdvance(state);
      }
      break;
  }
}

export function drawCard(state: GameState): void {
  if (state.deck.length === 0) {
    throw new Error('Deck is empty');
  }

  const card = state.deck.shift()!;
  const player = getCurrentPlayer(state);

  if (card.type === 'exploding_kitten') {
    handleExplosion(state, player, card);
    return;
  }

  player.hand.push(card);
  state.drawObligations -= 1;
  checkTurnAdvance(state);
}

export function handleExplosion(state: GameState, player: Player, kitten: Card): void {
  const defuseIdx = player.hand.findIndex(c => c.type === 'defuse');
  if (defuseIdx === -1) {
    state.discard.push(kitten);
    eliminate(state, player);
    checkWin(state);
    if (state.status !== 'finished') {
      advanceToPlayer(state, nextAlivePlayer(state), 1);
    }
    return;
  }

  const [defuse] = player.hand.splice(defuseIdx, 1);
  state.discard.push(defuse);

  const insertIndex = Math.floor(Math.random() * (state.deck.length + 1));
  state.deck.splice(insertIndex, 0, kitten);

  state.drawObligations -= 1;
  checkTurnAdvance(state);
}

export function handleExplosionWithIndex(
  state: GameState,
  player: Player,
  kitten: Card,
  insertIndex: number
): void {
  const defuseIdx = player.hand.findIndex(c => c.type === 'defuse');
  if (defuseIdx === -1) {
    state.discard.push(kitten);
    eliminate(state, player);
    checkWin(state);
    if (state.status !== 'finished') {
      advanceToPlayer(state, nextAlivePlayer(state), 1);
    }
    return;
  }

  const [defuse] = player.hand.splice(defuseIdx, 1);
  state.discard.push(defuse);

  const safeIndex = Math.max(0, Math.min(insertIndex, state.deck.length));
  state.deck.splice(safeIndex, 0, kitten);

  state.drawObligations -= 1;
  checkTurnAdvance(state);
}

export function completeFavor(state: GameState, targetId: string, sourceId: string, cardId: string): void {
  const target = getPlayer(state, targetId);
  const source = getPlayer(state, sourceId);
  const idx = target.hand.findIndex(c => c.id === cardId);
  if (idx === -1) throw new Error(`Card ${cardId} not in target's hand`);
  const [card] = target.hand.splice(idx, 1);
  source.hand.push(card);
}
