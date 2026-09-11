'use client';

import { CSSProperties } from 'react';
import { Card as CardType } from '@/lib/types';
import { getCardInfo, isCatCard } from '@/lib/cardInfo';

function cx(...args: (string | false | null | undefined)[]): string {
  return args.filter(Boolean).join(' ');
}

interface CardProps {
  card: CardType;
  onClick?: () => void;
  selected?: boolean;
  disabled?: boolean;
  small?: boolean;
  className?: string;
  style?: CSSProperties;
}

export function GameCard({ card, onClick, selected, disabled, small, className, style }: CardProps) {
  const info = getCardInfo(card.type);

  return (
    <button
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      className={cx(
        'relative rounded-xl border border-white/30 flex flex-col overflow-hidden select-none',
        small
          ? 'w-14 h-20 sm:w-16 sm:h-24 shadow-[0_4px_10px_rgba(0,0,0,0.4)]'
          : 'w-24 h-36 sm:w-28 sm:h-40 shadow-card',
        disabled && 'opacity-40 cursor-not-allowed',
        !disabled && onClick && 'cursor-pointer',
        selected && 'ring-2 ring-amber-300/80',
        className,
      )}
      style={{ backgroundColor: info.color, ...style }}
    >
      {small ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-0.5 px-1">
          <span className="text-xl sm:text-2xl drop-shadow-sm">{info.emoji}</span>
          <span className="text-[7px] sm:text-[8px] font-bold text-white/95 text-center leading-tight">
            {info.label}
          </span>
        </div>
      ) : (
        <div className="flex-1 flex flex-col p-1.5">
          <div className="flex items-center justify-between gap-1">
            <span
              className="text-[9px] sm:text-[10px] font-black uppercase tracking-wide text-white/95 leading-tight"
              style={
                info.label.length > 12
                  ? { fontSize: '0.55rem' }
                  : undefined
              }
            >
              {info.label}
            </span>
            <span className="text-sm sm:text-base flex-none">{info.emoji}</span>
          </div>
          <div className="flex-1 flex items-center justify-center">
            <span className="text-3xl sm:text-4xl drop-shadow-sm">{info.emoji}</span>
          </div>
          <div className="rounded-md bg-black/20 py-0.5 px-1 text-center">
            <span className="text-[7px] sm:text-[8px] font-bold text-white/90 leading-tight line-clamp-2">
              {info.description}
            </span>
          </div>
        </div>
      )}
      <span className="absolute right-1.5 top-2 w-1.5 h-1.5 rounded-full bg-white/70" />
    </button>
  );
}

export function CardBack({ small }: { small?: boolean }) {
  return (
    <div
      className={cx(
        'card-back rounded-xl shadow-[0_6px_16px_rgba(0,0,0,0.4)]',
        small ? 'w-14 h-20 sm:w-16 sm:h-24 text-lg' : 'w-24 h-36 sm:w-28 sm:h-40 text-3xl',
      )}
    >
      <span className="opacity-90 drop-shadow">🐱</span>
    </div>
  );
}

export function FaceDownCard({ small }: { small?: boolean }) {
  return (
    <div
      className={cx(
        'rounded-xl border border-white/10 bg-gradient-to-br from-slate-700/70 to-slate-800/70 flex items-center justify-center',
        'shadow-[0_6px_16px_rgba(0,0,0,0.4)]',
        small ? 'w-14 h-20 sm:w-16 sm:h-24 text-lg' : 'w-24 h-36 sm:w-28 sm:h-40 text-3xl',
      )}
    >
      <span className="text-slate-400 font-semibold">?</span>
    </div>
  );
}

export { isCatCard };