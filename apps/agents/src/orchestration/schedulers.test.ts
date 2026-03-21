// src/orchestration/schedulers.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Queue } from 'bullmq';

type MockQueue = { upsertJobScheduler: ReturnType<typeof vi.fn> };

describe('registerSchedulers', () => {
  let mockQueues: Record<string, MockQueue>;

  beforeEach(() => {
    vi.resetModules();
    mockQueues = {
      'intake.ingest': { upsertJobScheduler: vi.fn().mockResolvedValue({}) },
      'assignment.optimize': { upsertJobScheduler: vi.fn().mockResolvedValue({}) },
      'coord.lifecycle': { upsertJobScheduler: vi.fn().mockResolvedValue({}) },
      'wismo.client': { upsertJobScheduler: vi.fn().mockResolvedValue({}) },
      'settle.reconcile': { upsertJobScheduler: vi.fn().mockResolvedValue({}) },
      'whatsapp.outbound': { upsertJobScheduler: vi.fn().mockResolvedValue({}) },
      'exception.handle': { upsertJobScheduler: vi.fn().mockResolvedValue({}) },
      'legacy.worker': { upsertJobScheduler: vi.fn().mockResolvedValue({}) },
    };
  });

  it('registers email_parse cron on intake.ingest every 15 minutes', async () => {
    const { registerSchedulers } = await import('./schedulers');
    await registerSchedulers(mockQueues as unknown as Record<string, Queue>);

    expect(mockQueues['intake.ingest'].upsertJobScheduler).toHaveBeenCalledWith(
      'email-parse-cron',
      expect.objectContaining({ pattern: '*/15 * * * *', tz: 'America/Santiago' }),
      expect.objectContaining({ name: 'email_parse' }),
    );
  });

  it('registers batch_assign cron on assignment.optimize at 06:00 and 14:00', async () => {
    const { registerSchedulers } = await import('./schedulers');
    await registerSchedulers(mockQueues as unknown as Record<string, Queue>);

    expect(mockQueues['assignment.optimize'].upsertJobScheduler).toHaveBeenCalledWith(
      'batch-assign-cron',
      expect.objectContaining({ pattern: '0 6,14 * * *', tz: 'America/Santiago' }),
      expect.objectContaining({ name: 'batch_assign' }),
    );
  });

  it('registers eod_reconcile cron on settle.reconcile at 22:00', async () => {
    const { registerSchedulers } = await import('./schedulers');
    await registerSchedulers(mockQueues as unknown as Record<string, Queue>);

    expect(mockQueues['settle.reconcile'].upsertJobScheduler).toHaveBeenCalledWith(
      'eod-reconcile-cron',
      expect.objectContaining({ pattern: '0 22 * * *', tz: 'America/Santiago' }),
      expect.objectContaining({ name: 'eod_reconcile' }),
    );
  });

  it('registers browser cron on legacy.worker at 07:00, 10:00, 13:00, 16:00', async () => {
    const { registerSchedulers } = await import('./schedulers');
    await registerSchedulers(mockQueues as unknown as Record<string, Queue>);

    expect(mockQueues['legacy.worker'].upsertJobScheduler).toHaveBeenCalledWith(
      'browser-cron',
      expect.objectContaining({ pattern: '0 7,10,13,16 * * *', tz: 'America/Santiago' }),
      expect.objectContaining({ name: 'browser' }),
    );
  });

  it('registers exactly 4 cron jobs in total', async () => {
    const { registerSchedulers } = await import('./schedulers');
    await registerSchedulers(mockQueues as unknown as Record<string, Queue>);

    const totalCalls = Object.values(mockQueues).reduce(
      (sum, q) => sum + q.upsertJobScheduler.mock.calls.length,
      0,
    );
    expect(totalCalls).toBe(4);
  });
});
