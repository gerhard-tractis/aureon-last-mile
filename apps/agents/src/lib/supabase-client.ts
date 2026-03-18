// src/lib/supabase-client.ts — Supabase admin client singleton
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { log } from './logger';

export function createSupabaseClient(url: string, serviceRoleKey: string): SupabaseClient {
  return createClient(url, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

// Singleton instance — set by initSupabase()
export let supabase: SupabaseClient = null as unknown as SupabaseClient;

export function initSupabase(url: string, key: string): void {
  supabase = createSupabaseClient(url, key);
  log('info', 'supabase_client_initialized');
}
