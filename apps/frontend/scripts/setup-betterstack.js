#!/usr/bin/env node

/**
 * BetterStack Automated Setup Script
 *
 * Creates uptime monitors and SSL checks for Aureon Last Mile
 *
 * Usage: node scripts/setup-betterstack.js
 */

require('dotenv').config({ path: '.env.local' });

const BETTERSTACK_API_KEY = process.env.BETTERSTACK_API_KEY;
const BASE_URL = 'https://uptime.betterstack.com/api/v2';

if (!BETTERSTACK_API_KEY) {
  console.error('❌ BETTERSTACK_API_KEY not found in .env.local');
  process.exit(1);
}

async function createMonitor(monitorConfig) {
  const response = await fetch(`${BASE_URL}/monitors`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${BETTERSTACK_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(monitorConfig),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to create monitor: ${response.status} ${error}`);
  }

  return response.json();
}

async function setupMonitors() {
  console.log('🚀 Setting up BetterStack monitors...\n');

  try {
    // Monitor 1: Frontend (Main Application)
    console.log('📊 Creating frontend monitor...');
    const frontendMonitor = await createMonitor({
      url: 'https://app.aureon.com',
      monitor_type: 'status',
      pronounceable_name: 'Aureon Frontend',
      check_frequency: 300, // 5 minutes in seconds
      request_timeout: 30,
      expected_status_codes: [200],
      regions: ['us', 'eu'],
      call: false, // Don't call on failure (optional, can enable later)
      sms: false,  // Don't SMS on failure (optional, can enable later)
      email: true, // Email on failure
      paused: false,
    });
    console.log('✅ Frontend monitor created:', frontendMonitor.data?.attributes?.url);

    // Monitor 2: Health Check (Backend API)
    console.log('\n📊 Creating health check monitor...');
    const healthMonitor = await createMonitor({
      url: 'https://app.aureon.com/api/health',
      monitor_type: 'status',
      pronounceable_name: 'Aureon Health Check',
      check_frequency: 300,
      request_timeout: 10,
      expected_status_codes: [200],
      required_keyword: 'healthy', // Must contain "healthy" in response
      regions: ['us', 'eu'],
      call: false,
      sms: false,
      email: true,
      paused: false,
    });
    console.log('✅ Health check monitor created:', healthMonitor.data?.attributes?.url);

    // Monitor 3: SSL Certificate (via status monitor with SSL check)
    console.log('\n🔒 Note: SSL certificate monitoring is automatic with HTTPS monitors');
    console.log('   BetterStack checks SSL expiration on all HTTPS endpoints');
    console.log('   Configure SSL alert threshold in dashboard: Settings → SSL Alerts');

    console.log('\n✨ All monitors created successfully!');
    console.log('\n📋 Next steps:');
    console.log('1. Visit https://uptime.betterstack.com to see your monitors');
    console.log('2. Monitors will check every 5 minutes');
    console.log('3. You\'ll receive email alerts if anything goes down');
    console.log('\n💡 Tip: Configure SMS alerts in BetterStack dashboard for critical alerts');

  } catch (error) {
    console.error('\n❌ Error setting up monitors:', error.message);

    if (error.message.includes('401')) {
      console.error('\n🔑 API key might be invalid. Check BETTERSTACK_API_KEY in .env.local');
    }

    if (error.message.includes('422')) {
      console.error('\n⚠️  Monitor might already exist. Check BetterStack dashboard.');
    }

    process.exit(1);
  }
}

// Run setup
setupMonitors();
