'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { CSSProperties } from 'react';
import { getSocket } from '@/lib/socket';
import { Socket } from 'socket.io-client';
import { Card, CardType, ClientGameState, LobbyState } from '@/lib/types';
import { GameCard } from '@/components/Card';
import { getCardInfo, isCatCard } from '@/lib/cardInfo';

const ALL_CARD_TYPES: CardType[] = [
  'defuse',
  'skip',
  'shuffle',
  'see_future',
  'favor',
  'attack',
  'nope',
  'cat_a',
  'cat_b',
  'cat_c',
  'cat_d',
  'cat_e',
];

interface ExplosionData {
  card: Card;
  deck_size: number;
}

interface FavorData {
  cards: Card[];
  source_player_id: string;
}

interface GameOverData {
  winner_id: string | null;
  winner_name: string | null;
}

interface FutureData {
  cards: Card[];
}

const modalPanel =
  'bg-[#221016]/95 border border-red-500/20 rounded-3xl shadow-2xl backdrop-blur-md animate-slide-up';

const primaryBtn =
  'h-12 px-8 rounded-full font-semibold text-base transition-all active:scale-95';

const AVATAR_BG = [
  'bg-amber-500',
  'bg-pink-600',
  'bg-emerald-500',
  'bg-sky-500',
  'bg-violet-500',
];
const AVATAR_BORDER = [
  'border-amber-300',
  'border-pink-300',
  'border-emerald-300',
  'border-sky-300',
  'border-violet-300',
];

export default function GamePage() {
  const params = useParams();
  const roomCode = (params.room as string).toUpperCase();
  const router = useRouter();

  const [socket, setSocket] = useState<Socket | null>(null);
  const [myPlayerId, setMyPlayerId] = useState('');
  const [myName, setMyName] = useState('');

  const [gameState, setGameState] = useState<ClientGameState | null>(null);
  const [hand, setHand] = useState<Card[]>([]);

  const [selectedCards, setSelectedCards] = useState<string[]>([]);
  const [selectedTarget, setSelectedTarget] = useState<string | null>(null);
  const [namedCardType, setNamedCardType] = useState<CardType | null>(null);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  const [nopeWindow, setNopeWindow] = useState<{
    triggeringPlayer: string;
    cardsPlayed: Card[];
    deadline: number | null;
    mayPass: boolean;
    isActor: boolean;
    eligibleCount: number;
  } | null>(null);
  const [nopePassed, setNopePassed] = useState<string[]>([]);
  const [clockNow, setClockNow] = useState(0);

  const [explosionData, setExplosionData] = useState<ExplosionData | null>(null);
  const [insertIndex, setInsertIndex] = useState(0);

  const [favorData, setFavorData] = useState<FavorData | null>(null);
  const [futureData, setFutureData] = useState<FutureData | null>(null);

  const [gameOverData, setGameOverData] = useState<GameOverData | null>(null);
  const [playerNameMap, setPlayerNameMap] = useState<Record<string, string>>({});
  const lastPromptRef = useRef<string | null>(null);

  const isMyTurn =
    gameState?.currentPlayerId === myPlayerId &&
    gameState?.status === 'in_progress' &&
    !gameState?.pendingAction &&
    !gameState?.pendingPrompt;
  const hasDrawObligation = (gameState?.drawObligations ?? 0) > 0;

  // Connect and set up listeners
  useEffect(() => {
    const stored = localStorage.getItem(`ek_session_${roomCode}`);
    if (!stored) {
      router.push('/');
      return;
    }
    const session = JSON.parse(stored);

    if (!session.playerId || !session.roomCode) {
      router.push('/');
      return;
    }

    setMyPlayerId(session.playerId);
    setMyName(session.playerName || '');

    const s = getSocket();
    if (!s.connected) {
      s.connect();
    }
    setSocket(s);

    const onConnect = () => {
      s.emit('RECONNECT', {
        room_code: session.roomCode,
        player_id: session.playerId,
      });
    };

    if (s.connected) {
      s.emit('RECONNECT', {
        room_code: session.roomCode,
        player_id: session.playerId,
      });
    }

    s.on('connect', onConnect);

    s.on('GAME_STATE_UPDATE', (data: ClientGameState) => {
      setGameState(data);
      const nameMap: Record<string, string> = {};
      data.players.forEach((p) => (nameMap[p.id] = p.name));
      setPlayerNameMap(nameMap);

      if (data.winnerId) {
        setGameOverData({
          winner_id: data.winnerId,
          winner_name: nameMap[data.winnerId] || 'Unknown',
        });
      }
    });

    s.on('PRIVATE_HAND', (data: { hand: Card[] }) => {
      setHand(data.hand);
    });

    s.on(
      'NOPE_WINDOW_OPEN',
      (data: {
        triggering_player: string;
        card_played: Card;
        cards_played?: Card[];
        deadline?: number;
        may_pass?: boolean;
        is_actor?: boolean;
        eligible_count?: number;
      }) => {
        setNopePassed([]);
        setNopeWindow({
          triggeringPlayer: data.triggering_player,
          cardsPlayed: data.cards_played ?? (data.card_played ? [data.card_played] : []),
          deadline: data.deadline ?? null,
          mayPass: !!data.may_pass,
          isActor: !!data.is_actor,
          eligibleCount: data.eligible_count ?? 0,
        });
      }
    );

    s.on('NOPE_PASSED', (data: { player_id: string }) => {
      setNopePassed((prev) =>
        prev.includes(data.player_id) ? prev : [...prev, data.player_id]
      );
    });

    s.on('PRIVATE_FUTURE_VIEW', (data: FutureData) => {
      setFutureData(data);
    });

    s.on('EXPLODED', (data: ExplosionData) => {
      setExplosionData(data);
      setInsertIndex(Math.floor(data.deck_size / 2));
    });

    s.on('FAVOR_REQUEST', (data: FavorData) => {
      setFavorData(data);
    });

    s.on('GAME_OVER', (data: GameOverData) => {
      setGameOverData(data);
    });

    s.on('LEFT_ROOM', () => {
      localStorage.removeItem(`ek_session_${roomCode}`);
      router.push('/');
    });

    s.on('ERROR', (data: { message: string }) => {
      setError(data.message);
      setTimeout(() => setError(''), 4000);
    });

    s.on(
      'ROOM_STATE',
      (data: LobbyState & { room_code: string; player_id: string }) => {
        if (data.status === 'waiting') {
          router.push('/');
        }
      }
    );

    return () => {
      s.off('connect', onConnect);
      s.off('GAME_STATE_UPDATE');
      s.off('PRIVATE_HAND');
      s.off('NOPE_WINDOW_OPEN');
      s.off('NOPE_PASSED');
      s.off('PRIVATE_FUTURE_VIEW');
      s.off('EXPLODED');
      s.off('FAVOR_REQUEST');
      s.off('GAME_OVER');
      s.off('LEFT_ROOM');
      s.off('ERROR');
      s.off('ROOM_STATE');
    };
  }, [router, roomCode]);

  // Close the nope window once the pending action resolves
  useEffect(() => {
    if (nopeWindow && !gameState?.pendingAction) {
      setNopeWindow(null);
    }
  }, [gameState?.pendingAction, nopeWindow]);

  // Local clock ticks to render the server-driven nope countdown
  useEffect(() => {
    if (!nopeWindow?.deadline) return;
    setClockNow(Date.now());
    const t = setInterval(() => setClockNow(Date.now()), 200);
    return () => clearInterval(t);
  }, [nopeWindow?.deadline]);

  // Track prompt transitions so we only close favor/defuse modals once the
// server has actually moved past them (not while the prompt broadcast is
// still in flight — EXPLODED/FAVOR_REQUEST arrive before GAME_STATE_UPDATE).
  useEffect(() => {
    const prompt = gameState?.pendingPrompt ?? null;
    if (prompt !== lastPromptRef.current) {
      if (lastPromptRef.current === 'defuse' && prompt !== 'defuse') {
        setExplosionData(null);
      }
      if (lastPromptRef.current === 'favor' && prompt !== 'favor') {
        setFavorData(null);
      }
      lastPromptRef.current = prompt;
    }
  }, [gameState?.pendingPrompt]);

  const handleCardSelect = (cardId: string) => {
    if (!isMyTurn || !hasDrawObligation) return;

    const card = hand.find((c) => c.id === cardId);
    if (!card) return;
    if (card.type === 'exploding_kitten') return;
    if (card.type === 'defuse') return;

    setSelectedTarget(null);
    setNamedCardType(null);

    setSelectedCards((prev) => {
      if (prev.includes(cardId)) {
        return prev.filter((id) => id !== cardId);
      }

      if (isCatCard(card.type)) {
        const hasOtherSelection = prev.some((id) => {
          const c = hand.find((h) => h.id === id);
          return !c || !isCatCard(c.type) || c.type !== card.type;
        });
        if (hasOtherSelection) return [cardId];

        const sameTypeIds = prev.filter((id) => {
          const c = hand.find((h) => h.id === id);
          return c && c.type === card.type;
        });
        if (sameTypeIds.length >= 3) {
          return [...sameTypeIds.slice(1), cardId];
        }
        return [...prev, cardId];
      }

      return [cardId];
    });
  };

  const handlePlayCards = () => {
    if (!socket || selectedCards.length === 0) return;

    const selectedCardObjects = hand.filter((c) => selectedCards.includes(c.id));
    const firstCard = selectedCardObjects[0];
    const allSameCat =
      selectedCardObjects.length >= 2 &&
      isCatCard(firstCard?.type) &&
      selectedCardObjects.every((c) => c.type === firstCard.type);

    if (allSameCat) {
      if (!selectedTarget) {
        setError('Select a target player');
        setTimeout(() => setError(''), 3000);
        return;
      }

      if (selectedCardObjects.length === 3 && !namedCardType) {
        setError('Select a card type to steal');
        setTimeout(() => setError(''), 3000);
        return;
      }

      socket.emit('PLAY_CARD', {
        card_ids: selectedCards,
        target_player_id: selectedTarget,
        named_card_type:
          selectedCardObjects.length === 3 ? namedCardType : firstCard.type,
      });
      setSelectedCards([]);
      setSelectedTarget(null);
      setNamedCardType(null);
      return;
    }

    socket.emit('PLAY_CARD', {
      card_ids: selectedCards,
      target_player_id: selectedTarget || undefined,
    });
    setSelectedCards([]);
    setSelectedTarget(null);
    setNamedCardType(null);
  };

  const handleDrawCard = () => {
    if (!socket || !isMyTurn || !hasDrawObligation) return;
    socket.emit('DRAW_CARD');
    setSelectedCards([]);
    setSelectedTarget(null);
    setNamedCardType(null);
  };

  const handleNope = (cardId: string) => {
    if (!socket) return;
    socket.emit('PLAY_NOPE', { card_id: cardId });
  };

  const handleResolveNope = () => {
    if (!socket) return;
    socket.emit('RESOLVE_NOPE');
  };

  const handlePassNope = () => {
    if (!socket) return;
    socket.emit('PASS_NOPE');
  };

  const handleDefuse = () => {
    if (!socket || !explosionData) return;
    socket.emit('DEFUSE_BOMB', { insert_index: insertIndex });
    setExplosionData(null);
  };

  const handleFavorChoose = (cardId: string) => {
    if (!socket) return;
    socket.emit('FAVOR_CHOOSE', { card_id: cardId });
    setFavorData(null);
  };

  const handleBackToLobby = () => {
    localStorage.removeItem(`ek_session_${roomCode}`);
    router.push('/');
  };

  const handleLeaveRoom = () => {
    if (!window.confirm('Leave the room?')) return;
    if (socket?.connected) {
      socket.emit('LEAVE_ROOM');
    }
    localStorage.removeItem(`ek_session_${roomCode}`);
    router.push('/');
  };

  const handleCopyCode = () => {
    try {
      navigator.clipboard.writeText(roomCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {}
  };

  const currentPlayerName = gameState?.currentPlayerId
    ? playerNameMap[gameState.currentPlayerId] || '...'
    : '...';

  const selectionCardObjects = hand.filter((c) => selectedCards.includes(c.id));
  const firstSelected = selectionCardObjects[0];
  const isSameCatSelection =
    selectionCardObjects.length >= 2 &&
    isCatCard(firstSelected?.type) &&
    selectionCardObjects.every((c) => c.type === firstSelected.type);
  const selectionNeedsTarget = firstSelected?.type === 'favor' || isSameCatSelection;

  const myNopeCards = hand.filter((c) => c.type === 'nope');
  const amActingInNope = nopeWindow?.triggeringPlayer === myPlayerId;
  const nopeRemainingSec = nopeWindow?.deadline
    ? Math.max(0, Math.ceil((nopeWindow.deadline - clockNow) / 1000))
    : 0;

  const isConnected = socket?.connected ?? false;

  if (!gameState) {
    return (
      <div className="min-h-screen bg-game-bg flex items-center justify-center">
        <div className="animate-fade-in text-center">
          <div className="text-4xl mb-3 animate-pulse">🐱</div>
          <p className="text-gray-400 text-sm font-display">Entering the game...</p>
        </div>
      </div>
    );
  }

  // Fan math for the hand
  const n = hand.length;
  const mid = (n - 1) / 2;
  const spreadDeg = n > 14 ? 2 : n > 10 ? 3 : n > 7 ? 4.5 : 6;
  const overlapStep = n > 14 ? -46 : n > 10 ? -34 : n > 7 ? -22 : -10;

  const statusText = (() => {
    if (gameState.status === 'finished') return '';
    if (gameState.pendingPrompt === 'favor') return 'A favor is being resolved...';
    if (gameState.pendingPrompt === 'defuse') return `${currentPlayerName} is defusing...`;
    if (gameState.pendingAction) return `${currentPlayerName}'s action — anyone can Nope`;
    if (isMyTurn) {
      return hasDrawObligation
        ? `It's your turn — draw ${gameState.drawObligations} card${gameState.drawObligations > 1 ? 's' : ''}`
        : 'Pick a card to play';
    }
    return `Waiting for ${currentPlayerName}...`;
  })();

  const canDrawNow =
    isMyTurn &&
    hasDrawObligation &&
    selectedCards.length === 0 &&
    !nopeWindow &&
    !explosionData &&
    !favorData &&
    !gameState?.pendingPrompt;

  const opponents = gameState.players.filter((p) => p.id !== myPlayerId);
  const myPlayer = gameState.players.find((p) => p.id === myPlayerId);

  const seatClasses = [
    'absolute top-1 sm:top-2 left-1/2 -translate-x-1/2 z-20',
    'absolute left-[2%] sm:left-5 top-1/2 -translate-y-1/2 z-20',
    'absolute right-[2%] sm:right-5 top-1/2 -translate-y-1/2 z-20',
    'absolute top-3 left-[16%] sm:left-[22%] z-20',
    'absolute top-3 right-[16%] sm:right-[22%] z-20',
  ];
  const horizontalSeats = [0, 3, 4];

  const renderCardBacks = (count: number, vertical: boolean) => {
    const clamped = Math.max(0, Math.min(6, count));
    const rotsH = [-14, -9, -4, -1, 1, 4, 9, 14];
    const rotsV = [12, 7, 2, -2, -7, -12];
    const backs = [];
    for (let i = 0; i < clamped; i++) {
      const rot = vertical ? rotsV[i % rotsV.length] : rotsH[i % rotsH.length];
      backs.push(
        <div
          key={i}
          className="card-back w-8 h-12 sm:w-9 sm:h-14 rounded-lg shadow-lg"
          style={{ transform: `rotate(${rot}deg)` }}
        >
          <span className="text-[8px]">🐱</span>
        </div>
      );
    }
    return backs;
  };

  return (
    <div className="h-screen w-full flex flex-col overflow-hidden bg-game-bg text-white relative font-sans select-none">
      {/* Ambient lamp glow */}
      <div className="lamp-glow absolute top-[-6%] right-[10%] w-[70vw] max-w-[560px] h-[60vh] max-h-[560px] pointer-events-none z-[5]" />

      {/* Error toast */}
      {error && (
        <div className="fixed top-16 left-1/2 -translate-x-1/2 z-[100] bg-rose-950/90 border border-rose-500/40 rounded-full px-5 py-2 text-sm text-rose-200 animate-fade-in shadow-xl">
          {error}
        </div>
      )}

      {/* ===== Top navigation ===== */}
      <header className="relative z-40 w-full px-4 sm:px-6 py-3 flex items-center justify-between border-b border-white/5 bg-black/40 backdrop-blur-md gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-full bg-gradient-to-tr from-amber-500 to-yellow-400 p-0.5 shadow-md flex items-center justify-center flex-none">
            <svg className="w-6 h-6 sm:w-7 sm:h-7 text-amber-950 fill-current" viewBox="0 0 24 24">
              <path d="M12 2C6.48 2 2 6.48 2 12c0 2.85 1.2 5.42 3.12 7.24L4 21l3.5-1.5c1.37.95 3.03 1.5 4.5 1.5 5.52 0 10-4.48 10-10S17.52 2 12 2zm-5 7c.83 0 1.5.67 1.5 1.5S7.83 12 7 12s-1.5-.67-1.5-1.5S6.17 9 7 9zm10 0c.83 0 1.5.67 1.5 1.5s-.67 1.5-1.5 1.5-1.5-.67-1.5-1.5.67-1.5 1.5-1.5zm-5 8c-2.33 0-4.31-1.46-5.11-3.5h10.22c-.8 2.04-2.78 3.5-5.11 3.5z" />
            </svg>
          </div>
          <div className="min-w-0">
            <h1 className="font-display font-extrabold text-lg sm:text-2xl tracking-tight text-white uppercase drop-shadow leading-none truncate">
              Exploding <span className="text-card-nope">Kittens</span>
            </h1>
            <span className="text-[10px] tracking-widest text-amber-400/80 uppercase font-mono block">
              Multiplayer Live
            </span>
          </div>
        </div>

        {/* Room code badge */}
        <div className="flex items-center gap-2 bg-white/5 border border-amber-500/40 rounded-xl px-2.5 sm:px-5 py-2 shadow-inner flex-none">
          <span className="text-[10px] sm:text-xs uppercase font-semibold text-gray-400 tracking-wider hidden sm:inline">
            Room Code:
          </span>
          <span className="font-mono font-black tracking-widest text-amber-400 text-base sm:text-lg">
            {roomCode}
          </span>
          <button
            onClick={handleCopyCode}
            title="Copy Room Code"
            className="text-amber-300/70 hover:text-amber-200 transition-colors p-1 rounded hover:bg-white/5"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
              />
            </svg>
          </button>
          {copied && <span className="text-[10px] text-emerald-400 font-bold">Copied!</span>}
        </div>

        {/* Profile + exit */}
        <div className="flex items-center gap-3 flex-none">
          <div className="flex items-center gap-2.5 bg-black/30 border border-white/10 px-3 py-1.5 rounded-full">
            <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-full bg-amber-400 border-2 border-amber-300 flex items-center justify-center text-amber-950 font-bold text-xs sm:text-sm shadow-md">
              🐱
            </div>
            <div className="text-left hidden md:block">
              <span className="text-xs font-bold text-white block leading-tight">
                {myName} <span className="text-white/50">(You)</span>
              </span>
              <span
                className={`text-[10px] font-medium leading-none flex items-center gap-1 ${
                  isConnected ? 'text-emerald-400' : 'text-amber-400'
                }`}
              >
                <span className="w-1.5 h-1.5 rounded-full bg-current inline-block" />
                {isConnected ? 'Online' : 'Connecting...'}
              </span>
            </div>
          </div>
          <button
            onClick={handleLeaveRoom}
            className="flex items-center gap-2 px-3 sm:px-4 py-2 rounded-full border border-red-500/40 bg-red-950/50 hover:bg-red-900/70 text-red-300 text-xs font-bold tracking-wide transition shadow"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
              />
            </svg>
            <span>Exit</span>
          </button>
        </div>
      </header>

      {/* ===== Game arena ===== */}
      <main className="relative flex-1 flex items-center justify-center min-h-0 p-2 sm:p-4 overflow-hidden">
        {/* Lamp fixture */}
        <div className="absolute top-2 right-20 hidden lg:block opacity-75 pointer-events-none z-20">
          <svg className="w-28 h-28 text-amber-500/80" fill="currentColor" viewBox="0 0 100 100">
            <path d="M50 0 L52 30 L75 55 L25 55 L48 30 Z" opacity="0.8" />
            <ellipse cx="50" cy="55" fill="#ffb03a" rx="25" ry="8" />
          </svg>
        </div>

        {/* Handwritten notes */}
        <div className="absolute left-5 top-5 hidden md:block -rotate-[8deg] bg-amber-100/10 border border-white/10 p-3 rounded shadow-lg backdrop-blur-sm text-center z-20 pointer-events-none">
          <p className="font-handwriting text-pink-300 text-xl font-bold leading-tight">
            GOOD<br />KITTENS.<br />BAD LUCK.
          </p>
        </div>
        <div className="absolute right-6 top-8 hidden md:block rotate-[6deg] bg-amber-100/10 border border-white/10 p-3 rounded shadow-lg backdrop-blur-sm text-center z-20 pointer-events-none">
          <p className="font-handwriting text-pink-300 text-xl font-bold leading-tight">
            SAME<br />KITTENS.<br />DIFFERENT<br />VICTIMS.
          </p>
        </div>

        {/* Status chip */}
        <div className="absolute top-1 left-1/2 -translate-x-1/2 z-30 max-w-[90vw]">
          <p className="text-[11px] sm:text-xs text-gray-300 text-center bg-black/40 px-4 py-1 rounded-full border border-white/5 backdrop-blur-sm truncate">
            {statusText}
          </p>
        </div>

        {/* Poker table */}
        <div className="poker-table relative w-full max-w-6xl h-[60vh] max-h-[540px] min-h-[320px] flex items-center justify-center mx-auto shadow-2xl">
          {/* Opponents */}
          {opponents.map((p, idx) => {
            const isCurrent = gameState.currentPlayerId === p.id;
            const isOut = !p.alive;
            const vertical = !horizontalSeats.includes(idx);
            const targetable = selectionNeedsTarget && p.alive;
            const avatarCls = AVATAR_BG[idx % AVATAR_BG.length];
            const borderCls = AVATAR_BORDER[idx % AVATAR_BORDER.length];
            const ringCls =
              isCurrent || selectedTarget === p.id
                ? 'ring-2 ring-amber-300'
                : targetable
                  ? 'ring-1 ring-white/30 hover:ring-amber-300'
                  : '';

            return (
              <div
                key={p.id}
                className={`${seatClasses[idx % seatClasses.length]} flex flex-col items-center ${
                  isOut ? 'opacity-35 grayscale' : ''
                } ${targetable ? 'cursor-pointer' : ''}`}
                onClick={targetable ? () => setSelectedTarget(p.id) : undefined}
              >
                {vertical ? (
                  <div className="flex flex-row items-center gap-2 sm:gap-3">
                    <div className="flex flex-col items-center text-center bg-black/50 border border-white/10 p-2 rounded-2xl backdrop-blur-sm shadow-lg">
                      <div
                        className={`relative w-9 h-9 sm:w-10 sm:h-10 rounded-full ${avatarCls} ${borderCls} border-2 flex items-center justify-center font-bold text-sm sm:text-base text-white shadow-md ${ringCls}`}
                      >
                        {p.name.charAt(0).toUpperCase()}
                        {isCurrent && <span className="absolute -top-2 -right-2 text-xs">👑</span>}
                      </div>
                      <span
                        className={`text-xs font-bold mt-1.5 ${
                          isCurrent ? 'text-amber-300' : 'text-gray-200'
                        }`}
                      >
                        {p.name}
                      </span>
                      <span className="text-[10px] text-gray-400 block">
                        {isOut ? 'out' : `${p.cardCount} cards`}
                      </span>
                    </div>
                    <div className="flex flex-col -space-y-8">
                      {renderCardBacks(p.cardCount, true)}
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col items-center">
                    <div className="relative flex items-center gap-2 bg-black/60 px-3 sm:px-4 py-1.5 rounded-full border border-white/10 shadow-lg backdrop-blur-md">
                      <div
                        className={`relative w-7 h-7 sm:w-8 sm:h-8 rounded-full ${avatarCls} ${borderCls} border-2 flex items-center justify-center font-black text-xs sm:text-sm text-white shadow ${ringCls}`}
                      >
                        {p.name.charAt(0).toUpperCase()}
                      </div>
                      <span
                        className={`text-xs font-bold block leading-tight hidden sm:block ${
                          isCurrent ? 'text-amber-300' : 'text-gray-100'
                        }`}
                      >
                        {p.name}
                      </span>
                      <span className="text-[10px] text-gray-400 block leading-none hidden sm:block">
                        {isOut ? 'out' : `${p.cardCount} cards`}
                      </span>
                      {isCurrent && <span className="absolute -top-1 right-0 text-xs">👑</span>}
                    </div>
                    <div className="flex items-center -space-x-5 mt-2">
                      {renderCardBacks(p.cardCount, false)}
                    </div>
                  </div>
                )}
              </div>
            );
          })}

          {/* Deck + discard */}
          <div className="flex items-center gap-8 sm:gap-16 relative z-20 my-auto">
            <div className="absolute -left-24 top-6 hidden sm:flex flex-col items-end pointer-events-none">
              <span className="font-handwriting text-rose-300 text-2xl font-bold -rotate-12 drop-shadow">
                Draw<br />Card!
              </span>
              <svg
                className="w-8 h-8 text-rose-300 -rotate-45 -mt-1 mr-1"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  d="M14 5l7 7m0 0l-7 7m7-7H3"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2.5"
                />
              </svg>
            </div>

            <div className="flex flex-col items-center">
              <div
                className={`relative group ${
                  canDrawNow
                    ? 'cursor-pointer hover:scale-105 transition-transform duration-200'
                    : 'cursor-default'
                }`}
                onClick={canDrawNow ? handleDrawCard : undefined}
              >
                <div className="absolute inset-0 translate-y-4 translate-x-1 bg-rose-950 rounded-xl border border-black/40 shadow-2xl" />
                <div className="absolute inset-0 translate-y-3 translate-x-0.5 bg-rose-900 rounded-xl border border-black/30 shadow-xl" />
                <div className="absolute inset-0 translate-y-1.5 bg-red-900 rounded-xl shadow-lg" />
                <div className="relative w-24 h-36 sm:w-32 sm:h-44 rounded-xl bg-gradient-to-b from-neutral-900 via-neutral-900 to-black border-2 border-red-500/60 p-2.5 shadow-2xl flex flex-col justify-between items-center text-center">
                  <span className="absolute -top-3 -right-3 bg-neutral-900 text-amber-300 border-2 border-amber-400 text-xs font-black w-8 h-8 rounded-full flex items-center justify-center shadow-lg">
                    {gameState.deckCount}
                  </span>
                  <span className="text-[10px] font-extrabold text-red-500 tracking-wider uppercase mt-1 leading-tight">
                    Exploding<br />
                    <span className="text-white">Kittens</span>
                  </span>
                  <div className="my-auto text-2xl sm:text-3xl filter drop-shadow">💣🐱</div>
                  <div className="w-full bg-red-600/30 rounded py-1 border border-red-500/40">
                    <span className="text-[9px] sm:text-[10px] uppercase tracking-widest font-black text-red-300 block">
                      DECK
                    </span>
                  </div>
                </div>
              </div>
              <span className="text-xs font-black tracking-widest text-white/50 uppercase mt-5">
                DECK
              </span>
            </div>

            <div className="flex flex-col items-center">
              {gameState.discardTop ? (
                <div className="relative">
                  <GameCard card={gameState.discardTop} small />
                  {gameState.discardCount > 0 && (
                    <span className="absolute -top-2 -right-2 bg-neutral-900 text-amber-300 border border-amber-400/60 text-[10px] font-black w-6 h-6 rounded-full flex items-center justify-center shadow-lg">
                      {gameState.discardCount}
                    </span>
                  )}
                </div>
              ) : (
                <div className="relative w-24 h-36 sm:w-32 sm:h-44 rounded-xl border-2 border-dashed border-white/20 bg-black/30 backdrop-blur-sm flex flex-col items-center justify-center p-3 text-center shadow-inner">
                  <div className="w-10 h-10 rounded-full bg-white/5 border border-white/10 flex items-center justify-center mb-2">
                    <svg className="w-6 h-6 text-white/30" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 14h-2v-2h2v2zm0-4h-2V7h2v5z" />
                    </svg>
                  </div>
                  <span className="text-[10px] font-medium text-white/40 leading-tight">
                    No card played yet
                  </span>
                </div>
              )}
              <span className="text-xs font-black tracking-widest text-white/50 uppercase mt-5">
                DISCARD
              </span>
            </div>

            <div className="absolute -right-24 top-8 hidden sm:flex flex-col items-start pointer-events-none">
              <span className="font-handwriting text-rose-300 text-2xl font-bold rotate-6 drop-shadow">
                Play<br />Smart...
              </span>
              <svg
                className="w-8 h-8 text-rose-300 rotate-45 -mt-1 ml-1"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  d="M10 19l-7-7m0 0l7-7m-7 7h18"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2.5"
                />
              </svg>
            </div>
          </div>

          {/* My player tag above hand */}
          {myPlayer && (
            <div className="absolute bottom-2 sm:bottom-3 left-1/2 -translate-x-1/2 flex flex-col items-center z-20">
              <div className="flex items-center gap-2.5 bg-black/60 backdrop-blur-md px-3 sm:px-4 py-1.5 rounded-full border border-amber-500/50 shadow-lg">
                <div className="w-7 h-7 rounded-full bg-amber-500 text-slate-950 font-black text-xs flex items-center justify-center shadow">
                  {myPlayer.name.charAt(0).toUpperCase()}
                  {isMyTurn && <span className="text-[9px] ml-0.5">👑</span>}
                </div>
                <div className="text-left">
                  <span className="text-xs font-bold text-amber-300 block leading-tight">
                    {myName} <span className="text-white/50">(You)</span>
                  </span>
                  <span className="text-[10px] text-gray-300 block -mt-0.5">
                    {hand.length} card{hand.length !== 1 ? 's' : ''} in hand
                  </span>
                </div>
              </div>
            </div>
          )}
        </div>
      </main>

      {/* ===== Bottom hand area ===== */}
      <footer className="relative z-30 pb-3 sm:pb-4 pt-1 px-3 sm:px-4 w-full flex flex-col items-center">
        <div className="w-full max-w-7xl mx-auto flex flex-col items-center relative px-4 sm:px-6">
          {/* Cat triple: name a card type to steal */}
          {isSameCatSelection && selectionCardObjects.length === 3 && isMyTurn && (
            <div className="flex flex-wrap justify-center gap-1.5 max-w-xl animate-fade-in mb-1">
              {ALL_CARD_TYPES.map((t) => (
                <button
                  key={t}
                  onClick={() => setNamedCardType(t)}
                  className={`px-2.5 py-1 rounded-full text-[11px] font-medium border transition-colors ${
                    namedCardType === t
                      ? 'bg-card-nope/80 border-card-nope/60 text-white'
                      : 'bg-white/5 border-white/10 text-gray-300 hover:bg-white/10'
                  }`}
                >
                  {getCardInfo(t).label}
                </button>
              ))}
            </div>
          )}

          {/* Fan dock */}
          <div className="relative w-full flex items-end justify-center pb-2">
            {isMyTurn && !gameState.pendingAction && (
              <div className="absolute -top-4 left-1/2 -translate-x-1/2 z-40 pointer-events-none text-[11px] font-semibold text-amber-200 bg-amber-400/15 border border-amber-300/30 rounded-full px-3 py-1 animate-fade-in">
                ● Your turn
              </div>
            )}
            <div className="flex items-end justify-center overflow-x-auto rounded-2xl bg-black/25 border border-white/5 backdrop-blur-sm py-2 min-h-[170px] w-full">
              <div className="flex items-end px-8">
                {hand.map((card, i) => {
                  const angle = (i - mid) * spreadDeg;
                  const lift = Math.abs(i - mid) * 6;
                  const fanStyle = {
                    marginLeft: i === 0 ? 0 : overlapStep,
                    '--rot': `${angle}deg`,
                    '--lift': `${lift}px`,
                    '--zi': String(i + 1),
                    '--sel': selectedCards.includes(card.id) ? '-26px' : '0px',
                  } as CSSProperties;
                  return (
                    <GameCard
                      key={card.id}
                      card={card}
                      className="ek-fan"
                      style={fanStyle}
                      selected={selectedCards.includes(card.id)}
                      disabled={
                        !isMyTurn ||
                        card.type === 'exploding_kitten' ||
                        card.type === 'defuse' ||
                        !hasDrawObligation ||
                        !!explosionData ||
                        !!favorData ||
                        !!gameState?.pendingPrompt ||
                        !!nopeWindow
                      }
                      onClick={() => handleCardSelect(card.id)}
                    />
                  );
                })}
                {hand.length === 0 && (
                  <div className="text-center text-gray-500 py-8">
                    <p className="text-3xl mb-2">🫙</p>
                    <p className="text-sm">No cards in hand</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Floating action controls */}
        <div className="absolute right-2 sm:right-6 bottom-2 sm:bottom-3 flex items-center gap-3 z-40">
          {gameState.status === 'in_progress' && (
            <div
              className={`inline-flex items-center gap-2.5 bg-black/70 border rounded-full px-4 py-2 shadow-xl backdrop-blur-sm ${
                isMyTurn ? 'border-emerald-500/40' : 'border-white/10'
              }`}
            >
              {isMyTurn ? (
                <>
                  <span className="relative w-3 h-3 flex">
                    <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75 animate-ping" />
                    <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500" />
                  </span>
                  <span className="text-xs font-bold text-white tracking-wide uppercase">
                    Your Turn
                  </span>
                </>
              ) : (
                <span className="text-xs font-bold text-gray-300 tracking-wide">
                  Waiting for {currentPlayerName}...
                </span>
              )}
            </div>
          )}

          {canDrawNow && (
            <button
              onClick={handleDrawCard}
              className="relative group bg-gradient-to-r from-amber-400 via-amber-500 to-yellow-500 hover:from-amber-300 hover:to-amber-400 text-amber-950 font-black px-6 sm:px-7 py-3 rounded-2xl shadow-2xl border-b-4 border-amber-700 active:border-b-0 active:translate-y-1 transition-all flex items-center gap-3 cursor-pointer"
            >
              <svg className="w-5 h-5 fill-current" viewBox="0 0 24 24">
                <path d="M4 6H2v14c0 1.1.9 2 2 2h14v-2H4V6zm16-4H8c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H8V4h12v12z" />
              </svg>
              <span className="text-sm sm:text-base tracking-wider uppercase font-black">
                Draw {gameState.drawObligations > 1 ? `${gameState.drawObligations} ` : ''}Cards
              </span>
            </button>
          )}

          {selectedCards.length > 0 && isMyTurn && (
            <div className="flex flex-col sm:flex-row items-center gap-2">
              {selectionNeedsTarget && !selectedTarget && (
                <span className="text-xs text-amber-200/90 animate-pulse text-center">
                  ← tap a player to target →
                </span>
              )}
              <button
                onClick={handlePlayCards}
                disabled={selectionNeedsTarget && !selectedTarget}
                className="bg-gradient-to-r from-rose-500 via-card-nope to-rose-500 hover:brightness-110 text-white font-black px-7 py-3 rounded-2xl shadow-2xl border-b-4 border-[#8a0f24] active:border-b-0 active:translate-y-1 transition-all flex items-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <span>▶</span>
                <span className="text-sm sm:text-base tracking-wider uppercase">
                  Play {selectedCards.length > 1 ? `${selectedCards.length} Cards` : 'Card'}
                </span>
              </button>
            </div>
          )}
        </div>
      </footer>

      {/* ===== Nope window ===== */}
      {nopeWindow && (
        <div className="fixed inset-0 bg-black/60 z-[80] flex items-center justify-center p-4 backdrop-blur-sm animate-fade-in">
          <div className={`${modalPanel} p-7 max-w-md w-full text-center`}>
            <h2 className="text-xl font-bold mb-1">
              {amActingInNope ? 'Your action — anyone can Nope' : 'Nope window'}
            </h2>
            <p className="text-sm text-slate-400 mb-5">
              <span className="text-slate-100 font-medium">
                {playerNameMap[nopeWindow.triggeringPlayer] || 'Someone'}
              </span>{' '}
              played {nopeWindow.cardsPlayed.map((c) => getCardInfo(c.type).label).join(' + ')}
            </p>

            {nopeWindow.deadline ? (
              <p className="text-2xl font-bold tabular-nums my-2">
                ⏱ {nopeRemainingSec}s
              </p>
            ) : (
              <p className="text-xs text-slate-500 italic my-2">No one can Nope</p>
            )}

            <div className="flex justify-center gap-3 mb-6">
              {nopeWindow.cardsPlayed.map((c) => (
                <GameCard key={c.id} card={c} small />
              ))}
            </div>

            <div className="space-y-2">
              {myNopeCards.length > 0 && (
                <>
                  <p className="text-xs text-slate-500 uppercase tracking-widest">
                    Play a Nope to cancel
                  </p>
                  {myNopeCards.map((card) => (
                    <button
                      key={card.id}
                      onClick={() => handleNope(card.id)}
                      className="w-full bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl p-2.5 flex items-center justify-center gap-3 transition-colors"
                    >
                      <GameCard card={card} small />
                      <span className="font-medium text-sm">Play Nope</span>
                    </button>
                  ))}
                </>
              )}

              {nopeWindow.mayPass && (
                <>
                  <button
                    onClick={handlePassNope}
                    disabled={
                      !nopeWindow.deadline || nopePassed.includes(myPlayerId ?? '')
                    }
                    className={`${primaryBtn} w-full bg-slate-100 text-slate-900 hover:bg-white mt-3 disabled:opacity-40 disabled:cursor-not-allowed`}
                  >
                    {nopePassed.includes(myPlayerId ?? '')
                      ? '✓ You passed'
                      : '✋ Pass — I have no Nope'}
                  </button>
                  <p className="text-xs text-slate-500">
                    You may also play a Nope above, or the action resolves in{' '}
                    {nopeRemainingSec}s.
                  </p>
                </>
              )}

              {amActingInNope && !nopeWindow.deadline ? (
                <button
                  onClick={handleResolveNope}
                  className={`${primaryBtn} w-full bg-emerald-400 text-black shadow-[0_8px_24px_rgba(52,211,153,0.3)] hover:bg-emerald-300 mt-3`}
                >
                  ✓ I'm done — resolve
                </button>
              ) : !amActingInNope && !nopeWindow.mayPass ? (
                <p className="text-xs text-slate-500 pt-3">
                  Waiting for{' '}
                  {nopeWindow.eligibleCount > 0
                    ? `${nopeWindow.eligibleCount} player${nopeWindow.eligibleCount === 1 ? '' : 's'}`
                    : playerNameMap[nopeWindow.triggeringPlayer] || 'their'}{' '}
                  to Nope or pass...
                </p>
              ) : null}
            </div>
          </div>
        </div>
      )}

      {/* ===== Explosion ===== */}
      {explosionData && (
        <div className="fixed inset-0 bg-black/70 z-[90] flex items-center justify-center p-4 backdrop-blur-sm animate-fade-in">
          <div className={`${modalPanel} p-7 max-w-lg w-full`}>
            <div className="text-center mb-5">
              <div className="text-5xl mb-2">💥</div>
              <h2 className="text-2xl font-bold">You drew an Exploding Kitten!</h2>
              <p className="text-sm text-slate-400 mt-1">
                Place the kitten back into the deck, then defuse it.
              </p>
            </div>

            <div className="flex items-center justify-center gap-6 mb-6">
              <GameCard card={explosionData.card} small />
              <div className="flex-1 max-w-xs">
                <div className="flex justify-between text-xs text-slate-500 mb-1.5">
                  <span>Top</span>
                  <span className="text-slate-300 font-mono">pos {insertIndex}</span>
                  <span>Bottom</span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={explosionData.deck_size}
                  value={insertIndex}
                  onChange={(e) => setInsertIndex(parseInt(e.target.value))}
                  className="w-full accent-amber-400"
                />
                <div className="text-[10px] text-slate-600 mt-1 text-center">
                  {explosionData.deck_size} cards in deck
                </div>
              </div>
            </div>

            <button
              onClick={handleDefuse}
              className={`${primaryBtn} w-full bg-emerald-400 text-black shadow-[0_8px_24px_rgba(52,211,153,0.3)] hover:bg-emerald-300`}
            >
              🛡️ Defuse
            </button>
          </div>
        </div>
      )}

      {/* ===== Favor ===== */}
      {favorData && (
        <div className="fixed inset-0 bg-black/60 z-[90] flex items-center justify-center p-4 backdrop-blur-sm animate-fade-in">
          <div className={`${modalPanel} p-7 max-w-lg w-full`}>
            <h2 className="text-xl font-bold text-center mb-1">🎁 Favor</h2>
            <p className="text-center text-sm text-slate-400 mb-5">
              Give a card to{' '}
              <span className="text-slate-100 font-medium">
                {playerNameMap[favorData.source_player_id] || 'them'}
              </span>
            </p>
            <div className="grid grid-cols-3 gap-3 justify-items-center">
              {favorData.cards.map((card) => (
                <GameCard key={card.id} card={card} onClick={() => handleFavorChoose(card.id)} />
              ))}
            </div>
            {favorData.cards.length === 0 && (
              <p className="text-center text-slate-500 py-6 text-sm">No cards to give</p>
            )}
          </div>
        </div>
      )}

      {/* ===== See the Future ===== */}
      {futureData && (
        <div className="fixed inset-0 bg-black/60 z-[90] flex items-center justify-center p-4 backdrop-blur-sm animate-fade-in">
          <div className={`${modalPanel} p-7 max-w-lg w-full`}>
            <h2 className="text-xl font-bold text-center mb-1">🔮 See the Future</h2>
            <p className="text-center text-sm text-slate-400 mb-5">Top 3 cards of the deck</p>
            <div className="flex justify-center gap-4 mb-6">
              {futureData.cards.map((card, i) => (
                <div key={card.id} className="text-center">
                  <GameCard card={card} />
                  <p className="text-xs text-slate-500 mt-2">#{i + 1}</p>
                </div>
              ))}
            </div>
            <button
              onClick={() => setFutureData(null)}
              className={`${primaryBtn} w-full bg-white/10 text-white hover:bg-white/15`}
            >
              Close
            </button>
          </div>
        </div>
      )}

      {/* ===== Game over ===== */}
      {gameOverData && (
        <div className="fixed inset-0 bg-black/75 z-[95] flex items-center justify-center p-4 backdrop-blur-sm animate-fade-in">
          <div className={`${modalPanel} p-9 max-w-md w-full text-center`}>
            <div className="text-6xl mb-3">🏆</div>
            <h2 className="text-3xl font-bold mb-1">
              {gameOverData.winner_id === myPlayerId ? 'You win!' : 'Game over'}
            </h2>
            <p className="text-amber-300 font-semibold mb-7">
              {gameOverData.winner_name} wins
            </p>
            <button
              onClick={handleBackToLobby}
              className={`${primaryBtn} w-full bg-amber-400 text-black hover:bg-amber-300`}
            >
              Back to lobby
            </button>
          </div>
        </div>
      )}
    </div>
  );
}