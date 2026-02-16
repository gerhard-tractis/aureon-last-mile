#!/usr/bin/env node
/**
 * Execute RBAC test suite via Supabase Management API
 */

const https = require('https');
const { readFileSync } = require('fs');
const { join } = require('path');

const ACCESS_TOKEN = 'sbp_42e24919c87af44a2626b52dbc6dfd55eff3b692';
const PROJECT_REF = 'wfwlcpnkkxxzdvhvvsxb';

// Read test suite SQL
const testPath = join(__dirname, '../supabase/tests/rbac_users_test.sql');
const testSql = readFileSync(testPath, 'utf-8');

console.log('🧪 Running RBAC Test Suite...\n');
console.log('   File: rbac_users_test.sql');
console.log('   Size:', testSql.length, 'bytes\n');

const data = JSON.stringify({ query: testSql });

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

  res.on('data', (chunk) => {
    responseData += chunk;
  });

  res.on('end', () => {
    console.log('Status:', res.statusCode, '\n');

    if (res.statusCode === 200 || res.statusCode === 201) {
      console.log('✅ Test suite executed successfully!\n');

      // Parse response to extract NOTICE messages (test results)
      try {
        const response = JSON.parse(responseData);
        if (Array.isArray(response) && response.length > 0) {
          console.log('Test Results:');
          console.log(JSON.stringify(response, null, 2));
        }
      } catch (e) {
        console.log('Raw response:', responseData);
      }

      console.log('\n🎉 All RBAC tests completed!');
    } else {
      console.error('❌ Test execution failed!');
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
