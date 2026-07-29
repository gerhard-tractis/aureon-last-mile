// src/orchestration/bull-board.ts — Bull Board HTTP dashboard on port 3101 with basic auth
import express, { type Request, type Response, type NextFunction } from 'express';
import { createBullBoard } from '@bull-board/api';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { ExpressAdapter } from '@bull-board/express';
import type { Queue } from 'bullmq';
import type { Server } from 'http';
import { log } from '../lib/logger';
import { timingSafeCompare } from '../lib/timing-safe';

const BULL_BOARD_PORT = 3101;
// Loopback only. This dashboard can read, replay and delete every job —
// including payloads with customer PII — so it must not be reachable from the
// internet. Reach it through an SSH tunnel:
//   ssh -L 3101:127.0.0.1:3101 <vps>
const BULL_BOARD_HOST = '127.0.0.1';
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
    const sep = decoded.indexOf(':');
    const reqUser = sep === -1 ? decoded : decoded.slice(0, sep);
    const reqPass = sep === -1 ? '' : decoded.slice(sep + 1);
    // Constant-time compare, and evaluate both halves so the timing of a
    // wrong username doesn't differ from a wrong password.
    const userOk = timingSafeCompare(reqUser, user);
    const passOk = timingSafeCompare(reqPass, password);
    if (!userOk || !passOk) {
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

  const server = app.listen(BULL_BOARD_PORT, BULL_BOARD_HOST, () => {
    log('info', 'bull_board_started', {
      host: BULL_BOARD_HOST,
      port: BULL_BOARD_PORT,
      path: BULL_BOARD_BASE_PATH,
    });
  });

  return server;
}
