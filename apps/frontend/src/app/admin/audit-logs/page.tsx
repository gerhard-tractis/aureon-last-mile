import { redirect } from 'next/navigation';
import { createSSRClient } from '@/lib/supabase/server';
import { AuditLogsPageClient } from './AuditLogsPageClient';

/**
 * Admin Audit Logs Page
 * Path: /admin/audit-logs
 *
 * Story 1.6: Set Up Audit Logging Infrastructure
 *
 * Access Control:
 * - Requires authentication
 * - Requires role = 'admin' (only admins can view audit logs)
 * - Redirects unauthorized users to home page
 *
 * Features:
 * - View audit logs with filters (date range, user, action, resource type)
 * - Search logs (resource ID, action, changes JSON)
 * - Export logs as CSV
 * - Pagination: 50 logs per page
 */
export default async function AdminAuditLogsPage() {
  const supabase = await createSSRClient();

  // Check authentication
  const { data: { session } } = await supabase.auth.getSession();

  if (!session) {
    redirect('/login');
  }

  // Check user role from JWT claims (Story 1.3 dependency)
  const userRole = session.user.app_metadata?.claims?.role;

  if (userRole !== 'admin') {
    // Redirect unauthorized users to home with error message
    redirect('/?error=unauthorized_audit_logs');
  }

  return <AuditLogsPageClient />;
}

export const metadata = {
  title: 'Audit Logs | Aureon Last Mile',
  description: 'View system audit logs and security events'
};
