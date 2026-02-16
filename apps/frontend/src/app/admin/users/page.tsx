import { redirect } from 'next/navigation';
import { createSSRClient } from '@/lib/supabase/server';
import { UserManagementPage } from '@/components/admin/UserManagementPage';

/**
 * Admin Users Page
 * Path: /admin/users
 *
 * Access Control:
 * - Requires authentication
 * - Requires role = 'admin' or 'operations_manager'
 * - Redirects unauthorized users to home page
 *
 * Renders: <UserManagementPage /> container component
 */
export default async function AdminUsersPage() {
  const supabase = await createSSRClient();

  // Check authentication
  const { data: { session } } = await supabase.auth.getSession();

  if (!session) {
    redirect('/login');
  }

  // Check user role from JWT claims (Story 1.3 dependency)
  const userRole = session.user.app_metadata?.claims?.role;

  if (userRole !== 'admin' && userRole !== 'operations_manager') {
    // Redirect unauthorized users to home with error message
    redirect('/?error=unauthorized');
  }

  return <UserManagementPage />;
}

export const metadata = {
  title: 'User Management | Aureon Last Mile',
  description: 'Manage users, roles, and permissions'
};
