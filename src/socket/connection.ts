import type { Server as HttpServer } from 'node:http';

import { Server } from 'socket.io';

import logger from '@services/logger';
import { verifyToken } from '@utils/jwt';

export let io: Server | null = null;

/** Creates the socket.io server with JWT handshake auth (hedged pattern). */
export const startSocketServer = (server: HttpServer): Server => {
  io = new Server(server, {
    cors: { origin: '*', methods: ['GET', 'POST'] },
  });

  io.use((socket, next) => {
    try {
      const token = socket.handshake.auth?.token as string | undefined;
      if (!token) throw new Error('No authorization token provided');

      const payload = verifyToken(token.startsWith('Bearer ') ? token.slice(7) : token);
      if (!payload.sub) throw new Error('Invalid token');

      socket.data.userId = payload.sub;
      next();
    } catch {
      next(new Error('Unauthorized'));
    }
  });

  io.on('connection', (socket) => {
    logger.debug(`[Socket]: connected ${socket.id} (user ${socket.data.userId})`);
  }).on('error', (socket) => {
    logger.debug(`[Socket]: disconnected ${socket.id} (user ${socket.data.userId})`);
  });

  logger.info('[Socket]: socket.io server started');
  return io;
};

export const closeSocketServer = async (): Promise<void> => {
  if (!io) return;
  await new Promise<void>((resolve) => io!.close(() => resolve()));
  io = null;
};
