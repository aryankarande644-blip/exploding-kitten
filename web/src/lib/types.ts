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

export interface PendingAction {
  cards: Card[];
  sourcePlayerId: string;
  targetPlayerId?: string;
  namedCardType?: CardType;
  nopeStack: string[];
  resolved: boolean;
}

export interface ActivityEntry {
  id: string;
  text: string;
  ts: number;
}

export interface ClientGameState {
  players: { id: string; name: string; alive: boolean; cardCount: number }[];
  hostId: string;
  deckCount: number;
  discardTop: Card | null;
  discardCount: number;
  currentPlayerId: string | null;
  drawObligations: number;
  pendingAction: PendingAction | null;
  pendingPrompt: 'favor' | 'defuse' | null;
  status: 'waiting' | 'in_progress' | 'finished';
  winnerId: string | null;
  activity: ActivityEntry[];
}

export interface ClientPlayerState extends ClientGameState {
  hand: Card[];
  futureCards?: Card[];
}

export interface LobbyPlayer {
  id: string;
  name: string;
}

export interface LobbyState {
  players: LobbyPlayer[];
  host_id: string;
  status: 'waiting' | 'in_progress' | 'finished';
}
