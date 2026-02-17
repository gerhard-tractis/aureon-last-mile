require('dotenv').config({ path: '.env.local' });

const BETTERSTACK_API_KEY = process.env.BETTERSTACK_API_KEY;
const BASE_URL = 'https://uptime.betterstack.com/api/v2';

// New correct URLs
const VERCEL_URL = 'https://aureon-last-mile.vercel.app';

async function listMonitors() {
  const response = await fetch(`${BASE_URL}/monitors`, {
    headers: { 'Authorization': `Bearer ${BETTERSTACK_API_KEY}` },
  });
  return (await response.json()).data;
}

async function updateMonitor(monitorId, updates) {
  const response = await fetch(`${BASE_URL}/monitors/${monitorId}`, {
    method: 'PATCH',
    headers: {
      'Authorization': `Bearer ${BETTERSTACK_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(updates),
  });
  
  if (!response.ok) {
    throw new Error(`Failed to update: ${await response.text()}`);
  }
  
  return response.json();
}

async function updateMonitors() {
  console.log('🔧 Updating BetterStack monitors with correct Vercel URL...\n');
  
  const monitors = await listMonitors();
  
  for (const monitor of monitors) {
    const name = monitor.attributes.pronounceable_name;
    
    if (name === 'Aureon Frontend') {
      console.log('📊 Updating Frontend monitor...');
      await updateMonitor(monitor.id, {
        url: VERCEL_URL,
      });
      console.log(`✅ Updated to: ${VERCEL_URL}\n`);
    }
    
    if (name === 'Aureon Health Check') {
      console.log('📊 Updating Health Check monitor...');
      await updateMonitor(monitor.id, {
        url: `${VERCEL_URL}/api/health`,
      });
      console.log(`✅ Updated to: ${VERCEL_URL}/api/health\n`);
    }
  }
  
  console.log('✨ All monitors updated!');
  console.log('\n⏰ Monitors will check the new URLs within 5 minutes');
  console.log('🎯 Check status at: https://uptime.betterstack.com\n');
}

updateMonitors().catch(console.error);
