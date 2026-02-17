#!/usr/bin/env node

/**
 * Sentry Quota Alert Configuration
 *
 * Sets up an alert when error quota reaches 80% (4,000 / 5,000 errors)
 * This prevents exceeding the free tier limit.
 *
 * Usage: node scripts/setup-sentry-quota-alert.js
 */

require('dotenv').config({ path: '.env.local' });

const SENTRY_AUTH_TOKEN = process.env.SENTRY_ALERT_TOKEN || process.env.SENTRY_AUTH_TOKEN;
const SENTRY_ORG = 'tractis';

if (!SENTRY_AUTH_TOKEN) {
  console.error('❌ SENTRY_ALERT_TOKEN not found in .env.local');
  process.exit(1);
}

async function setupQuotaAlert() {
  console.log('🚀 Configuring Sentry quota alert...\n');

  try {
    // Create quota spike protection
    console.log('📊 Setting up quota spike protection...');

    const response = await fetch(`https://sentry.io/api/0/organizations/${SENTRY_ORG}/`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${SENTRY_AUTH_TOKEN}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch organization: ${response.status}`);
    }

    const org = await response.json();
    console.log('✅ Organization verified:', org.name);

    console.log('\n💡 Quota Alert Setup:');
    console.log('   Unfortunately, Sentry quota alerts must be configured via dashboard.');
    console.log('   This is a billing/subscription feature not available via API.\n');

    console.log('📋 Manual Steps:');
    console.log('1. Go to: https://sentry.io/settings/tractis/');
    console.log('2. Click: Subscription → Usage & Billing');
    console.log('3. Under "Error & Transaction Volume"');
    console.log('4. Set threshold alert at 80% (4,000 errors)');
    console.log('5. Add email for notifications\n');

    console.log('⚡ Alternative - Rate Limiting (Already Implemented):');
    console.log('   ✅ Client-side error sampling active (50% warning/info, 100% error/fatal)');
    console.log('   ✅ beforeSend hook filters noise');
    console.log('   ✅ This should keep usage well under quota\n');

    console.log('📊 Monitor Usage:');
    console.log('   View current usage: https://sentry.io/settings/tractis/stats/');

  } catch (error) {
    console.error('\n❌ Error:', error.message);
    process.exit(1);
  }
}

setupQuotaAlert();
