import { redirect } from 'next/navigation';
import { createSSRClient } from '@/lib/supabase/server';
import { DriverManagementPage } from '@/components/admin/DriverManagementPage';

/**
 * Admin Drivers Page
 * Path: /admin/drivers
 *
 * spec-84 fase 1 — minimal admin surface to link/unlink drivers.user_id.
 * Access: admin or operations_manager (same gate as /api/admin/drivers —
 * see that route for why not super_admin too).
 */
export default async function AdminDriversPage() {
  const supabase = await createSSRClient();
  const { data: { session } } = await supabase.auth.getSession();

  if (!session) {
    redirect('/login');
  }

  const userRole = session.user.app_metadata?.claims?.role;

  if (userRole !== 'admin' && userRole !== 'operations_manager') {
    redirect('/?error=unauthorized');
  }

  return <DriverManagementPage />;
}

export const metadata = {
  title: 'Conductores | Aureon Last Mile',
  description: 'Vincular usuarios a conductores',
};
