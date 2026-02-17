#!/usr/bin/env node

/**
 * Check Sentry Project Members and Email Settings
 */

require('dotenv').config({ path: '.env.local' });

const SENTRY_AUTH_TOKEN = process.env.SENTRY_ALERT_TOKEN || process.env.SENTRY_AUTH_TOKEN;
const SENTRY_ORG = 'tractis';
const SENTRY_PROJECT = 'aureon-last-mile';

async function checkMembers() {
  console.log('🔍 Checking Sentry project members and email settings...\n');

  try {
    // Get project members
    const membersResponse = await fetch(
      `https://sentry.io/api/0/projects/${SENTRY_ORG}/${SENTRY_PROJECT}/members/`,
      {
        headers: { 'Authorization': `Bearer ${SENTRY_AUTH_TOKEN}` },
      }
    );

    if (membersResponse.ok) {
      const members = await membersResponse.json();
      console.log(`📊 Project Members (${members.length}):`);
      members.forEach(member => {
        console.log(`   - ${member.email} (${member.role})`);
      });
      console.log('');
    }

    // Get organization members
    const orgMembersResponse = await fetch(
      `https://sentry.io/api/0/organizations/${SENTRY_ORG}/members/`,
      {
        headers: { 'Authorization': `Bearer ${SENTRY_AUTH_TOKEN}` },
      }
    );

    if (orgMembersResponse.ok) {
      const orgMembers = await orgMembersResponse.json();
      console.log(`📊 Organization Members (${orgMembers.length}):`);
      orgMembers.forEach(member => {
        console.log(`   - ${member.email} (Role: ${member.role})`);
      });
      console.log('');
    }

    console.log('💡 IssueOwners alert target means:');
    console.log('   - Project members who have "ownership" of the error');
    console.log('   - Usually: person who first saw the issue or project maintainers');
    console.log('   - To ensure alerts work, consider changing to "All Members"\n');

    console.log('🔧 To change alert target:');
    console.log('   1. Go to: https://sentry.io/organizations/tractis/alerts/rules/');
    console.log('   2. Edit each rule');
    console.log('   3. Change email target from "IssueOwners" to "All Members"\n');

  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

checkMembers();
