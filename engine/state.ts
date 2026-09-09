export type CardType =
  | 'defuse'
  | 'skip'
  | 'shuffle'
  | 'see_future'
  | 'favor'
  | 'attack'
  | 'nope'
  | 'exploding_kitten'
  | 'cat_a'
  | 'cat_b'
  | 'cat_c'
  | 'cat_d'
  | 'cat_e';

export interface Card {
  id: string;
  type: CardType;
}

export interface Player {
  id: string;
  name: string;
  hand: Card[];
  alive: boolean;
}

export interface PendingAction {
  cards: Card[];
  sourcePlayerId: string;
  targetPlayerId?: string;
  namedCardType?: CardType;
  nopeStack: string[];
  resolved: boolean;
}

export interface GameState {
  players: Player[];
  deck: Card[];
  discard: Card[];
  currentPlayerIndex: number;
  drawObligations: number;
  pendingAction: PendingAction | null;
  nopeWindowTimer: ReturnType<typeof setTimeout> | null;
  status: 'waiting' | 'in_progress' | 'finished';
  winnerId: string | null;
}

export interface PublicGameState {
  players: { id: string; name: string; alive: boolean; cardCount: number }[];
  deckCount: number;
  discardTop: Card | null;
  discardCount: number;
  currentPlayerId: string | null;
  drawObligations: number;
  pendingAction: PendingAction | null;
  status: 'waiting' | 'in_progress' | 'finished';
  winnerId: string | null;
}

export interface PrivatePlayerState extends PublicGameState {
  hand: Card[];
  futureCards?: Card[];
}
