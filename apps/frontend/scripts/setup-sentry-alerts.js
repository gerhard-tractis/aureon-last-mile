#!/usr/bin/env node

/**
 * Sentry Alert Rules Configuration Script
 *
 * Creates alert rules for production monitoring:
 * 1. High error rate (>50 errors in 1 hour)
 * 2. New issues (first occurrence of errors)
 * 3. High-impact errors (affecting many users)
 *
 * Usage: node scripts/setup-sentry-alerts.js
 */

require('dotenv').config({ path: '.env.local' });

const SENTRY_AUTH_TOKEN = process.env.SENTRY_ALERT_TOKEN || process.env.SENTRY_AUTH_TOKEN;
const SENTRY_ORG = 'tractis';
const SENTRY_PROJECT = 'aureon-last-mile';
const BASE_URL = `https://sentry.io/api/0/projects/${SENTRY_ORG}/${SENTRY_PROJECT}`;

if (!SENTRY_AUTH_TOKEN) {
  console.error('❌ SENTRY_ALERT_TOKEN not found in .env.local');
  process.exit(1);
}

async function createAlertRule(ruleConfig) {
  const response = await fetch(`${BASE_URL}/rules/`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${SENTRY_AUTH_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(ruleConfig),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to create alert rule: ${response.status} ${error}`);
  }

  return response.json();
}

async function setupAlerts() {
  console.log('🚀 Configuring Sentry alert rules...\n');

  try {
    // Alert 1: High Error Rate
    console.log('📊 Creating high error rate alert...');
    const highErrorRate = await createAlertRule({
      name: 'High Error Rate',
      actionMatch: 'any',
      filterMatch: 'all',
      conditions: [
        {
          id: 'sentry.rules.conditions.event_frequency.EventFrequencyCondition',
          value: 50,
          interval: '1h',
        },
      ],
      filters: [
        {
          id: 'sentry.rules.filters.issue_occurrences.IssueOccurrencesFilter',
          value: 1,
        },
      ],
      actions: [
        {
          id: 'sentry.mail.actions.NotifyEmailAction',
          targetType: 'IssueOwners',
          targetIdentifier: '',
        },
      ],
      frequency: 30, // Alert at most once every 30 minutes
      environment: 'production',
    });
    console.log('✅ High error rate alert created');

    // Alert 2: New Issues
    console.log('\n📊 Creating new issue alert...');
    const newIssue = await createAlertRule({
      name: 'New Error Detected',
      actionMatch: 'any',
      filterMatch: 'all',
      conditions: [
        {
          id: 'sentry.rules.conditions.first_seen_event.FirstSeenEventCondition',
        },
      ],
      filters: [],
      actions: [
        {
          id: 'sentry.mail.actions.NotifyEmailAction',
          targetType: 'IssueOwners',
          targetIdentifier: '',
        },
      ],
      frequency: 30,
      environment: 'production',
    });
    console.log('✅ New issue alert created');

    // Alert 3: High-Impact Errors (affecting many users)
    console.log('\n📊 Creating high-impact error alert...');
    const highImpact = await createAlertRule({
      name: 'High-Impact Error (Many Users Affected)',
      actionMatch: 'any',
      filterMatch: 'all',
      conditions: [
        {
          id: 'sentry.rules.conditions.event_frequency.EventUniqueUserFrequencyCondition',
          value: 10,
          interval: '1h',
        },
      ],
      filters: [],
      actions: [
        {
          id: 'sentry.mail.actions.NotifyEmailAction',
          targetType: 'IssueOwners',
          targetIdentifier: '',
        },
      ],
      frequency: 60, // Alert at most once per hour for high-impact issues
      environment: 'production',
    });
    console.log('✅ High-impact error alert created');

    console.log('\n✨ All Sentry alert rules configured successfully!');
    console.log('\n📋 Alert Rules Created:');
    console.log('1. High Error Rate: Triggers when >50 errors in 1 hour');
    console.log('2. New Error Detected: Triggers on first occurrence');
    console.log('3. High-Impact Error: Triggers when error affects >10 users in 1 hour');
    console.log('\n📧 Alerts will be sent to issue owners via email');
    console.log('🎯 View alerts at: https://sentry.io/organizations/tractis/alerts/rules/');
    console.log('\n💡 Tip: Add Slack integration for instant notifications');
    console.log('   Go to: Settings → Integrations → Slack');

  } catch (error) {
    console.error('\n❌ Error setting up alerts:', error.message);

    if (error.message.includes('401')) {
      console.error('\n🔑 Auth token might be invalid or expired');
      console.error('   Create new token at: https://sentry.io/settings/account/api/auth-tokens/');
    }

    if (error.message.includes('403')) {
      console.error('\n⚠️  Token needs project:write and alert:write permissions');
    }

    if (error.message.includes('409') || error.message.includes('already exists')) {
      console.error('\n⚠️  Alert rules might already exist. Check Sentry dashboard.');
    }

    if (error.message.includes('404')) {
      console.error('\n⚠️  Project not found. Check SENTRY_ORG and SENTRY_PROJECT values');
      console.error(`   Current: ${SENTRY_ORG}/${SENTRY_PROJECT}`);
    }

    process.exit(1);
  }
}

// Run setup
setupAlerts();
