'use client';

import { FormEvent, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getSocket } from '@/lib/socket';
import { LobbyState } from '@/lib/types';
import { Socket } from 'socket.io-client';

export default function LobbyPage() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [roomCode, setRoomCode] = useState('');
  const [message, setMessage] = useState('');
  const [isError, setIsError] = useState(false);
  const [connected, setConnected] = useState(false);
  const [myPlayerId, setMyPlayerId] = useState('');
  const [myRoomCode, setMyRoomCode] = useState('');
  const [isHost, setIsHost] = useState(false);
  const [lobby, setLobby] = useState<LobbyState | null>(null);
  const [view, setView] = useState<'home' | 'lobby' | 'game'>('home');

  const socketRef = useRef<Socket | null>(null);
  const myPlayerIdRef = useRef('');
  const myRoomCodeRef = useRef('');
  const nameRef = useRef('');

  const getUsernameCookie = (): string => {
    const m = document.cookie.match(/(?:^|;\s*)ek_username=([^;]+)/);
    return m ? decodeURIComponent(m[1]) : '';
  };

  const setUsernameCookie = (value: string) => {
    const safe = encodeURIComponent(value.trim());
    const expires = new Date(Date.now() + 365 * 2 * 86400000).toUTCString();
    document.cookie = `ek_username=${safe}; expires=${expires}; path=/; SameSite=Lax`;
  };

  useEffect(() => {
    const storedName = getUsernameCookie();
    if (storedName) setName(storedName);
  }, []);

  useEffect(() => {
    myPlayerIdRef.current = myPlayerId;
    nameRef.current = name;
  }, [myPlayerId, name]);

  useEffect(() => {
    myRoomCodeRef.current = myRoomCode;
  }, [myRoomCode]);

  const setupSocket = () => {
    const s = getSocket();
    socketRef.current = s;

    if (!s.connected) {
      s.connect();
    }

    s.on('connect', () => setConnected(true));
    s.on('disconnect', () => setConnected(false));
    s.on('connect_error', () => setConnected(false));

    setConnected(s.connected);

    s.on('ROOM_CREATED', (data: { room_code: string; player_id: string }) => {
      setMyPlayerId(data.player_id);
      setMyRoomCode(data.room_code);
      setIsHost(true);
      setView('lobby');
      setMessage('');
      localStorage.setItem(`ek_session_${data.room_code}`, JSON.stringify({
        roomCode: data.room_code,
        playerId: data.player_id,
        playerName: nameRef.current,
      }));
    });

    s.on('ROOM_JOINED', (data: { room_code: string; player_id: string }) => {
      setMyPlayerId(data.player_id);
      setMyRoomCode(data.room_code);
      setIsHost(false);
      setView('lobby');
      setMessage('');
      localStorage.setItem(`ek_session_${data.room_code}`, JSON.stringify({
        roomCode: data.room_code,
        playerId: data.player_id,
        playerName: nameRef.current,
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
      setMessage(data.message);
      setIsError(true);
      setTimeout(() => setIsError(false), 4000);
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
  };

  useEffect(() => {
    const cleanup = setupSocket();
    return cleanup;
  }, []);

  function handleCreateRoom(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!name.trim()) {
      setMessage('Enter your name to create a room.');
      setIsError(true);
      return;
    }
    if (!connected) {
      setMessage('Connecting to game server, try again in a second…');
      setIsError(true);
      return;
    }
    setMessage('');
    setIsError(false);
    socketRef.current?.emit('CREATE_ROOM', { player_name: name.trim() });
  }

  function handleJoinRoom() {
    const code = roomCode.trim().toUpperCase();
    if (!name.trim()) {
      setMessage('Enter your name to join a room.');
      setIsError(true);
      return;
    }
    if (!code) {
      setMessage('Enter a room code to join.');
      setIsError(true);
      return;
    }
    if (!connected) {
      setMessage('Connecting to game server, try again in a second…');
      setIsError(true);
      return;
    }
    setMessage('');
    setIsError(false);
    socketRef.current?.emit('JOIN_ROOM', {
      room_code: code,
      player_name: name.trim(),
    });
  }

  const handleStartGame = () => {
    socketRef.current?.emit('START_GAME');
  };

  if (view === 'home') {
    return (
      <main className="lobby-shell">
        <div className="scene-art" aria-hidden="true">
          <div className="moon" />
          <div className="window"><span /><span /><span /></div>
          <div className="wall-poster poster-left">KITTENS<br />CARDS<br />CHAOS<br />FRIENDS<br /><b>♡</b></div>
          <div className="wall-poster poster-center">EXPLODING<br />KITTENS<div className="poster-cat">●ᴥ●</div></div>
          <div className="wall-poster poster-right">Good Kittens.<br />Bad Luck.<br /><b>♡</b></div>
          <div className="checklist">☑ Play<br />☑ Betray<br />☑ Explode<br />☑ Repeat<br /><span>ฅ^•ﻌ•^ฅ</span></div>
          <div className="table-scene"><div className="card-stack"><b>EXPLODING<br />KITTENS</b></div><div className="game-card green">DEFUSE<div>●ᴥ●</div></div><div className="game-card blue">SKIP<div>⌁ᴥ⌁</div></div></div>
          <div className="kitten-box"><div className="kitten">◕ᴥ◕</div><span>DANGER<br />CUTE KITTENS<br />INSIDE</span></div>
          <div className="sleeping-cat">⌣ᴥ⌣<i>z z z</i></div>
          <div className="mug">SAME<br />KITTENS<br />DIFFERENT<br />VICTIMS<br />♡</div>
        </div>
        <div className="scene-vignette" aria-hidden="true" />

        <section className="lobby-content" aria-label="Exploding Kittens game lobby">
          <header className="brand-block">
            <div className="brand-title" aria-label="Exploding Kittens">
              <span>EXPLODING</span>
              <strong>KITTENS<sup>™</sup></strong>
            </div>
            <p className="tagline">The card game for people who are into kittens<br /><em>(and occasional explosions).</em></p>
            <div className="paw-row" aria-hidden="true"><span>✦</span><i>●●</i><span>✦</span></div>
          </header>

          <form className="lobby-card" onSubmit={handleCreateRoom}>
            <label className="field name-field">
              <span className="field-icon" aria-hidden="true">♙</span>
              <span className="sr-only">Your name</span>
              <input value={name} onChange={(event) => { setName(event.target.value); setUsernameCookie(event.target.value); }} placeholder="Enter your name..." maxLength={24} />
            </label>

            <button className="create-button" type="submit" disabled={!connected}>
              <span className="people-icon" aria-hidden="true">♟♟♟</span>
              Create Room
            </button>

            <div className="or-divider"><span>OR</span></div>

            <div className="join-row">
              <label className="field code-field">
                <span className="field-icon" aria-hidden="true">⌕</span>
                <span className="sr-only">Room code</span>
                <input value={roomCode} onChange={(event) => setRoomCode(event.target.value.toUpperCase())} placeholder="R O O M  C O D E" maxLength={4} />
              </label>
              <button className="join-button" type="button" onClick={handleJoinRoom} disabled={!connected}>Join</button>
            </div>
            <p className={`status${isError ? ' error' : ''}`} role="status" aria-live="polite">
              {message || (connected ? '' : 'Connecting to game server…')}
            </p>
          </form>
        </section>
      </main>
    );
  }

  if (view === 'lobby' && lobby) {
    return (
      <main className="lobby-shell">
        <div className="scene-art" aria-hidden="true" />
        <div className="scene-vignette" aria-hidden="true" />

        <section className="lobby-content" aria-label="Exploding Kittens game lobby">
          <header className="brand-block">
            <div className="brand-title" aria-label="Exploding Kittens">
              <span>EXPLODING</span>
              <strong>KITTENS<sup>™</sup></strong>
            </div>
          </header>

          <div className="lobby-card animate-fade-in">
            <div className="text-center mb-6">
              <p className="text-slate-400 text-xs uppercase tracking-widest mb-2">Room Code</p>
              <div className="text-4xl font-mono font-bold text-amber-300 tracking-[0.35em]">{myRoomCode}</div>
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
                      <div className="w-8 h-8 rounded-full bg-gradient-to-br from-amber-500/90 to-orange-600/90 flex items-center justify-center text-sm font-bold text-black">
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

            {message && (
              <p className={`status${isError ? ' error' : ''} text-center`} role="status" aria-live="polite">
                {message}
              </p>
            )}
          </div>
        </section>
      </main>
    );
  }

  return null;
}