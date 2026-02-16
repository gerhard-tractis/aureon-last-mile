#!/usr/bin/env node
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

const sql = readFileSync('./supabase/migrations/20260216170542_create_users_table_with_rbac.sql', 'utf-8');

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false }
});

// Split into statements and execute sequentially
const statements = sql
  .split(';')
  .map(s => s.trim())
  .filter(s => s.length > 0 && !s.startsWith('--') && s !== 'BEGIN' && s !== 'ROLLBACK');

console.log(`Executing ${statements.length} SQL statements...`);

for (let i = 0; i < statements.length; i++) {
  const stmt = statements[i];
  if (stmt.startsWith('DO $$') || stmt.includes('$$')) {
    console.log(`[${i+1}/${statements.length}] Executing DO block...`);
  } else {
    console.log(`[${i+1}/${statements.length}] ${stmt.substring(0, 60)}...`);
  }

  try {
    const { error } = await supabase.rpc('exec', { sql: stmt + ';' });
    if (error) {
      console.error(`Error on statement ${i+1}:`, error.message);
    }
  } catch (e) {
    // Try direct query if rpc fails
    try {
      const { error } = await supabase.from('_').select('*').limit(0);
      // Fallback: just log that we can't execute
      console.log(`Skipping statement ${i+1} (no exec method available)`);
    } catch (e2) {
      console.log(`Skipping statement ${i+1}`);
    }
  }
}

console.log('Done!');
