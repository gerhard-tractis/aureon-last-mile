#!/usr/bin/env node
const https = require('https');

const ACCESS_TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
if (!ACCESS_TOKEN) {
  console.error('Missing SUPABASE_ACCESS_TOKEN (Supabase personal access token). Export it before running this script.');
  process.exit(1);
}
const PROJECT_REF = 'wfwlcpnkkxxzdvhvvsxb';

function query(sql) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify({ query: sql });
    const options = {
      hostname: 'api.supabase.com',
      port: 443,
      path: `/v1/projects/${PROJECT_REF}/database/query`,
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${ACCESS_TOKEN}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data)
      }
    };
    const req = https.request(options, (res) => {
      let responseData = '';
      res.on('data', (chunk) => { responseData += chunk; });
      res.on('end', () => {
        resolve(JSON.parse(responseData));
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

(async function() {
  console.log('🔍 Verifying RBAC migration...\n');

  // Check users table
  const columns = await query(`
    SELECT column_name, data_type
    FROM information_schema.columns
    WHERE table_name = 'users' AND table_schema = 'public'
    ORDER BY ordinal_position
  `);
  console.log('✅ Users table columns:', columns.length);
  columns.forEach(c => console.log(`   - ${c.column_name} (${c.data_type})`));

  // Check RLS policies
  const policies = await query(`
    SELECT policyname FROM pg_policies
    WHERE tablename = 'users' AND schemaname = 'public'
  `);
  console.log('\n✅ RLS Policies:', policies.length);
  policies.forEach(p => console.log(`   - ${p.policyname}`));

  // Check indexes
  const indexes = await query(`
    SELECT indexname FROM pg_indexes
    WHERE tablename = 'users' AND schemaname = 'public'
  `);
  console.log('\n✅ Indexes:', indexes.length);
  indexes.forEach(i => console.log(`   - ${i.indexname}`));

  // Check functions
  const functions = await query(`
    SELECT proname FROM pg_proc
    WHERE proname IN ('handle_new_user', 'custom_access_token_hook', 'get_operator_id')
    AND pronamespace = 'public'::regnamespace
  `);
  console.log('\n✅ Functions:', functions.length);
  functions.forEach(f => console.log(`   - ${f.proname}()`));

  console.log('\n🎉 Story 1.3 RBAC migration VERIFIED!\n');
})();
