import { Card, CardType, GameState, Player } from './state';

export const DECK_COMPOSITION: Record<CardType, number> = {
  defuse: 6,
  exploding_kitten: 4,
  skip: 4,
  attack: 4,
  favor: 4,
  shuffle: 4,
  see_future: 5,
  nope: 5,
  cat_a: 4,
  cat_b: 4,
  cat_c: 4,
  cat_d: 4,
  cat_e: 4,
};

export const NON_KITTEN_NON_DEFUSE_TYPES: CardType[] = [
  'skip', 'attack', 'favor', 'shuffle', 'see_future', 'nope',
  'cat_a', 'cat_b', 'cat_c', 'cat_d', 'cat_e',
];

let cardIdCounter = 0;

export function resetCardIdCounter(): void {
  cardIdCounter = 0;
}

export function generateCardId(type: CardType): string {
  cardIdCounter++;
  return `${type}_${cardIdCounter}`;
}

export function createFullDeck(): Card[] {
  const deck: Card[] = [];
  for (const [type, count] of Object.entries(DECK_COMPOSITION)) {
    for (let i = 0; i < count; i++) {
      deck.push({ id: generateCardId(type as CardType), type: type as CardType });
    }
  }
  return deck;
}

export function shuffle<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export function setup(playerIds: string[], playerNames?: string[]): GameState {
  const numPlayers = playerIds.length;
  if (numPlayers < 2 || numPlayers > 5) {
    throw new Error('Game requires 2-5 players');
  }

  resetCardIdCounter();

  const allCards = createFullDeck();

  const defuseCards = allCards.filter(c => c.type === 'defuse');
  const explodingKittens = allCards.filter(c => c.type === 'exploding_kitten');
  const remainingCards = allCards.filter(c => c.type !== 'defuse' && c.type !== 'exploding_kitten');

  shuffle(defuseCards);
  shuffle(remainingCards);

  const players: Player[] = playerIds.map((id, i) => ({
    id,
    name: playerNames?.[i] ?? `Player ${i + 1}`,
    hand: [defuseCards[i]],
    alive: true,
  }));

  const extraDefuses = defuseCards.slice(numPlayers);
  remainingCards.push(...extraDefuses);

  shuffle(remainingCards);

  let cardIndex = 0;
  for (const player of players) {
    for (let i = 0; i < 7; i++) {
      player.hand.push(remainingCards[cardIndex++]);
    }
  }

  const usedKittens = explodingKittens.slice(0, numPlayers - 1);
  const deck = remainingCards.slice(cardIndex);

  deck.push(...usedKittens);
  shuffle(deck);

  return {
    players,
    deck,
    discard: [],
    currentPlayerIndex: 0,
    drawObligations: 1,
    pendingAction: null,
    nopeWindowTimer: null,
    status: 'in_progress',
    winnerId: null,
  };
}
