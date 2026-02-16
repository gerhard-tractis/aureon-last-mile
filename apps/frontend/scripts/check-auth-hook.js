#!/usr/bin/env node
const https = require('https');

const ACCESS_TOKEN = 'sbp_42e24919c87af44a2626b52dbc6dfd55eff3b692';
const PROJECT_REF = 'wfwlcpnkkxxzdvhvvsxb';

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
    console.log('🔍 Custom Access Token Hook Status:\n');
    console.log('   Enabled:', config.HOOK_CUSTOM_ACCESS_TOKEN_ENABLED);
    console.log('   URI:', config.HOOK_CUSTOM_ACCESS_TOKEN_URI);

    if (config.HOOK_CUSTOM_ACCESS_TOKEN_ENABLED === true) {
      console.log('\n✅ Auth Hook is ACTIVE!');
      console.log('🎉 Story 1.3 is 100% COMPLETE!\n');
    } else {
      console.log('\n⚠️  Auth Hook not yet enabled');
      console.log('Manual registration required in Dashboard\n');
    }
  });
});

req.on('error', (error) => {
  console.error('Error:', error.message);
});

req.end();
