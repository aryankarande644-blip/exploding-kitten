'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { getSocket } from '@/lib/socket';
import { LobbyState } from '@/lib/types';
import { Socket } from 'socket.io-client';

export default function LobbyPage() {
  const router = useRouter();
  const [connected, setConnected] = useState(false);
  const [playerName, setPlayerName] = useState('');
  const [roomCode, setRoomCode] = useState('');
  const [myPlayerId, setMyPlayerId] = useState('');
  const [myRoomCode, setMyRoomCode] = useState('');
  const [isHost, setIsHost] = useState(false);
  const [lobby, setLobby] = useState<LobbyState | null>(null);
  const [error, setError] = useState('');
  const [view, setView] = useState<'home' | 'lobby' | 'game'>('home');

  const socketRef = useRef<Socket | null>(null);
  const myPlayerIdRef = useRef('');
  const myRoomCodeRef = useRef('');

  useEffect(() => {
    const stored = localStorage.getItem('ek_session');
    if (stored) {
      try {
        const s = JSON.parse(stored);
        setPlayerName(s.playerName || '');
      } catch {}
    }
  }, []);

  useEffect(() => {
    myPlayerIdRef.current = myPlayerId;
  }, [myPlayerId]);

  useEffect(() => {
    myRoomCodeRef.current = myRoomCode;
  }, [myRoomCode]);

  const setupSocket = useCallback(() => {
    const s = getSocket();
    socketRef.current = s;

    if (!s.connected) {
      s.connect();
    }

    s.on('connect', () => setConnected(true));
    s.on('disconnect', () => setConnected(false));

    s.on('ROOM_CREATED', (data: { room_code: string; player_id: string }) => {
      setMyPlayerId(data.player_id);
      setMyRoomCode(data.room_code);
      setIsHost(true);
      setView('lobby');
      localStorage.setItem(`ek_session_${data.room_code}`, JSON.stringify({
        roomCode: data.room_code,
        playerId: data.player_id,
        playerName: playerName,
      }));
    });

    s.on('ROOM_JOINED', (data: { room_code: string; player_id: string }) => {
      setMyPlayerId(data.player_id);
      setMyRoomCode(data.room_code);
      setIsHost(false);
      setView('lobby');
      localStorage.setItem(`ek_session_${data.room_code}`, JSON.stringify({
        roomCode: data.room_code,
        playerId: data.player_id,
        playerName: playerName,
      }));
    });

    s.on('ROOM_STATE', (data: LobbyState & { room_code: string; player_id: string }) => {
      setLobby({
        players: data.players,
        host_id: data.host_id,
        status: data.status,
      });
      setIsHost(data.host_id === data.player_id);
      if (data.status === 'in_progress' || data.status === 'finished') {
        setView('game');
        router.push(`/game/${data.room_code}`);
      }
    });

    s.on('LOBBY_UPDATE', (data: LobbyState) => {
      setLobby(data);
      setIsHost(data.host_id === myPlayerIdRef.current);
    });

    s.on('ERROR', (data: { message: string }) => {
      setError(data.message);
      setTimeout(() => setError(''), 4000);
    });

    s.on('GAME_STATE_UPDATE', () => {
      setView('game');
      router.push(`/game/${myRoomCodeRef.current}`);
    });

    return () => {
      s.off('connect');
      s.off('disconnect');
      s.off('ROOM_CREATED');
      s.off('ROOM_JOINED');
      s.off('ROOM_STATE');
      s.off('LOBBY_UPDATE');
      s.off('ERROR');
      s.off('GAME_STATE_UPDATE');
    };
  }, [playerName, router]);

  useEffect(() => {
    const cleanup = setupSocket();
    return cleanup;
  }, [setupSocket]);

  const handleCreateRoom = () => {
    if (!playerName.trim()) {
      setError('Enter your name');
      return;
    }
    setError('');
    socketRef.current?.emit('CREATE_ROOM', { player_name: playerName.trim() });
  };

  const handleJoinRoom = () => {
    if (!playerName.trim()) {
      setError('Enter your name');
      return;
    }
    if (!roomCode.trim()) {
      setError('Enter a room code');
      return;
    }
    setError('');
    socketRef.current?.emit('JOIN_ROOM', {
      room_code: roomCode.trim().toUpperCase(),
      player_name: playerName.trim(),
    });
  };

  const handleStartGame = () => {
    socketRef.current?.emit('START_GAME');
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-gradient-to-b from-[#161b2e] to-[#0b0e18]">
      <div className="w-full max-w-lg">
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold mb-2 tracking-tight">
            <span className="mr-2">🐱</span>Exploding Kittens
          </h1>
          <p className="text-slate-400 text-sm">The card game for people who are into kittens</p>
          <div className="flex items-center justify-center gap-2 mt-3">
            <div className={`w-2 h-2 rounded-full ${connected ? 'bg-emerald-400' : 'bg-rose-400'}`} />
            <span className="text-xs text-slate-500">{connected ? 'Connected' : 'Connecting...'}</span>
          </div>
        </div>

        {error && (
          <div className="bg-rose-950/80 border border-rose-700/40 rounded-full p-3 mb-4 text-center text-sm text-rose-200 animate-fade-in">
            {error}
          </div>
        )}

        {view === 'home' && (
          <div className="bg-[#171c30]/95 rounded-3xl p-8 border border-white/10 shadow-2xl">
            <div className="mb-6">
              <label className="block text-sm text-slate-400 mb-2">Your Name</label>
              <input
                type="text"
                value={playerName}
                onChange={(e) => setPlayerName(e.target.value)}
                placeholder="Enter your name..."
                maxLength={20}
                className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-amber-400/60 focus:border-transparent text-base"
              />
            </div>

            <button
              onClick={handleCreateRoom}
              disabled={!connected}
              className="w-full h-12 rounded-full bg-amber-400 hover:bg-amber-300 text-black font-semibold text-base transition-all active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed mb-4 shadow-[0_8px_24px_rgba(251,191,36,0.25)]"
            >
              Create Room
            </button>

            <div className="relative my-6">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-white/5" />
              </div>
              <div className="relative flex justify-center">
                <span className="bg-[#171c30] px-4 text-slate-500 text-xs uppercase tracking-widest">
                  or join existing
                </span>
              </div>
            </div>

            <div className="flex gap-3">
              <input
                type="text"
                value={roomCode}
                onChange={(e) => setRoomCode(e.target.value.toUpperCase())}
                placeholder="Room code"
                maxLength={4}
                className="flex-1 bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-amber-400/60 focus:border-transparent text-center tracking-[0.3em] uppercase font-mono"
              />
              <button
                onClick={handleJoinRoom}
                disabled={!connected}
                className="h-12 bg-white/10 hover:bg-white/15 border border-white/10 font-semibold px-6 rounded-xl transition-all active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Join
              </button>
            </div>
          </div>
        )}

        {view === 'lobby' && lobby && (
          <div className="bg-[#171c30]/95 rounded-3xl p-8 border border-white/10 shadow-2xl animate-fade-in">
            <div className="text-center mb-6">
              <p className="text-slate-400 text-xs uppercase tracking-widest mb-1">Room Code</p>
              <div className="text-4xl font-mono font-bold text-amber-300 tracking-[0.3em]">{myRoomCode}</div>
              <p className="text-slate-500 text-xs mt-2">Share this code with friends</p>
            </div>

            <div className="mb-6">
              <h3 className="text-xs uppercase tracking-widest text-slate-400 mb-3">
                Players ({lobby.players.length}/5)
              </h3>
              <div className="space-y-2">
                {lobby.players.map((p) => (
                  <div
                    key={p.id}
                    className="flex items-center justify-between bg-white/5 rounded-xl px-4 py-2.5"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-gradient-to-br from-amber-500/90 to-orange-600/90 flex items-center justify-center text-sm font-bold">
                        {p.name.charAt(0).toUpperCase()}
                      </div>
                      <span className="font-medium text-sm">{p.name}</span>
                    </div>
                    {p.id === lobby.host_id && (
                      <span className="text-[10px] bg-amber-400/10 text-amber-300 px-2 py-1 rounded-full font-medium uppercase tracking-wider">
                        Host
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {isHost ? (
              <button
                onClick={handleStartGame}
                disabled={lobby.players.length < 2}
                className="w-full h-12 rounded-full bg-emerald-400 hover:bg-emerald-300 text-black font-semibold text-base transition-all active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed shadow-[0_8px_24px_rgba(52,211,153,0.25)]"
              >
                {lobby.players.length < 2
                  ? `Need ${2 - lobby.players.length} more player${lobby.players.length === 0 ? 's' : ''}`
                  : 'Start Game'}
              </button>
            ) : (
              <div className="text-center text-slate-500 py-4 text-sm">
                Waiting for host to start the game...
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
