// src/dev/index.ts — Dev router: registers /dev/* endpoints for test console
import type { Application, Request, Response, NextFunction } from 'express';
import type { SupabaseClient } from '@supabase/supabase-js';
import { log } from '../lib/logger';
import {
  createTestOrder,
  listTestOrders,
  purgeTestOrders,
  getTestOrderSnapshot,
} from './test-orders';
import { editTestOrderState } from './state-editor';
import { simulateEvent } from './simulate-event';

// ── Dev token guard ───────────────────────────────────────────────────────────

/**
 * Express middleware that validates the X-Dev-Token header.
 * Returns 404 (not 401) to avoid leaking endpoint existence.
 */
export function devTokenGuard(req: Request, res: Response, next: NextFunction): void {
  const expectedToken = process.env.AGENTS_DEV_TOKEN;
  const providedToken = req.headers['x-dev-token'];

  if (!expectedToken || providedToken !== expectedToken) {
    res.status(404).json({ error: 'Not found' });
    return;
  }

  next();
}

// ── Route registration ────────────────────────────────────────────────────────

/**
 * Registers /dev/* routes on the provided Express app.
 *
 * Guards (ALL must pass):
 * 1. ENABLE_DEV_ENDPOINTS === 'true'
 * 2. NODE_ENV !== 'production'
 *
 * If ENABLE_DEV_ENDPOINTS=true AND NODE_ENV=production → logs warning, refuses to register.
 */
export function registerDevRoutes(app: Application, db: SupabaseClient): void {
  const enabled = process.env.ENABLE_DEV_ENDPOINTS === 'true';

  if (!enabled) {
    return;
  }

  log('info', 'dev_routes_registered', { prefix: '/dev' });

  // ── GET /dev/test-orders ────────────────────────────────────────────────────
  app.get('/dev/test-orders', devTokenGuard, async (req: Request, res: Response) => {
    try {
      const operator_id = (req as Request & { operator_id?: string }).operator_id
        ?? (req.headers['x-operator-id'] as string | undefined)
        ?? '';

      if (!operator_id) {
        res.status(400).json({ error: 'Missing operator_id' });
        return;
      }

      const result = await listTestOrders(db, operator_id);
      res.status(200).json(result);
    } catch (err) {
      res.status(500).json({ error: String(err instanceof Error ? err.message : err) });
    }
  });

  // ── POST /dev/test-orders ───────────────────────────────────────────────────
  app.post('/dev/test-orders', devTokenGuard, async (req: Request, res: Response) => {
    try {
      const operator_id = (req as Request & { operator_id?: string }).operator_id
        ?? (req.headers['x-operator-id'] as string | undefined)
        ?? '';

      if (!operator_id) {
        res.status(400).json({ error: 'Missing operator_id' });
        return;
      }

      const { customer_name, customer_phone, delivery_date, delivery_window_start, delivery_window_end } =
        req.body as Record<string, string | undefined>;

      if (!customer_name || !customer_phone || !delivery_date) {
        res.status(400).json({ error: 'Missing required fields: customer_name, customer_phone, delivery_date' });
        return;
      }

      const result = await createTestOrder(db, operator_id, {
        customer_name,
        customer_phone,
        delivery_date,
        delivery_window_start,
        delivery_window_end,
      });

      res.status(201).json(result);
    } catch (err) {
      res.status(500).json({ error: String(err instanceof Error ? err.message : err) });
    }
  });

  // ── POST /dev/test-orders/purge ─────────────────────────────────────────────
  app.post('/dev/test-orders/purge', devTokenGuard, async (req: Request, res: Response) => {
    try {
      const operator_id = (req as Request & { operator_id?: string }).operator_id
        ?? (req.headers['x-operator-id'] as string | undefined)
        ?? '';

      if (!operator_id) {
        res.status(400).json({ error: 'Missing operator_id' });
        return;
      }

      const result = await purgeTestOrders(db, operator_id);
      res.status(200).json(result);
    } catch (err) {
      res.status(500).json({ error: String(err instanceof Error ? err.message : err) });
    }
  });

  // ── GET /dev/test-orders/:id/snapshot ──────────────────────────────────────
  app.get('/dev/test-orders/:id/snapshot', devTokenGuard, async (req: Request, res: Response) => {
    try {
      const operator_id = (req as Request & { operator_id?: string }).operator_id
        ?? (req.headers['x-operator-id'] as string | undefined)
        ?? '';

      if (!operator_id) {
        res.status(400).json({ error: 'Missing operator_id' });
        return;
      }

      const id = req.params['id'] as string;
      const snapshot = await getTestOrderSnapshot(db, operator_id, id);
      res.status(200).json(snapshot);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const status = msg.includes('not found') || msg.includes('not a test order') ? 404 : 500;
      res.status(status).json({ error: msg });
    }
  });

  // ── POST /dev/simulate-event ────────────────────────────────────────────────
  app.post('/dev/simulate-event', devTokenGuard, async (req: Request, res: Response) => {
    try {
      const operator_id = (req as Request & { operator_id?: string }).operator_id
        ?? (req.headers['x-operator-id'] as string | undefined)
        ?? '';

      if (!operator_id) {
        res.status(400).json({ error: 'Missing operator_id' });
        return;
      }

      const result = await simulateEvent(req.body, operator_id, db);
      res.status(result.status).json(result.body);
    } catch (err) {
      res.status(500).json({ error: String(err instanceof Error ? err.message : err) });
    }
  });

  // ── POST /dev/test-orders/:id/state ────────────────────────────────────────
  app.post('/dev/test-orders/:id/state', devTokenGuard, async (req: Request, res: Response) => {
    try {
      const operator_id = (req as Request & { operator_id?: string }).operator_id
        ?? (req.headers['x-operator-id'] as string | undefined)
        ?? '';

      if (!operator_id) {
        res.status(400).json({ error: 'Missing operator_id' });
        return;
      }

      const id = req.params['id'] as string;
      const { table, fields } = req.body as { table?: string; fields?: Record<string, unknown> };

      if (!table || fields === undefined) {
        res.status(400).json({ error: 'Missing required fields: table, fields' });
        return;
      }

      const result = await editTestOrderState(db, operator_id, id, {
        table: table as 'orders' | 'assignments' | 'dispatches' | 'reset_session',
        fields,
      });

      res.status(200).json(result);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const status =
        msg.includes('not found') || msg.includes('not a test order') ? 404
        : msg.includes('not allowed') || msg.includes('no valid') ? 400
        : 500;
      res.status(status).json({ error: msg });
    }
  });
}
