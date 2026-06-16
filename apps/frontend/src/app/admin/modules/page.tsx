import { redirect } from 'next/navigation';
import { createSSRClient } from '@/lib/supabase/server';
import { ModulesAdminPage } from '@/components/admin/modules/ModulesAdminPage';
import { fetchOperatorsWithState } from '@/components/admin/modules/actions';

export const metadata = {
  title: 'Módulos | Aureon Last Mile',
  description: 'Activate or deactivate modules per operator (super-admin only).',
};

export default async function ModulesAdminRoute() {
  const supabase = await createSSRClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) redirect('/login');
  const role = session.user.app_metadata?.claims?.role;
  if (role !== 'super_admin') redirect('/admin?error=unauthorized');

  const operators = await fetchOperatorsWithState();
  return <ModulesAdminPage operators={operators} />;
}
