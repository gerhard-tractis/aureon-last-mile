const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  'https://wfwlcpnkkxxzdvhvvsxb.supabase.co',
  process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

(async () => {
  const { data: operators } = await supabase.from('operators').select('id, name').limit(3);
  console.log('\n📋 Operators:', operators?.length || 0);
  if (operators?.[0]) console.log('   Sample:', operators[0]);

  const { data: users } = await supabase.from('users').select('id, email, role').limit(3);
  console.log('\n👥 Users:', users?.length || 0);
  if (users?.[0]) console.log('   Sample:', users[0]);
})();
