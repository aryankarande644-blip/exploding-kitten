import { Server } from 'socket.io';
import { setupSocketHandlers } from './socket.js';

const PORT = parseInt(process.env.PORT || '3001');
const io = new Server(PORT, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
});

setupSocketHandlers(io);
console.log(`Exploding Kittens server running on port ${PORT}`);
