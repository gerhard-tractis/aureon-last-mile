#!/usr/bin/env node

/**
 * Update Sentry Alert Rules to use Slack
 *
 * Updates existing alert rules to send notifications to Slack
 * instead of (or in addition to) email.
 *
 * Usage: node scripts/update-sentry-alerts-slack.js
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

async function getAlertRules() {
  const response = await fetch(`${BASE_URL}/rules/`, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${SENTRY_AUTH_TOKEN}`,
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch alert rules: ${response.status}`);
  }

  return response.json();
}

async function getSlackIntegrations() {
  const response = await fetch(`https://sentry.io/api/0/organizations/${SENTRY_ORG}/integrations/?provider_key=slack`, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${SENTRY_AUTH_TOKEN}`,
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch Slack integrations: ${response.status}`);
  }

  return response.json();
}

async function updateAlertRule(ruleId, ruleConfig) {
  const response = await fetch(`${BASE_URL}/rules/${ruleId}/`, {
    method: 'PUT',
    headers: {
      'Authorization': `Bearer ${SENTRY_AUTH_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(ruleConfig),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to update alert rule: ${response.status} ${error}`);
  }

  return response.json();
}

async function updateAlertsWithSlack() {
  console.log('🚀 Updating Sentry alerts to use Slack...\n');

  try {
    // Get Slack integration ID
    console.log('📊 Finding Slack integration...');
    const integrations = await getSlackIntegrations();

    if (!integrations || integrations.length === 0) {
      console.error('❌ No Slack integration found');
      console.error('   Please connect Slack first at: https://sentry.io/settings/tractis/integrations/slack/');
      process.exit(1);
    }

    const slackIntegration = integrations[0];
    console.log('✅ Found Slack integration:', slackIntegration.name);

    // Get available Slack channels
    const channelsResponse = await fetch(
      `https://sentry.io/api/0/organizations/${SENTRY_ORG}/integrations/${slackIntegration.id}/?action=channels`,
      {
        headers: { 'Authorization': `Bearer ${SENTRY_AUTH_TOKEN}` },
      }
    );

    let defaultChannel = null;
    if (channelsResponse.ok) {
      const channelsData = await channelsResponse.json();
      console.log('\n📢 Available Slack channels:');
      channelsData.channels?.forEach((ch, i) => {
        console.log(`   ${i + 1}. #${ch.name} (${ch.id})`);
        if (i === 0) defaultChannel = ch; // Use first channel as default
      });

      if (defaultChannel) {
        console.log(`\n✅ Will use channel: #${defaultChannel.name}`);
      }
    }

    // Get existing alert rules
    console.log('\n📊 Fetching existing alert rules...');
    const rules = await getAlertRules();
    console.log(`✅ Found ${rules.length} alert rules\n`);

    // Update each rule to include Slack
    for (const rule of rules) {
      console.log(`🔧 Updating: ${rule.name}`);

      // Try direct channel specification
      const slackAction = {
        id: 'sentry.integrations.slack.notify_action.SlackNotifyServiceAction',
        workspace: slackIntegration.id.toString(),
        channel: '#alertas-sentry',
        tags: 'environment,level,url',
      };

      // Check if Slack action already exists
      const hasSlack = rule.actions.some(
        action => action.id === 'sentry.integrations.slack.notify_action.SlackNotifyServiceAction'
      );

      if (hasSlack) {
        console.log(`⏭️  Skipped: Already has Slack notification`);
        continue;
      }

      // Keep existing actions and add Slack
      const updatedActions = [
        ...rule.actions,
        slackAction,
      ];

      const updated = await updateAlertRule(rule.id, {
        name: rule.name,
        actionMatch: rule.actionMatch,
        filterMatch: rule.filterMatch,
        conditions: rule.conditions,
        filters: rule.filters,
        actions: updatedActions,
        frequency: rule.frequency,
        environment: rule.environment,
      });

      console.log(`✅ Updated: ${updated.name}`);
    }

    console.log('\n✨ All alert rules updated to use Slack!');
    console.log('\n📋 Updated Rules:');
    rules.forEach((rule, i) => {
      console.log(`${i + 1}. ${rule.name} → Now sends to Slack + Email`);
    });

    console.log('\n🎯 View alerts at: https://sentry.io/organizations/tractis/alerts/rules/');
    console.log('\n💡 Test it: Trigger an error and check your Slack channel');

  } catch (error) {
    console.error('\n❌ Error updating alerts:', error.message);

    if (error.message.includes('401') || error.message.includes('403')) {
      console.error('\n🔑 Check token permissions');
    }

    process.exit(1);
  }
}

updateAlertsWithSlack();
