const https = require('https');
const fs = require('fs');

const env = fs.readFileSync('apps/frontend/.env.local', 'utf8');
const anonKey = env.match(/NEXT_PUBLIC_SUPABASE_ANON_KEY=(.+)/)?.[1]?.trim();

// Test with a real order_number from the orders table
const payload = JSON.stringify({
  resource: 'dispatch',
  identifier: 'TEST-001',
  status: 3,
  arrived_at: new Date().toISOString(),
  substatus: 'Cliente ausente'
});

// Pass anon key as Authorization so we can bypass secret check for testing
const req = https.request({
  hostname: 'wfwlcpnkkxxzdvhvvsxb.supabase.co',
  path: '/functions/v1/beetrack-webhook',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer ' + anonKey,
    'Content-Length': Buffer.byteLength(payload)
  }
}, res => {
  let data = '';
  res.on('data', c => data += c);
  res.on('end', () => console.log('HTTP status:', res.statusCode, '\nBody:', data));
});
req.write(payload);
req.end();
