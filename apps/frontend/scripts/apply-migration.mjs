#!/usr/bin/env node
/**
 * Migration Application Script
 * Story 1.3: Apply users table RBAC migration to Supabase
 * Uses service role key for admin database access
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Configuration - Load from environment variables
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://wfwlcpnkkxxzdvhvvsxb.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Validate required environment variables
if (!SUPABASE_SERVICE_KEY) {
  console.error('❌ ERROR: SUPABASE_SERVICE_ROLE_KEY environment variable not set');
  console.error('\nSet the service role key from Supabase Dashboard:');
  console.error('  export SUPABASE_SERVICE_ROLE_KEY="your-service-role-key-here"');
  console.error('\nOr create .env file with:');
  console.error('  SUPABASE_SERVICE_ROLE_KEY=your-service-role-key-here\n');
  process.exit(1);
}

// Migration file path
const MIGRATION_FILE = join(__dirname, '../supabase/migrations/20260216170542_create_users_table_with_rbac.sql');

async function applyMigration() {
  console.log('🚀 Starting migration application...\n');

  try {
    // Read migration SQL
    console.log(`📄 Reading migration file: ${MIGRATION_FILE}`);
    const migrationSQL = readFileSync(MIGRATION_FILE, 'utf-8');
    console.log(`✓ Migration SQL loaded (${migrationSQL.length} characters)\n`);

    // Create Supabase client with service role (bypasses RLS)
    console.log('🔐 Connecting to Supabase with service role...');
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    });
    console.log('✓ Connected to Supabase\n');

    // Execute migration SQL
    console.log('⚙️  Executing migration SQL...');
    const { data, error } = await supabase.rpc('exec_sql', { sql: migrationSQL });

    if (error) {
      // Try direct query if rpc doesn't exist
      console.log('⚠️  RPC exec_sql not available, trying direct query...');

      // Split migration into statements and execute sequentially
      const statements = migrationSQL
        .split(';')
        .map(s => s.trim())
        .filter(s => s.length > 0 && !s.startsWith('--'));

      for (let i = 0; i < statements.length; i++) {
        const statement = statements[i] + ';';
        console.log(`  Executing statement ${i + 1}/${statements.length}...`);

        const { error: stmtError } = await supabase.rpc('exec_sql', { sql: statement });

        if (stmtError) {
          console.error(`❌ Statement ${i + 1} failed:`, stmtError.message);
          throw stmtError;
        }
      }
    }

    console.log('\n✅ Migration applied successfully!');
    console.log('\n📋 Next steps:');
    console.log('1. Verify users table exists in Supabase Dashboard (Database > Tables)');
    console.log('2. Check RLS policies (Database > users > Policies)');
    console.log('3. Register custom_access_token_hook in Dashboard (Authentication > Hooks > Custom Access Token)');
    console.log('4. Run test suite: apps/frontend/supabase/tests/rbac_users_test.sql\n');

  } catch (err) {
    console.error('\n❌ Migration failed:', err.message);
    console.error('\n⚠️  Manual application recommended:');
    console.error('1. Open Supabase Dashboard (https://wfwlcpnkkxxzdvhvvsxb.supabase.co)');
    console.error('2. Navigate to SQL Editor');
    console.error('3. Copy contents of: apps/frontend/supabase/migrations/20260216170542_create_users_table_with_rbac.sql');
    console.error('4. Paste and execute in SQL Editor');
    console.error('5. Verify in Table Editor\n');
    process.exit(1);
  }
}

applyMigration();
