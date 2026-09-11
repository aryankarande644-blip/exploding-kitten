import pg from 'pg';
import type { RoomState } from './rooms.js';

const DATABASE_URL = process.env.DATABASE_URL || '';

let pool: pg.Pool | null = null;

export function persistenceEnabled(): boolean {
  return !!DATABASE_URL;
}

export async function initPersistence(): Promise<void> {
  if (!DATABASE_URL) return;
  pool = new pg.Pool({ connectionString: DATABASE_URL, max: 2, ssl: { rejectUnauthorized: false } });
  await pool.query(
    `CREATE TABLE IF NOT EXISTS rooms (
       code TEXT PRIMARY KEY,
       data JSONB NOT NULL,
       updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
     )`
  );
  console.log('Persistence enabled (DATABASE_URL)');
}

export function toSavedRoom(room: RoomState) {
  return {
    code: room.code,
    hostId: room.hostId,
    pendingFavor: room.pendingFavor,
    pendingDefuse: room.pendingDefuse,
    gameState: room.gameState,
    players: Array.from(room.players.entries()).map(([id, info]) => ({
      id,
      socketId: info.socketId,
      name: info.name,
    })),
    activity: room.activity,
  };
}

export function fromSavedRoom(saved: any): RoomState {
  if (!saved || typeof saved !== 'object') throw new Error('Corrupt saved room');
  const gameState = saved.gameState ? { ...saved.gameState, nopeWindowTimer: null } : null;
  return {
    code: saved.code,
    gameState,
    players: new Map(
      (saved.players ?? []).map((p: any) => [p.id, { socketId: p.socketId, name: p.name }])
    ),
    hostId: saved.hostId,
    pendingFavor: saved.pendingFavor ?? null,
    pendingDefuse: saved.pendingDefuse ?? null,
    nopeTimer: null,
    nopePassed: new Set(),
    nopeWindowDeadline: null,
    activity: Array.isArray(saved.activity)
      ? saved.activity.map((a: any) => ({
          id: typeof a.id === 'string' ? a.id : String(Math.random()),
          text: typeof a.text === 'string' ? a.text : '',
          ts: typeof a.ts === 'number' ? a.ts : Date.now(),
        }))
      : [],
    gameOverLogged: false,
  };
}

export function persistRoom(code: string, room: RoomState): void {
  if (!pool) return;
  const data = JSON.stringify(toSavedRoom(room));
  pool
    .query(
      `INSERT INTO rooms (code, data) VALUES ($1, $2)
       ON CONFLICT (code) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`,
      [code, data]
    )
    .catch((e) => console.error('persist failed:', e.message));
}

export async function loadRoom(code: string): Promise<RoomState | null> {
  if (!pool) return null;
  const res = await pool.query(`SELECT data FROM rooms WHERE code = $1`, [code]);
  if (res.rows.length === 0) return null;
  return fromSavedRoom(res.rows[0].data);
}

export async function deleteRoom(code: string): Promise<void> {
  if (!pool) return;
  await pool.query(`DELETE FROM rooms WHERE code = $1`, [code]).catch(() => {});
}