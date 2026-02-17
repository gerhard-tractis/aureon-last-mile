#!/usr/bin/env node

/**
 * Check Sentry Alert Rules Configuration
 *
 * Verifies alert rules are properly configured with Slack notifications
 */

require('dotenv').config({ path: '.env.local' });

const SENTRY_AUTH_TOKEN = process.env.SENTRY_ALERT_TOKEN || process.env.SENTRY_AUTH_TOKEN;
const SENTRY_ORG = 'tractis';
const SENTRY_PROJECT = 'aureon-last-mile';
const BASE_URL = `https://sentry.io/api/0/projects/${SENTRY_ORG}/${SENTRY_PROJECT}`;

async function checkAlerts() {
  console.log('🔍 Checking Sentry alert configuration...\n');

  try {
    const response = await fetch(`${BASE_URL}/rules/`, {
      headers: { 'Authorization': `Bearer ${SENTRY_AUTH_TOKEN}` },
    });

    const rules = await response.json();

    console.log(`📊 Found ${rules.length} alert rules:\n`);

    for (const rule of rules) {
      console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
      console.log(`📋 ${rule.name}`);
      console.log(`   ID: ${rule.id}`);
      console.log(`   Environment: ${rule.environment || 'all'}`);
      console.log(`   Status: ${rule.status === 'active' ? '✅ Active' : '❌ Inactive'}`);

      console.log(`\n   Conditions:`);
      rule.conditions.forEach(c => {
        console.log(`   - ${c.id}`);
        if (c.value) console.log(`     Value: ${c.value}`);
        if (c.interval) console.log(`     Interval: ${c.interval}`);
      });

      console.log(`\n   Actions:`);
      rule.actions.forEach(a => {
        if (a.id.includes('slack')) {
          console.log(`   - 🔔 Slack notification`);
          console.log(`     Channel: ${a.channel || 'Not configured'}`);
          console.log(`     Workspace: ${a.workspace || 'Not configured'}`);
        } else if (a.id.includes('mail')) {
          console.log(`   - 📧 Email notification`);
          console.log(`     Target: ${a.targetType}`);
        } else {
          console.log(`   - ${a.id}`);
        }
      });
      console.log('');
    }

    console.log('\n💡 Troubleshooting:');
    console.log('1. Verify Slack channel #alertas-sentry has Sentry bot invited');
    console.log('2. Check Sentry account email for notifications');
    console.log('3. Verify alert rules are set to "active" status');
    console.log('4. Check if environment filter matches (production/all)');

  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

checkAlerts();
