// src/lib/supabase-client.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Track createClient calls
const createClientCalls: Array<{ url: string; key: string; options: Record<string, unknown> }> = [];
const mockClient = { from: vi.fn(), auth: {} };

vi.mock('@supabase/supabase-js', () => ({
  createClient: (url: string, key: string, options: Record<string, unknown>) => {
    createClientCalls.push({ url, key, options });
    return mockClient;
  },
}));

describe('supabase-client', () => {
  beforeEach(() => {
    createClientCalls.length = 0;
    vi.clearAllMocks();
    vi.resetModules();
  });

  describe('createSupabaseClient', () => {
    it('calls createClient with the given url and key', async () => {
      const { createSupabaseClient } = await import('./supabase-client');
      createSupabaseClient('https://test.supabase.co', 'service-role-key');

      expect(createClientCalls).toHaveLength(1);
      expect(createClientCalls[0].url).toBe('https://test.supabase.co');
      expect(createClientCalls[0].key).toBe('service-role-key');
    });

    it('sets auth.persistSession: false', async () => {
      const { createSupabaseClient } = await import('./supabase-client');
      createSupabaseClient('https://test.supabase.co', 'service-role-key');

      const auth = createClientCalls[0].options.auth as Record<string, unknown>;
      expect(auth.persistSession).toBe(false);
    });

    it('sets auth.autoRefreshToken: false', async () => {
      const { createSupabaseClient } = await import('./supabase-client');
      createSupabaseClient('https://test.supabase.co', 'service-role-key');

      const auth = createClientCalls[0].options.auth as Record<string, unknown>;
      expect(auth.autoRefreshToken).toBe(false);
    });

    it('returns the supabase client instance', async () => {
      const { createSupabaseClient } = await import('./supabase-client');
      const client = createSupabaseClient('https://test.supabase.co', 'service-role-key');

      expect(client).toBe(mockClient);
    });
  });

  describe('initSupabase / supabase singleton', () => {
    it('initSupabase sets the singleton accessible via supabase export', async () => {
      const mod = await import('./supabase-client');
      mod.initSupabase('https://test.supabase.co', 'service-role-key');

      expect(mod.supabase).toBe(mockClient);
    });

    it('initSupabase overwrites previous singleton', async () => {
      const mod = await import('./supabase-client');
      mod.initSupabase('https://test.supabase.co', 'key-one');
      mod.initSupabase('https://test.supabase.co', 'key-two');

      // Should have been called twice
      expect(createClientCalls).toHaveLength(2);
      expect(mod.supabase).toBe(mockClient);
    });
  });
});
