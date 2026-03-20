// src/orchestration/bull-board.ts — Bull Board HTTP dashboard on port 3101 with basic auth
import express, { type Request, type Response, type NextFunction } from 'express';
import { createBullBoard } from '@bull-board/api';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { ExpressAdapter } from '@bull-board/express';
import type { Queue } from 'bullmq';
import type { Server } from 'http';
import { log } from '../lib/logger';

const BULL_BOARD_PORT = 3101;
const BULL_BOARD_BASE_PATH = '/bull-board';

export interface BullBoardCredentials {
  user: string;
  password: string;
}

export function basicAuthMiddleware(user: string, password: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const authHeader = req.headers.authorization ?? '';
    if (!authHeader.startsWith('Basic ')) {
      res.statusCode = 401;
      res.setHeader('WWW-Authenticate', 'Basic realm="Bull Board"');
      res.end('Unauthorized');
      return;
    }
    const decoded = Buffer.from(authHeader.slice(6), 'base64').toString('utf8');
    const [reqUser, reqPass] = decoded.split(':');
    if (reqUser !== user || reqPass !== password) {
      res.statusCode = 401;
      res.setHeader('WWW-Authenticate', 'Basic realm="Bull Board"');
      res.end('Unauthorized');
      return;
    }
    next();
  };
}

export function startBullBoard(
  queues: Record<string, Queue>,
  credentials: BullBoardCredentials,
): Server {
  const serverAdapter = new ExpressAdapter();
  serverAdapter.setBasePath(BULL_BOARD_BASE_PATH);

  createBullBoard({
    queues: Object.values(queues).map((q) => new BullMQAdapter(q)),
    serverAdapter,
  });

  const app = express();
  app.use(BULL_BOARD_BASE_PATH, basicAuthMiddleware(credentials.user, credentials.password));
  app.use(BULL_BOARD_BASE_PATH, serverAdapter.getRouter());

  const server = app.listen(BULL_BOARD_PORT, () => {
    log('info', 'bull_board_started', { port: BULL_BOARD_PORT, path: BULL_BOARD_BASE_PATH });
  });

  return server;
}
