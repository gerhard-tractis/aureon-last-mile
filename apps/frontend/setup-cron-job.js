// Create cron job via Supabase Management API
require('dotenv').config({ path: '.env.local' });

async function setupCronJob() {
  console.log('🕐 Setting up audit log archival cron job...\n');

  const accessToken = process.env.SUPABASE_ACCESS_TOKEN;
  const projectRef = 'wfwlcpnkkxxzdvhvvsxb';

  // Create the cron job using pg_cron via SQL
  const cronSQL = `
    -- Enable pg_cron extension if not already enabled
    CREATE EXTENSION IF NOT EXISTS pg_cron;

    -- Remove existing job if it exists (idempotent)
    SELECT cron.unschedule('archive_old_audit_logs') WHERE EXISTS (
      SELECT 1 FROM cron.job WHERE jobname = 'archive_old_audit_logs'
    );

    -- Create the cron job
    SELECT cron.schedule(
      'archive_old_audit_logs',           -- Job name
      '0 2 * * *',                        -- Daily at 2:00 AM UTC
      $$SELECT public.archive_old_audit_logs()$$  -- SQL command
    );

    -- Verify job was created
    SELECT jobid, jobname, schedule, command, active
    FROM cron.job
    WHERE jobname = 'archive_old_audit_logs';
  `;

  console.log('📋 Creating cron job: archive_old_audit_logs');
  console.log('⏰ Schedule: Daily at 2:00 AM UTC (0 2 * * *)\n');

  try {
    const response = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/database/query`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`
      },
      body: JSON.stringify({ query: cronSQL })
    });

    const result = await response.json();

    if (!response.ok) {
      console.error('❌ Failed to create cron job:');
      console.error(JSON.stringify(result, null, 2));

      if (result.message && result.message.includes('pg_cron')) {
        console.log('\n⚠️  pg_cron extension may not be available on this Supabase plan');
        console.log('   Check Supabase Dashboard > Database > Extensions');
        console.log('   Or use Supabase Dashboard > Database > Cron Jobs UI');
      }

      process.exit(1);
    }

    console.log('✅ Cron job created successfully!\n');

    // Display job details if available
    if (Array.isArray(result) && result.length > 0) {
      console.log('📊 Job Details:');
      console.table(result);
    }

    console.log('\n🎉 Audit log archival is now automated!');
    console.log('   Function will run daily at 2:00 AM UTC');
    console.log('   Logs older than 7 years will be archived/deleted');

  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

setupCronJob();
