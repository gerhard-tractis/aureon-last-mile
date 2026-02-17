#!/usr/bin/env node

/**
 * Direct Sentry Test
 *
 * Tests if Sentry is receiving events by checking the API directly
 */

require('dotenv').config({ path: '.env.local' });

const SENTRY_AUTH_TOKEN = process.env.SENTRY_ALERT_TOKEN || process.env.SENTRY_AUTH_TOKEN;
const SENTRY_ORG = 'tractis';
const SENTRY_PROJECT = 'aureon-last-mile';

async function checkRecentEvents() {
  console.log('🔍 Checking recent Sentry events...\n');

  try {
    // Get recent issues
    const response = await fetch(
      `https://sentry.io/api/0/projects/${SENTRY_ORG}/${SENTRY_PROJECT}/issues/?query=&statsPeriod=24h`,
      {
        headers: { 'Authorization': `Bearer ${SENTRY_AUTH_TOKEN}` },
      }
    );

    if (!response.ok) {
      throw new Error(`API request failed: ${response.status}`);
    }

    const issues = await response.json();

    console.log(`📊 Issues in last 24 hours: ${issues.length}\n`);

    if (issues.length === 0) {
      console.log('❌ NO ISSUES FOUND');
      console.log('\nPossible reasons:');
      console.log('1. Sentry client not initializing (check browser console for errors)');
      console.log('2. SENTRY_DSN not set correctly in production environment');
      console.log('3. Errors being filtered by beforeSend hook');
      console.log('4. Sentry SDK not loaded (check network tab for sentry requests)');
      console.log('\n🔧 Debug steps:');
      console.log('1. Open browser console at https://aureon.tractis.ai');
      console.log('2. Look for Sentry initialization errors');
      console.log('3. Check Network tab for requests to "ingest.sentry.io"');
      console.log('4. Verify SENTRY_DSN in browser: localStorage or window.__SENTRY__');
    } else {
      console.log('✅ Sentry IS receiving events!\n');
      issues.forEach((issue, i) => {
        console.log(`${i + 1}. ${issue.title}`);
        console.log(`   Level: ${issue.level}`);
        console.log(`   Count: ${issue.count}`);
        console.log(`   First seen: ${issue.firstSeen}`);
        console.log(`   Last seen: ${issue.lastSeen}`);
        console.log(`   Link: https://sentry.io/organizations/${SENTRY_ORG}/issues/${issue.id}/\n`);
      });
    }

  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

checkRecentEvents();
