#!/usr/bin/env node

/**
 * Sentry Monitoring Test Script
 *
 * Triggers a test error to verify the complete monitoring pipeline:
 * - Sentry error capture
 * - User context enrichment
 * - Breadcrumb tracking
 * - Alert notifications (Slack + Email)
 *
 * Usage: node scripts/test-sentry-monitoring.js [url]
 */

require('dotenv').config({ path: '.env.local' });

const SENTRY_TEST_KEY = process.env.SENTRY_TEST_KEY || 'test-monitoring-story-1-8';
const BASE_URL = process.argv[2] || 'https://aureon.tractis.ai';

async function testSentryMonitoring() {
  console.log('🧪 Testing Sentry Monitoring Pipeline...\n');
  console.log(`📍 Target: ${BASE_URL}/api/test-sentry\n`);

  try {
    const response = await fetch(`${BASE_URL}/api/test-sentry?key=${SENTRY_TEST_KEY}`);
    const data = await response.json();

    if (response.ok && data.success) {
      console.log('✅ Test error triggered successfully!\n');
      console.log('📊 Sentry Event ID:', data.eventId);
      console.log('\n📋 Verification Steps:');
      data.instructions.forEach((step, i) => {
        console.log(`   ${i + 1}. ${step}`);
      });
      console.log('\n⏱️  Wait 30-60 seconds for alerts to arrive...');
      console.log('\n✨', data.nextSteps);
    } else {
      console.error('❌ Test failed:', data);
      process.exit(1);
    }

  } catch (error) {
    console.error('❌ Error running test:', error.message);
    process.exit(1);
  }
}

testSentryMonitoring();
