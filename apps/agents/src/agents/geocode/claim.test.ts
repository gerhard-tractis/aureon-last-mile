// src/agents/geocode/claim.test.ts — claim_geocode_batch RPC wrapper,
// spec-58 fase 5. Exercised against a mocked Supabase client.
import { describe, it, expect, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { claimGeocodeBatch } from './claim';

function makeDb(response: { data: unknown; error: unknown }) {
  return { rpc: vi.fn().mockResolvedValue(response) } as unknown as SupabaseClient;
}

describe('claimGeocodeBatch', () => {
  // Hardcoded literals, not the module's own exported defaults -- the spec
  // fixes these numbers (200-row batch, per Fase 5's "Claiming a batch"),
  // and asserting against the same constant the code uses would pass no
  // matter what that constant was changed to.
  it('calls the claim_geocode_batch RPC with the default limit and lease', async () => {
    const db = makeDb({ data: [], error: null });
    await claimGeocodeBatch(db);

    expect(db.rpc).toHaveBeenCalledWith('claim_geocode_batch', {
      p_limit: 200,
      p_lease_minutes: 10,
    });
  });

  it('passes through an explicit limit and lease', async () => {
    const db = makeDb({ data: [], error: null });
    await claimGeocodeBatch(db, 50, 5);

    expect(db.rpc).toHaveBeenCalledWith('claim_geocode_batch', {
      p_limit: 50,
      p_lease_minutes: 5,
    });
  });

  it('returns the claimed rows', async () => {
    const rows = [{ id: 'order-1' }, { id: 'order-2' }];
    const db = makeDb({ data: rows, error: null });

    const result = await claimGeocodeBatch(db);
    expect(result).toEqual(rows);
  });

  it('returns an empty array when the RPC returns null data', async () => {
    const db = makeDb({ data: null, error: null });
    expect(await claimGeocodeBatch(db)).toEqual([]);
  });

  it('throws when the RPC errors', async () => {
    const db = makeDb({ data: null, error: { message: 'boom' } });
    await expect(claimGeocodeBatch(db)).rejects.toThrow('boom');
  });
});
