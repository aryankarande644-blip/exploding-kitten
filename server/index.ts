import http from 'node:http';
import { Server } from 'socket.io';
import { setupSocketHandlers } from './socket.js';
import { initPersistence, persistenceEnabled } from './db.js';

const PORT = parseInt(process.env.PORT || '3001');

const httpServer = http.createServer((req, res) => {
  if (req.method === 'GET' && (req.url === '/health' || req.url === '/health/')) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        ok: true,
        uptime: Math.floor(process.uptime()),
        persistence: persistenceEnabled(),
      })
    );
    return;
  }
  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not found');
});

const io = new Server(httpServer, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
});

setupSocketHandlers(io);
httpServer.listen(PORT);

initPersistence()
  .then(() => {
    if (!persistenceEnabled()) {
      console.log('Persistence disabled — set DATABASE_URL to keep rooms across restarts');
    }
  })
  .catch((e) => console.error('Persistence init failed:', e.message));

console.log(`Exploding Kittens server running on port ${PORT}`);