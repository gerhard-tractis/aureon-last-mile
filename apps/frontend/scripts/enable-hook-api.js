#!/usr/bin/env node
const https = require('https');

const ACCESS_TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
if (!ACCESS_TOKEN) {
  console.error('Missing SUPABASE_ACCESS_TOKEN (Supabase personal access token). Export it before running this script.');
  process.exit(1);
}
const PROJECT_REF = 'wfwlcpnkkxxzdvhvvsxb';

// Try updating with exact field names from Supabase docs
const hookConfig = {
  'HOOK_CUSTOM_ACCESS_TOKEN_ENABLED': 'true',
  'HOOK_CUSTOM_ACCESS_TOKEN_URI': 'pg-functions://postgres/public/custom_access_token_hook'
};

console.log('🔧 Enabling Auth Hook via Management API...\n');
console.log('Config:', JSON.stringify(hookConfig, null, 2), '\n');

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
    console.log('Status:', res.statusCode);
    console.log('Response:', responseData.substring(0, 500));

    if (res.statusCode === 200 || res.statusCode === 201) {
      console.log('\n✅ Success! Verifying...\n');

      // Verify by re-fetching config
      setTimeout(() => {
        const verifyOptions = {...options, method: 'GET'};
        const verifyReq = https.request(verifyOptions, (verifyRes) => {
          let verifyData = '';
          verifyRes.on('data', (chunk) => { verifyData += chunk; });
          verifyRes.on('end', () => {
            const config = JSON.parse(verifyData);
            console.log('Hook Enabled:', config.HOOK_CUSTOM_ACCESS_TOKEN_ENABLED);
            console.log('Hook URI:', config.HOOK_CUSTOM_ACCESS_TOKEN_URI);

            if (config.HOOK_CUSTOM_ACCESS_TOKEN_ENABLED) {
              console.log('\n🎉 Auth Hook SUCCESSFULLY REGISTERED!\n');
            }
          });
        });
        verifyReq.end();
      }, 2000);
    } else {
      console.log('\n❌ Failed to enable hook');
    }
  });
});

req.on('error', (error) => {
  console.error('Error:', error.message);
});

req.write(data);
req.end();
