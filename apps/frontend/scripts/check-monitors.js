require('dotenv').config({ path: '.env.local' });

const BETTERSTACK_API_KEY = process.env.BETTERSTACK_API_KEY;

async function listMonitors() {
  const response = await fetch('https://uptime.betterstack.com/api/v2/monitors', {
    headers: {
      'Authorization': `Bearer ${BETTERSTACK_API_KEY}`,
    },
  });
  
  const data = await response.json();
  
  console.log('📊 Your BetterStack Monitors:\n');
  data.data?.forEach(monitor => {
    const attrs = monitor.attributes;
    console.log(`✅ ${attrs.pronounceable_name}`);
    console.log(`   URL: ${attrs.url}`);
    console.log(`   Status: ${attrs.status}`);
    console.log(`   Check every: ${attrs.check_frequency / 60} minutes`);
    if (attrs.required_keyword) {
      console.log(`   Required keyword: "${attrs.required_keyword}"`);
    }
    console.log('');
  });
}

listMonitors();
