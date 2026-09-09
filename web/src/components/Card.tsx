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
        'relative rounded-xl border border-white/25 flex flex-col overflow-hidden select-none',
        'shadow-[0_4px_14px_rgba(0,0,0,0.45)]',
        small ? 'w-16 h-24' : 'w-24 h-36',
        disabled && 'opacity-40 cursor-not-allowed',
        !disabled && onClick && 'cursor-pointer',
        selected && 'ring-2 ring-amber-300/80',
        className,
      )}
      style={{ backgroundColor: '#f7f5ef', ...style }}
    >
      <div className="flex-none h-1.5 w-full" style={{ backgroundColor: info.color }} />
      <div className="flex-1 flex flex-col items-center justify-center gap-1 px-1">
        <span className={cx('drop-shadow-sm', small ? 'text-2xl' : 'text-4xl')}>{info.emoji}</span>
        <span
          className={cx(
            'text-center font-medium leading-tight text-slate-600',
            small ? 'text-[8px]' : 'text-[10px]',
            info.label.length > 14 && !small && 'text-[8px]',
          )}
        >
          {info.label}
        </span>
      </div>
      <span
        className="absolute right-1.5 top-2 w-1.5 h-1.5 rounded-full"
        style={{ backgroundColor: info.color }}
      />
    </button>
  );
}

export function CardBack({ small }: { small?: boolean }) {
  return (
    <div
      className={cx(
        'rounded-2xl border border-amber-400/30 bg-gradient-to-br from-amber-600/90 to-amber-900/90 flex items-center justify-center',
        'shadow-[0_6px_16px_rgba(0,0,0,0.4)]',
        small ? 'w-16 h-24 text-lg' : 'w-24 h-36 text-3xl',
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
        'rounded-2xl border border-white/10 bg-gradient-to-br from-slate-700/70 to-slate-800/70 flex items-center justify-center',
        'shadow-[0_6px_16px_rgba(0,0,0,0.4)]',
        small ? 'w-16 h-24 text-lg' : 'w-24 h-36 text-3xl',
      )}
    >
      <span className="text-slate-400 font-semibold">?</span>
    </div>
  );
}