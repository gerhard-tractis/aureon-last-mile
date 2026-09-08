/**
 * spec-81 fase 2, B2 (ronda 1 de review del PR #679) — sin este módulo
 * montado en algún sitio de producción, `useOfflineQueue` era un drenador
 * que nadie llamaba. Este es el `OfflineQueueSender` real contra Supabase:
 * hoy solo sabe enviar `close_manifest` (el único tipo que algún productor
 * de producción encola — ver `complete/[loadId]/page.tsx`); `pickup_scan`
 * se deja para cuando exista un productor real, sin romper el drenador.
 */
import { describe, it, expect, vi } from 'vitest';
import { createPickupQueueSender } from './offlineQueueSender';
import type { PickupQueueEntry } from '@/lib/db';

function closeManifestEntry(overrides: Partial<PickupQueueEntry> = {}): PickupQueueEntry {
  return {
    id: 1,
    clientOperationId: 'client-op-1',
    operatorId: 'operator-a',
    manifestId: 'manifest-1',
    type: 'close_manifest',
    payload: {
      manifestId: 'manifest-1',
      signatures: {
        operator_signature: 'data:image/png;base64,AAA',
        client_signature: null,
        client_name: null,
      },
    },
    status: 'sending',
    retryCount: 0,
    claimToken: 'token-1',
    lastAttemptAt: null,
    nextAttemptAt: null,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('createPickupQueueSender — close_manifest', () => {
  it('calls close_manifest with the queued manifest id and signatures, and reports sent on success', async () => {
    const rpc = vi.fn(async () => ({ error: null, data: null }));
    const supabase = { rpc } as unknown as Parameters<typeof createPickupQueueSender>[0];
    const send = createPickupQueueSender(supabase);

    const result = await send(closeManifestEntry());

    expect(rpc).toHaveBeenCalledWith('close_manifest', {
      p_manifest_id: 'manifest-1',
      p_signatures: {
        operator_signature: 'data:image/png;base64,AAA',
        client_signature: null,
        client_name: null,
      },
    });
    expect(result).toEqual({ outcome: 'sent' });
  });

  it('reports retry (not dead) on the postgrest-js network-fallback shape', async () => {
    const rpc = vi.fn(async () => ({
      error: { message: 'TypeError: Failed to fetch', details: '', hint: '', code: '' },
      data: null,
    }));
    const supabase = { rpc } as unknown as Parameters<typeof createPickupQueueSender>[0];
    const send = createPickupQueueSender(supabase);

    const result = await send(closeManifestEntry());

    expect(result.outcome).toBe('retry');
  });

  it('reports dead on an irrecoverable business rejection (MANIFEST_NOT_CLOSABLE)', async () => {
    const rpc = vi.fn(async () => ({
      error: {
        message: 'MANIFEST_NOT_CLOSABLE: manifest is not in a closable state (status: pending)',
        details: '',
        hint: '',
        code: 'P0001',
      },
      data: null,
    }));
    const supabase = { rpc } as unknown as Parameters<typeof createPickupQueueSender>[0];
    const send = createPickupQueueSender(supabase);

    const result = await send(closeManifestEntry());

    expect(result.outcome).toBe('dead');
  });

  it('reports retry for an unrecognized pickup_scan entry instead of throwing (no producer enqueues these yet)', async () => {
    const rpc = vi.fn();
    const supabase = { rpc } as unknown as Parameters<typeof createPickupQueueSender>[0];
    const send = createPickupQueueSender(supabase);

    const result = await send(closeManifestEntry({ type: 'pickup_scan', payload: { barcode: 'X' } }));

    expect(result.outcome).toBe('retry');
    expect(rpc).not.toHaveBeenCalled();
  });
});
