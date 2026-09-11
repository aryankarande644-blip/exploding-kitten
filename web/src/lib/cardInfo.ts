import { CardType } from './types';

interface CardInfo {
  label: string;
  color: string;
  bgColor: string;
  textColor: string;
  emoji: string;
  description: string;
}

export const CARD_INFO: Record<CardType, CardInfo> = {
  defuse: {
    label: 'Defuse',
    color: '#10a352',
    bgColor: 'bg-[#10a352]',
    textColor: 'text-white',
    emoji: '🛡️',
    description: 'Save yourself from explosion',
  },
  skip: {
    label: 'Skip',
    color: '#38bdf8',
    bgColor: 'bg-[#38bdf8]',
    textColor: 'text-white',
    emoji: '⏭️',
    description: 'Skip your turn, draw nothing',
  },
  shuffle: {
    label: 'Shuffle',
    color: '#147bf0',
    bgColor: 'bg-[#147bf0]',
    textColor: 'text-white',
    emoji: '🔀',
    description: 'Shuffle the draw deck thoroughly',
  },
  see_future: {
    label: 'See Future',
    color: '#9648d8',
    bgColor: 'bg-[#9648d8]',
    textColor: 'text-white',
    emoji: '🔮',
    description: 'View top 3 cards in the deck',
  },
  favor: {
    label: 'Favor',
    color: '#f97316',
    bgColor: 'bg-[#f97316]',
    textColor: 'text-white',
    emoji: '🎁',
    description: 'Steal a card from a player',
  },
  attack: {
    label: 'Attack',
    color: '#f69e25',
    bgColor: 'bg-[#f69e25]',
    textColor: 'text-white',
    emoji: '⚔️',
    description: 'Force the next player to take 2 turns',
  },
  nope: {
    label: 'Nope',
    color: '#e2253c',
    bgColor: 'bg-[#e2253c]',
    textColor: 'text-white',
    emoji: '🚫',
    description: 'Stop any action except Defuse',
  },
  exploding_kitten: {
    label: 'Exploding Kitten',
    color: '#dc2626',
    bgColor: 'bg-[#dc2626]',
    textColor: 'text-white',
    emoji: '💣',
    description: 'Boom! You are out of the game',
  },
  cat_a: {
    label: 'Taco Cat',
    color: '#e03a67',
    bgColor: 'bg-[#e03a67]',
    textColor: 'text-white',
    emoji: '🌮',
    description: 'Collect pairs for cat powers',
  },
  cat_b: {
    label: 'Rainbow-Ralphing Cat',
    color: '#e03a67',
    bgColor: 'bg-[#e03a67]',
    textColor: 'text-white',
    emoji: '🌈',
    description: 'Collect pairs for cat powers',
  },
  cat_c: {
    label: 'Beard Cat',
    color: '#e03a67',
    bgColor: 'bg-[#e03a67]',
    textColor: 'text-white',
    emoji: '🧔',
    description: 'Collect pairs for cat powers',
  },
  cat_d: {
    label: 'Cattermelon',
    color: '#e03a67',
    bgColor: 'bg-[#e03a67]',
    textColor: 'text-white',
    emoji: '🍉',
    description: 'Collect pairs for cat powers',
  },
  cat_e: {
    label: 'Hairy Potato Cat',
    color: '#e03a67',
    bgColor: 'bg-[#e03a67]',
    textColor: 'text-white',
    emoji: '🥔',
    description: 'Collect pairs for cat powers',
  },
};

export function getCardInfo(type: CardType): CardInfo {
  return CARD_INFO[type];
}

export function isCatCard(type: CardType): boolean {
  return type.startsWith('cat_');
}