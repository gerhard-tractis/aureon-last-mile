#!/usr/bin/env node

/**
 * Update Sentry Alert Rules to All Environments
 *
 * Changes alert rules from "production" only to "all" environments
 * so they trigger regardless of VERCEL_ENV value
 */

require('dotenv').config({ path: '.env.local' });

const SENTRY_AUTH_TOKEN = process.env.SENTRY_ALERT_TOKEN || process.env.SENTRY_AUTH_TOKEN;
const SENTRY_ORG = 'tractis';
const SENTRY_PROJECT = 'aureon-last-mile';
const BASE_URL = `https://sentry.io/api/0/projects/${SENTRY_ORG}/${SENTRY_PROJECT}`;

async function updateAlertEnvironments() {
  console.log('🔧 Updating alert rules to work for all environments...\n');

  try {
    // Get existing rules
    const response = await fetch(`${BASE_URL}/rules/`, {
      headers: { 'Authorization': `Bearer ${SENTRY_AUTH_TOKEN}` },
    });
    const rules = await response.json();

    for (const rule of rules) {
      if (rule.environment === 'production') {
        console.log(`📝 Updating: ${rule.name}`);
        console.log(`   From: production → To: null (all environments)`);

        const updateResponse = await fetch(`${BASE_URL}/rules/${rule.id}/`, {
          method: 'PUT',
          headers: {
            'Authorization': `Bearer ${SENTRY_AUTH_TOKEN}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            ...rule,
            environment: null, // null = all environments
          }),
        });

        if (updateResponse.ok) {
          console.log(`   ✅ Updated successfully\n`);
        } else {
          const error = await updateResponse.text();
          console.log(`   ❌ Failed: ${error}\n`);
        }
      } else {
        console.log(`⏭️  Skipped: ${rule.name} (already set to all environments)\n`);
      }
    }

    console.log('✨ Done! Alert rules will now trigger for all environments.');
    console.log('\n📝 Recommendation: In production, consider reverting to environment-specific alerts');
    console.log('   to avoid noise from development/preview deployments.\n');

  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

updateAlertEnvironments();
