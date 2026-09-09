# Exploding Kittens

A real-time, multiplayer Exploding Kittens card game.

**Play it live:** https://web-aaryan-alice.vercel.app

Create a room, share the code with friends, and the last player standing wins.

## Stack

| Piece | Tech |
| --- | --- |
| Client | Next.js (App Router), Socket.IO client |
| Server | Node.js + Socket.IO (TypeScript) |
| Persistence | Neon (Postgres) — rooms survive server restarts |
| Deploy | Vercel (frontend), Render (game server) |

- Game engine lives in `engine/` (pure TypeScript, no I/O).
- `server/` is the Socket.IO game server — rooms, turns, Nope windows, defuse/favor prompts, and Neon backup of every room.
- `web/` is the Next.js frontend.
- Nope windows are server-timed (36s) so the acting player can't race the resolution.

## Run locally

Requires Node 18+.

```bash
# server (port 3001)
cd server
npm install
npm start

# web (port 9994), in a second terminal
cd web
npm install
npm run dev
```

Open `http://localhost:9994`.

> Rooms live in server memory. Set `DATABASE_URL` (any Postgres, e.g. Neon) if you want rooms to survive server restarts:

```bash
cd server
DATABASE_URL="postgres://..." npm start
```

## Tests

Server tests run against a live server on `:3001`. Start the server, then:

```bash
cd server
npx tsx engine.test.ts        # engine + 1000-game simulation  (run from engine/)
npx tsx e2e.test.ts           # full multiplayer game flow
npx tsx nope.test.ts          # Nope window: guard, pass, timer expiry
npx tsx defuse.test.ts        # defuse flow
npx tsx leave.test.ts         # leaving mid-game
npx tsx persistence.test.ts   # Neon save/restore round-trip
```

## Deploy

- **Frontend (Vercel):** root directory `web`, env `NEXT_PUBLIC_SOCKET_URL=https://<render-service>.onrender.com`
- **Game server (Render):** see `render.yaml`; root `server`, build `npm install --include=dev`, start `npm start`, env `DATABASE_URL` (Neon)
- **Database (Neon):** free Postgres; the server auto-creates its `rooms` table on boot

Free-tier note: Render free web services sleep after ~15 min idle. Land your `DATABASE_URL` or the server writes rooms to Neon on every change, and on reconnect the game resumes exactly where it was — including an in-flight Nope window.