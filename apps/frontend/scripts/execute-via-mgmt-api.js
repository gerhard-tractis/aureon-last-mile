#!/usr/bin/env node
/**
 * Execute migration using Supabase Management API
 * Uses SUPABASE_ACCESS_TOKEN for authentication
 */

const https = require('https');
const { readFileSync } = require('fs');
const { join } = require('path');

const ACCESS_TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
if (!ACCESS_TOKEN) {
  console.error('Missing SUPABASE_ACCESS_TOKEN (Supabase personal access token). Export it before running this script.');
  process.exit(1);
}
const PROJECT_REF = 'wfwlcpnkkxxzdvhvvsxb';

// Read migration SQL
const migrationPath = join(__dirname, '../supabase/migrations/20260216170542_create_users_table_with_rbac.sql');
const sql = readFileSync(migrationPath, 'utf-8');

console.log('Migration file:', migrationPath);
console.log('SQL size:', sql.length, 'bytes');

console.log('🚀 Executing migration via Supabase Management API...\n');

// Properly escape SQL for JSON
const data = JSON.stringify({
  query: sql
}, null, 0);  // No pretty printing to avoid issues

const options = {
  hostname: 'api.supabase.com',
  port: 443,
  path: `/v1/projects/${PROJECT_REF}/database/query`,
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${ACCESS_TOKEN}`,
    'Content-Type': 'application/json',
    'Content-Length': data.length
  }
};

const req = https.request(options, (res) => {
  let responseData = '';

  res.on('data', (chunk) => {
    responseData += chunk;
  });

  res.on('end', () => {
    console.log('\nStatus:', res.statusCode);

    if (res.statusCode === 200 || res.statusCode === 201) {
      console.log('✅ Migration executed successfully!');
      console.log('\nResponse preview:', responseData.substring(0, 500));
      if (responseData.length > 500) {
        console.log(`... (${responseData.length - 500} more characters)`);
      }
    } else {
      console.error('❌ Migration failed!');
      console.error('Response:', responseData);
      process.exit(1);
    }
  });
});

req.on('error', (error) => {
  console.error('❌ Request failed:', error.message);
  process.exit(1);
});

req.write(data);
req.end();
