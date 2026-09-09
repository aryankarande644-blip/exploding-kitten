'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { CSSProperties } from 'react';
import { getSocket } from '@/lib/socket';
import { Socket } from 'socket.io-client';
import { Card, CardType, ClientGameState, LobbyState } from '@/lib/types';
import { GameCard, CardBack, FaceDownCard } from '@/components/Card';
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
  'bg-[#171c30]/95 border border-white/10 rounded-3xl shadow-2xl backdrop-blur-sm animate-slide-up';

const primaryBtn =
  'h-12 px-8 rounded-full font-semibold text-base transition-all active:scale-95';

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

  if (!gameState) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-fade-in text-center">
          <div className="text-4xl mb-3 animate-pulse">🐱</div>
          <p className="text-slate-400 text-sm">Entering the game...</p>
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

  return (
    <div className="h-screen w-full flex flex-col overflow-hidden bg-gradient-to-b from-[#161b2e] to-[#0b0e18] text-slate-100 relative">
      {/* Error toast */}
      {error && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[100] bg-rose-950/90 border border-rose-700/50 rounded-full px-5 py-2 text-sm text-rose-200 animate-fade-in shadow-xl">
          {error}
        </div>
      )}

      {/* Top bar */}
      <header className="flex items-center justify-between px-5 py-2.5 border-b border-white/5 z-30">
        <span className="font-mono text-sm tracking-[0.25em] text-amber-300/90">{roomCode}</span>
        <div className="flex items-center gap-3">
          <span className="text-xs text-slate-400 hidden sm:inline">{myName}</span>
          <button
            onClick={handleLeaveRoom}
            className="text-xs px-3 py-1.5 rounded-full border border-white/15 text-slate-300 hover:bg-white/10 hover:text-white transition-colors"
          >
            Exit
          </button>
        </div>
      </header>

      {/* All player seats (opponents + you) */}
      <section className="flex justify-center gap-2 px-6 pt-3 pb-1 z-20">
        {gameState.players.map((p) => {
          const isCurrent = gameState.currentPlayerId === p.id;
          const isMe = p.id === myPlayerId;
          const targetable = selectionNeedsTarget && p.alive && !isMe;
          return (
            <button
              key={p.id}
              onClick={targetable ? () => setSelectedTarget(p.id) : undefined}
              className={`group flex flex-col items-center gap-1.5 rounded-2xl px-4 py-2.5 w-24 transition-all ${
                !p.alive && 'opacity-35 grayscale'
              } ${targetable ? 'cursor-pointer hover:bg-white/5' : 'cursor-default'} ${
                selectedTarget === p.id
                  ? 'bg-white/5 ring-2 ring-amber-300/80'
                  : targetable
                    ? 'ring-1 ring-white/10 hover:ring-amber-300/40'
                    : ''
              }`}
            >
              <div
                className={`relative flex items-center justify-center rounded-full font-bold border-2 transition-all ${
                  p.alive
                    ? 'bg-gradient-to-br from-amber-500/90 to-orange-600/90 border-amber-200/30 text-white'
                    : 'bg-slate-800 border-white/10 text-slate-500'
                } ${isCurrent ? 'ring-2 ring-amber-300' : ''} ${
                  selectedTarget === p.id ? 'ring-2 ring-amber-300' : ''
                } ${isMe ? 'ring-2 ring-sky-400/70' : ''}`}
                style={{ width: 48, height: 48 }}
              >
                {p.name.charAt(0).toUpperCase()}
                {isCurrent && (
                  <span className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-1.5 h-1.5 rounded-full bg-amber-300" />
                )}
              </div>
              <span className="text-xs text-slate-300 max-w-full truncate">
                {p.name}
                {isMe && <span className="text-sky-300 ml-1">(You)</span>}
              </span>
              <span className="text-[10px] text-slate-500">
                {p.alive ? `${p.cardCount} card${p.cardCount !== 1 ? 's' : ''}` : 'out'}
              </span>
            </button>
          );
        })}
      </section>

      {/* Table: deck + discard */}
      <main className="relative flex-1 flex flex-col items-center justify-center gap-6 min-h-0 px-6 z-10">
        <div className="flex items-start gap-16">
          <div className="flex flex-col items-center gap-2.5">
            <div className="relative">
              <CardBack />
              <span className="absolute -top-2 -right-2 min-w-6 h-6 px-1 rounded-full bg-slate-900/90 border border-white/15 text-[11px] flex items-center justify-center font-semibold text-amber-200/90">
                {gameState.deckCount}
              </span>
            </div>
            <span className="text-[10px] uppercase tracking-[0.2em] text-slate-500">Deck</span>
          </div>

          <div className="flex flex-col items-center gap-2.5">
            {gameState.discardTop ? (
              <GameCard card={gameState.discardTop} small />
            ) : (
              <FaceDownCard small />
            )}
            <span className="text-[10px] uppercase tracking-[0.2em] text-slate-500">
              Discard{gameState.discardCount > 0 ? ` · ${gameState.discardCount}` : ''}
            </span>
          </div>
        </div>
      </main>

      {/* HUD: status + primary action */}
      <section className="relative z-20 flex flex-col items-center gap-2 px-6 pb-3">
        <p className="text-center text-sm text-slate-400 min-h-[18px]">{statusText}</p>

        <div className="flex items-center gap-3 min-h-[46px]">
          {isMyTurn && hasDrawObligation && selectedCards.length === 0 && (
            <button
              onClick={handleDrawCard}
              className={`${primaryBtn} bg-amber-400 text-black shadow-[0_8px_24px_rgba(251,191,36,0.35)] hover:bg-amber-300`}
            >
              Draw {gameState.drawObligations > 1 ? `${gameState.drawObligations} ` : ''}Cards
            </button>
          )}

          {selectedCards.length > 0 && isMyTurn && (
            <>
              {selectionNeedsTarget && !selectedTarget && (
                <span className="text-xs text-amber-200/90 animate-pulse">
                  ← tap a player to target →
                </span>
              )}
              <button
                onClick={handlePlayCards}
                disabled={selectionNeedsTarget && !selectedTarget}
                className={`${primaryBtn} bg-indigo-400 text-white shadow-[0_8px_24px_rgba(99,102,241,0.35)] hover:bg-indigo-300 disabled:opacity-40 disabled:cursor-not-allowed`}
              >
                Play {selectedCards.length > 1 ? `${selectedCards.length} Cards` : 'Card'}
              </button>
            </>
          )}
        </div>

        {/* Cat triple: name a card type to steal */}
        {isSameCatSelection && selectionCardObjects.length === 3 && isMyTurn && (
          <div className="flex flex-wrap justify-center gap-1.5 max-w-xl animate-fade-in">
            {ALL_CARD_TYPES.map((t) => (
              <button
                key={t}
                onClick={() => setNamedCardType(t)}
                className={`px-2.5 py-1 rounded-full text-[11px] font-medium border transition-colors ${
                  namedCardType === t
                    ? 'bg-indigo-500/80 border-indigo-300/60 text-white'
                    : 'bg-white/5 border-white/10 text-slate-300 hover:bg-white/10'
                }`}
              >
                {getCardInfo(t).label}
              </button>
            ))}
          </div>
        )}
      </section>

      {/* Hand dock at bottom center */}
      <section className="relative z-30 px-6 pt-4 pb-6">
        {isMyTurn && (
          <div className="absolute -top-0 left-1/2 -translate-x-1/2 z-40 pointer-events-none text-[11px] font-semibold text-amber-200 bg-amber-400/15 border border-amber-300/30 rounded-full px-3 py-1 animate-fade-in">
            ● Your turn
          </div>
        )}
        <div className="flex justify-center overflow-x-auto rounded-2xl bg-black/20 border border-white/5 backdrop-blur-sm py-2">
          <div className="flex items-end px-8">
            {hand.map((card, i) => {
              const angle = (i - mid) * spreadDeg;
              const lift = Math.abs(i - mid) * 6;
              const fanStyle = {
                marginLeft: i === 0 ? 0 : overlapStep,
                '--rot': `${angle}deg`,
                '--lift': `${lift}px`,
                '--zi': String(i + 1),
                '--sel': selectedCards.includes(card.id) ? '-22px' : '0px',
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
              <div className="text-center text-slate-500 py-10">
                <p className="text-3xl mb-2">🫙</p>
                <p className="text-sm">No cards in hand</p>
              </div>
            )}
          </div>
        </div>
      </section>

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