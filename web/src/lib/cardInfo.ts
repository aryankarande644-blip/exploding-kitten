import { CardType } from './types';

interface CardInfo {
  label: string;
  color: string;
  bgColor: string;
  textColor: string;
  emoji: string;
}

export const CARD_INFO: Record<CardType, CardInfo> = {
  defuse: {
    label: 'Defuse',
    color: '#22c55e',
    bgColor: 'bg-green-500',
    textColor: 'text-white',
    emoji: '🛡️',
  },
  skip: {
    label: 'Skip',
    color: '#3b82f6',
    bgColor: 'bg-blue-500',
    textColor: 'text-white',
    emoji: '⏭️',
  },
  shuffle: {
    label: 'Shuffle',
    color: '#eab308',
    bgColor: 'bg-yellow-500',
    textColor: 'text-gray-900',
    emoji: '🔀',
  },
  see_future: {
    label: 'See the Future',
    color: '#a855f7',
    bgColor: 'bg-purple-500',
    textColor: 'text-white',
    emoji: '🔮',
  },
  favor: {
    label: 'Favor',
    color: '#f97316',
    bgColor: 'bg-orange-500',
    textColor: 'text-white',
    emoji: '🎁',
  },
  attack: {
    label: 'Attack',
    color: '#ef4444',
    bgColor: 'bg-red-500',
    textColor: 'text-white',
    emoji: '⚔️',
  },
  nope: {
    label: 'Nope',
    color: '#6b7280',
    bgColor: 'bg-gray-500',
    textColor: 'text-white',
    emoji: '🚫',
  },
  exploding_kitten: {
    label: 'Exploding Kitten',
    color: '#991b1b',
    bgColor: 'bg-red-900',
    textColor: 'text-red-200',
    emoji: '💣',
  },
  cat_a: {
    label: 'Taco Cat',
    color: '#fbcfe8',
    bgColor: 'bg-pink-300',
    textColor: 'text-pink-900',
    emoji: '🌮',
  },
  cat_b: {
    label: 'Rainbow-Ralphing Cat',
    color: '#c4b5fd',
    bgColor: 'bg-violet-300',
    textColor: 'text-violet-900',
    emoji: '🌈',
  },
  cat_c: {
    label: 'Beard Cat',
    color: '#a7f3d0',
    bgColor: 'bg-emerald-300',
    textColor: 'text-emerald-900',
    emoji: '🧔',
  },
cat_d: {
    label: 'Cattermelon',
    color: '#fed7aa',
    bgColor: 'bg-orange-300',
    textColor: 'text-orange-900',
    emoji: '🍉',
  },
cat_e: {
    label: 'Hairy Potato Cat',
    color: '#bae6fd',
    bgColor: 'bg-sky-300',
    textColor: 'text-sky-900',
    emoji: '🥔',
  },
};

export function getCardInfo(type: CardType): CardInfo {
  return CARD_INFO[type];
}

export function isCatCard(type: CardType): boolean {
  return type.startsWith('cat_');
}
