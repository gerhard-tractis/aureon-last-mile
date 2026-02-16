#!/usr/bin/env node
/**
 * Direct migration application using PostgreSQL connection
 * Bypasses Supabase CLI migration history issues
 */

const { readFileSync } = require('fs');
const { join } = require('path');

// Read migration SQL
const migrationPath = join(__dirname, '../supabase/migrations/20260216170542_create_users_table_with_rbac.sql');
const sql = readFileSync(migrationPath, 'utf-8');

console.log('📦 Installing pg library...');

// Dynamic import of pg library
const executeMigration = async () => {
  let pg;
  try {
    pg = require('pg');
  } catch (e) {
    console.log('pg not found, installing...');
    const { execSync } = require('child_process');
    execSync('npm install pg', { stdio: 'inherit', cwd: join(__dirname, '..') });
    pg = require('pg');
  }

  const { Client } = pg;

  // Connection config - Direct connection (non-pooler)
  const client = new Client({
    host: 'db.wfwlcpnkkxxzdvhvvsxb.supabase.co',
    port: 5432,
    user: 'postgres',
    password: process.env.SUPABASE_SERVICE_KEY,
    database: 'postgres',
    ssl: { rejectUnauthorized: false }
  });

  try {
    console.log('🔌 Connecting to Supabase database...');
    await client.connect();
    console.log('✅ Connected!\n');

    console.log('🚀 Executing migration SQL...');
    console.log('   File: 20260216170542_create_users_table_with_rbac.sql');
    console.log('   Size:', sql.length, 'bytes\n');

    // Execute the migration
    const result = await client.query(sql);

    console.log('\n✅ Migration applied successfully!');
    console.log('\n📋 Notices received:');
    if (result.notices) {
      result.notices.forEach(notice => console.log('   ', notice));
    }

    // Verify users table was created
    const verifyResult = await client.query(`
      SELECT table_name, column_name, data_type
      FROM information_schema.columns
      WHERE table_name = 'users' AND table_schema = 'public'
      ORDER BY ordinal_position
    `);

    if (verifyResult.rows.length > 0) {
      console.log('\n✅ Verification: users table created with', verifyResult.rows.length, 'columns:');
      verifyResult.rows.forEach(col => {
        console.log(`   - ${col.column_name} (${col.data_type})`);
      });
    }

    // Check RLS policies
    const policiesResult = await client.query(`
      SELECT policyname
      FROM pg_policies
      WHERE tablename = 'users' AND schemaname = 'public'
    `);

    console.log('\n✅ RLS Policies created:', policiesResult.rows.length);
    policiesResult.rows.forEach(policy => {
      console.log(`   - ${policy.policyname}`);
    });

    // Check indexes
    const indexesResult = await client.query(`
      SELECT indexname
      FROM pg_indexes
      WHERE tablename = 'users' AND schemaname = 'public'
    `);

    console.log('\n✅ Indexes created:', indexesResult.rows.length);
    indexesResult.rows.forEach(idx => {
      console.log(`   - ${idx.indexname}`);
    });

    console.log('\n🎉 Story 1.3 RBAC migration complete!');
    console.log('\n⚠️  Next manual step:');
    console.log('   Register custom_access_token_hook in Supabase Dashboard');
    console.log('   (Authentication > Hooks > Custom Access Token)\n');

  } catch (error) {
    console.error('\n❌ Migration failed:', error.message);
    if (error.code) console.error('   Error code:', error.code);
    if (error.detail) console.error('   Detail:', error.detail);
    if (error.hint) console.error('   Hint:', error.hint);
    process.exit(1);
  } finally {
    await client.end();
  }
};

executeMigration();
