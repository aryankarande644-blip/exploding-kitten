import { Card, GameState, Player } from './state';
import { shuffle } from './deck';

export function getPlayer(state: GameState, playerId: string): Player {
  const player = state.players.find(p => p.id === playerId);
  if (!player) throw new Error(`Player ${playerId} not found`);
  return player;
}

export function getCurrentPlayer(state: GameState): Player {
  return state.players[state.currentPlayerIndex];
}

export function nextAlivePlayer(state: GameState): Player {
  let i = state.currentPlayerIndex;
  do {
    i = (i + 1) % state.players.length;
  } while (!state.players[i].alive);
  return state.players[i];
}

export function eliminate(state: GameState, player: Player): void {
  state.discard.push(...player.hand);
  player.hand = [];
  player.alive = false;
}

export function checkWin(state: GameState): void {
  const alive = state.players.filter(p => p.alive);
  if (alive.length === 1) {
    state.status = 'finished';
    state.winnerId = alive[0].id;
  } else if (alive.length === 0) {
    state.status = 'finished';
    state.winnerId = null;
  }
}

export function advanceToPlayer(state: GameState, player: Player, addObligations: number): void {
  state.currentPlayerIndex = state.players.indexOf(player);
  state.drawObligations = addObligations;
}

export function checkTurnAdvance(state: GameState): void {
  if (state.drawObligations <= 0) {
    advanceToPlayer(state, nextAlivePlayer(state), 1);
  }
}

export function removeFromHand(state: GameState, playerId: string, card: Card): void {
  const player = getPlayer(state, playerId);
  const idx = player.hand.findIndex(c => c.id === card.id);
  if (idx === -1) throw new Error(`Card ${card.id} not in hand of player ${playerId}`);
  player.hand.splice(idx, 1);
}

export function stealRandomCard(state: GameState, fromId: string, toId: string): void {
  const from = getPlayer(state, fromId);
  const to = getPlayer(state, toId);
  if (from.hand.length === 0) return;
  const idx = Math.floor(Math.random() * from.hand.length);
  const [card] = from.hand.splice(idx, 1);
  to.hand.push(card);
}

export function transferCard(from: Player, to: Player, cardId: string): void {
  const idx = from.hand.findIndex(c => c.id === cardId);
  if (idx === -1) throw new Error(`Card ${cardId} not in hand`);
  const [card] = from.hand.splice(idx, 1);
  to.hand.push(card);
}

export function getPublicState(state: GameState) {
  return {
    players: state.players.map(p => ({
      id: p.id,
      name: p.name,
      alive: p.alive,
      cardCount: p.hand.length,
    })),
    deckCount: state.deck.length,
    discardTop: state.discard.length > 0 ? state.discard[state.discard.length - 1] : null,
    discardCount: state.discard.length,
    currentPlayerId: getCurrentPlayer(state).alive ? getCurrentPlayer(state).id : null,
    drawObligations: state.drawObligations,
    pendingAction: state.pendingAction,
    status: state.status,
    winnerId: state.winnerId,
  };
}

export function getPrivateState(state: GameState, playerId: string) {
  const publicState = getPublicState(state);
  const player = getPlayer(state, playerId);
  return {
    ...publicState,
    hand: player.hand,
  };
}
