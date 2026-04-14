import { redirect } from 'next/navigation';
import { Suspense } from 'react';
import { createSSRClient } from '@/lib/supabase/server';
import { AdminPage } from '@/components/admin/AdminPage';

export default async function AdminRoute() {
  const supabase = await createSSRClient();
  const { data: { session } } = await supabase.auth.getSession();

  if (!session) {
    redirect('/login');
  }

  const userRole = session.user.app_metadata?.claims?.role;

  if (userRole !== 'admin' && userRole !== 'operations_manager') {
    redirect('/?error=unauthorized');
  }

  return (
    <Suspense>
      <AdminPage userRole={userRole} />
    </Suspense>
  );
}

export const metadata = {
  title: 'Administración | Aureon Last Mile',
  description: 'Manage users, clients, and pickup points',
};
