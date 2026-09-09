import { Server } from 'socket.io';
import { setupSocketHandlers } from './socket.js';
import { initPersistence, persistenceEnabled } from './db.js';

const PORT = parseInt(process.env.PORT || '3001');
const io = new Server(PORT, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
});

setupSocketHandlers(io);

initPersistence()
  .then(() => {
    if (!persistenceEnabled()) {
      console.log('Persistence disabled — set DATABASE_URL to keep rooms across restarts');
    }
  })
  .catch((e) => console.error('Persistence init failed:', e.message));

console.log(`Exploding Kittens server running on port ${PORT}`);