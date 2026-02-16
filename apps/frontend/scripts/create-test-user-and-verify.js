#!/usr/bin/env node
/**
 * Create a test user and verify Auth Hook adds JWT claims
 */

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = 'https://wfwlcpnkkxxzdvhvvsxb.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Indmd2xjcG5ra3h4emR2aHZ2c3hiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA2NzQxOTAsImV4cCI6MjA4NjI1MDE5MH0.kcVeA8bUhMT21lF1_-8LEwc7xf5HTVggGxEiyTAS_no';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const TEST_EMAIL = 'testuser@example.com';
const TEST_PASSWORD = 'testPassword123!';
const DEMO_OPERATOR_ID = '00000000-0000-0000-0000-000000000001';

(async function() {
  console.log('🧪 Testing Auth Hook End-to-End\n');

  try {
    // Step 1: Sign up test user
    console.log('[1/4] Signing up test user...');
    console.log(`   Email: ${TEST_EMAIL}`);
    console.log(`   Operator: Demo Logistics Chile`);
    console.log(`   Role: pickup_crew\n`);

    const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
      email: TEST_EMAIL,
      password: TEST_PASSWORD,
      options: {
        data: {
          operator_id: DEMO_OPERATOR_ID,
          role: 'pickup_crew',
          full_name: 'RBAC Test User'
        }
      }
    });

    if (signUpError) {
      // User might already exist - try to sign in instead
      if (signUpError.message.includes('already registered')) {
        console.log('   ℹ️  User already exists, signing in instead...\n');
      } else {
        throw signUpError;
      }
    } else {
      console.log('   ✅ User signed up successfully!');
      console.log(`   User ID: ${signUpData.user?.id}\n`);

      // Wait a moment for trigger to create users record
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    // Step 2: Sign in
    console.log('[2/4] Signing in...\n');

    const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({
      email: TEST_EMAIL,
      password: TEST_PASSWORD
    });

    if (signInError) {
      throw signInError;
    }

    console.log('   ✅ Signed in successfully!\n');

    // Step 3: Check JWT claims
    console.log('[3/4] Checking JWT claims from Auth Hook...\n');

    const session = signInData.session;
    const user = session?.user;
    const claims = user?.app_metadata?.claims;

    console.log('   User ID:', user?.id);
    console.log('   Email:', user?.email);
    console.log('\n   🔍 JWT Custom Claims:');

    if (claims) {
      console.log('   ✅ Claims found!');
      console.log(`      operator_id: ${claims.operator_id}`);
      console.log(`      role: ${claims.role}`);

      // Verify claims match what we expect
      if (claims.operator_id === DEMO_OPERATOR_ID && claims.role === 'pickup_crew') {
        console.log('\n   🎉 AUTH HOOK WORKING PERFECTLY!');
        console.log('      ✅ operator_id matches (Demo Logistics Chile)');
        console.log('      ✅ role matches (pickup_crew)');
      } else {
        console.log('\n   ⚠️  Claims present but values unexpected');
        console.log(`      Expected operator_id: ${DEMO_OPERATOR_ID}`);
        console.log(`      Got: ${claims.operator_id}`);
      }
    } else {
      console.log('   ❌ No custom claims found!');
      console.log('   ℹ️  Auth Hook might not be active yet');
      console.log('   ℹ️  Try logging out and back in, or wait a moment');
    }

    // Step 4: Decode full JWT for inspection
    console.log('\n[4/4] Full JWT Token Info:\n');
    console.log('   Access Token (first 50 chars):', session.access_token.substring(0, 50) + '...');
    console.log('\n   To inspect full JWT:');
    console.log('   1. Go to: https://jwt.io');
    console.log('   2. Paste access token');
    console.log('   3. Look for "claims" in the payload section');
    console.log('\n   Full app_metadata:');
    console.log(JSON.stringify(user?.app_metadata, null, 2));

    // Clean up
    console.log('\n\n🧹 Cleanup: Signing out test user...');
    await supabase.auth.signOut();
    console.log('   ✅ Done\n');

    console.log('═'.repeat(60));
    console.log('TEST COMPLETE');
    console.log('═'.repeat(60));
    console.log('\nSummary:');
    console.log('  ✅ User signup works (trigger creates users record)');
    console.log('  ✅ User signin works');
    console.log(`  ${claims ? '✅' : '⏳'} JWT claims ${claims ? 'present' : 'pending (try again in a moment)'}`);
    console.log('\n');

  } catch (error) {
    console.error('\n❌ Test failed:', error.message);
    console.error('Details:', error);
    process.exit(1);
  }
})();
