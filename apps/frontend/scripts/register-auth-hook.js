#!/usr/bin/env node
/**
 * Register custom_access_token_hook via Supabase Management API
 */

const https = require('https');

const ACCESS_TOKEN = 'sbp_42e24919c87af44a2626b52dbc6dfd55eff3b692';
const PROJECT_REF = 'wfwlcpnkkxxzdvhvvsxb';

console.log('🔧 Attempting to register Auth Hook via Management API...\n');

// Step 1: Get current auth config
function getAuthConfig() {
  return new Promise((resolve, reject) => {
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
        if (res.statusCode === 200) {
          resolve(JSON.parse(data));
        } else {
          reject(new Error(`GET config failed (${res.statusCode}): ${data}`));
        }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

// Step 2: Update auth config with custom access token hook
function updateAuthConfig(config) {
  return new Promise((resolve, reject) => {
    // Send ONLY the hook configuration fields
    const hookConfig = {
      HOOK_CUSTOM_ACCESS_TOKEN_ENABLED: true,
      HOOK_CUSTOM_ACCESS_TOKEN_URI: 'pg-functions://postgres/public/custom_access_token_hook'
    };

    const data = JSON.stringify(hookConfig);

    const options = {
      hostname: 'api.supabase.com',
      port: 443,
      path: `/v1/projects/${PROJECT_REF}/config/auth`,
      method: 'PATCH',
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
          reject(new Error(`PATCH config failed (${res.statusCode}): ${responseData}`));
        }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

(async function() {
  try {
    // Get current config
    console.log('📥 Fetching current auth configuration...');
    const currentConfig = await getAuthConfig();
    console.log('✅ Current config retrieved');

    // Check if already enabled
    if (currentConfig.HOOK_CUSTOM_ACCESS_TOKEN_ENABLED) {
      console.log('\n✅ Custom Access Token Hook is already enabled!');
      console.log('   URI:', currentConfig.HOOK_CUSTOM_ACCESS_TOKEN_URI);
      console.log('\n🎉 No action needed - Story 1.3 is 100% complete!\n');
      return;
    }

    // Update config
    console.log('\n📤 Enabling Custom Access Token Hook...');
    const updatedConfig = await updateAuthConfig(currentConfig);

    console.log('✅ Auth Hook registered successfully!');
    console.log('   Enabled:', updatedConfig.HOOK_CUSTOM_ACCESS_TOKEN_ENABLED);
    console.log('   URI:', updatedConfig.HOOK_CUSTOM_ACCESS_TOKEN_URI);
    console.log('\n🎉 Story 1.3 is now 100% COMPLETE!\n');

  } catch (error) {
    console.error('\n❌ Failed to register Auth Hook via API:', error.message);
    console.log('\n⚠️  Manual registration still required:');
    console.log('   1. Open: https://wfwlcpnkkxxzdvhvvsxb.supabase.co/project/wfwlcpnkkxxzdvhvvsxb/settings/auth');
    console.log('   2. Click "Hooks" tab');
    console.log('   3. Enable "Custom Access Token"');
    console.log('   4. Select: public.custom_access_token_hook');
    console.log('   5. Save\n');
    process.exit(1);
  }
})();
