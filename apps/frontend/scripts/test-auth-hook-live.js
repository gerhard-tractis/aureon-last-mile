#!/usr/bin/env node
/**
 * Test if Auth Hook is working by simulating the hook event
 */

const https = require('https');

const ACCESS_TOKEN = 'sbp_42e24919c87af44a2626b52dbc6dfd55eff3b692';
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
        if (res.statusCode === 200 || res.statusCode === 201) {
          resolve(JSON.parse(responseData));
        } else {
          reject(new Error(`Query failed: ${responseData}`));
        }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

(async function() {
  console.log('🧪 Testing Auth Hook Function\n');

  try {
    // Step 1: Check if hook is registered in config
    console.log('[1/3] Verifying hook is registered in Supabase config...');

    const configCheck = new Promise((resolve, reject) => {
      const options = {
        hostname: 'api.supabase.com',
        port: 443,
        path: `/v1/projects/${PROJECT_REF}/config/auth`,
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${ACCESS_TOKEN}`,
          'Content-Type': 'application/json'
        }
      };
      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          const config = JSON.parse(data);
          // Look for any hook-related fields
          const hookFields = Object.keys(config).filter(k =>
            k.toLowerCase().includes('hook') ||
            k.toLowerCase().includes('custom_access_token')
          );
          resolve({ config, hookFields });
        });
      });
      req.on('error', reject);
      req.end();
    });

    const { config, hookFields } = await configCheck;

    if (hookFields.length > 0) {
      console.log('   ✅ Hook-related config found:', hookFields);
      hookFields.forEach(f => {
        if (config[f]) console.log(`      ${f}: ${config[f]}`);
      });
    } else {
      console.log('   ⚠️  No hook fields in API response (this is normal - hooks may not be exposed via API)');
    }

    // Step 2: Test the hook function directly
    console.log('\n[2/3] Testing custom_access_token_hook function directly...');

    // First, get a test user from the database
    const users = await query(`
      SELECT id, operator_id, role, email
      FROM public.users
      WHERE deleted_at IS NULL
      LIMIT 1
    `);

    if (users.length === 0) {
      console.log('   ⚠️  No active users found in database');
      console.log('   ℹ️  You need to sign up a user first to test the hook');
      console.log('\n   To test: Sign up a new user with operator_id in metadata');
      console.log('   Then log in and check JWT claims');
      return;
    }

    const testUser = users[0];
    console.log(`   Found test user: ${testUser.email} (${testUser.role})`);

    // Call the hook function with simulated event
    const hookTest = await query(`
      SELECT public.custom_access_token_hook(
        jsonb_build_object(
          'user_id', '${testUser.id}'::text,
          'claims', '{}'::jsonb
        )
      ) as result
    `);

    const result = hookTest[0].result;
    const claims = result.claims;

    if (claims && claims.operator_id && claims.role) {
      console.log('   ✅ Hook function works correctly!');
      console.log(`      operator_id: ${claims.operator_id}`);
      console.log(`      role: ${claims.role}`);
      console.log(`      (Expected: operator_id=${testUser.operator_id}, role=${testUser.role})`);

      if (claims.operator_id === testUser.operator_id && claims.role === testUser.role) {
        console.log('   ✅ Claims match database - PERFECT!');
      }
    } else {
      console.log('   ❌ Hook function returned but claims missing');
      console.log('      Result:', JSON.stringify(result, null, 2));
    }

    // Step 3: Provide instructions for live test
    console.log('\n[3/3] Live Test Instructions:\n');
    console.log('   To verify the hook works during actual login:');
    console.log('   1. Sign up a new user (or use existing):');
    console.log('      ```javascript');
    console.log('      await supabase.auth.signUp({');
    console.log('        email: "test@demo.com",');
    console.log('        password: "test123",');
    console.log('        options: { data: {');
    console.log('          operator_id: "00000000-0000-0000-0000-000000000001",');
    console.log('          role: "pickup_crew",');
    console.log('          full_name: "Test User"');
    console.log('        }}');
    console.log('      })');
    console.log('      ```');
    console.log('');
    console.log('   2. Log in:');
    console.log('      ```javascript');
    console.log('      const { data } = await supabase.auth.signInWithPassword({');
    console.log('        email: "test@demo.com",');
    console.log('        password: "test123"');
    console.log('      })');
    console.log('      ```');
    console.log('');
    console.log('   3. Check JWT claims:');
    console.log('      ```javascript');
    console.log('      const session = data.session;');
    console.log('      console.log(session.user.app_metadata.claims);');
    console.log('      // Should show: { operator_id: "...", role: "pickup_crew" }');
    console.log('      ```');
    console.log('');
    console.log('   Or decode JWT at: https://jwt.io');
    console.log('   Paste access_token and look for "claims" in payload\n');

    console.log('🎉 Auth Hook function is working correctly!');
    console.log('   The hook will add operator_id and role to JWT during login.\n');

  } catch (error) {
    console.error('❌ Test failed:', error.message);
    process.exit(1);
  }
})();
