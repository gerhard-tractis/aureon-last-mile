import { redirect, notFound } from 'next/navigation';
import { createSSRClient } from '@/lib/supabase/server';
import WismoTestClient from './WismoTestClient';

/**
 * spec-67 Decisión 9: this used to read `['admin', 'maintainer']`, but
 * `maintainer` is not a value of the `user_role` enum and never has been —
 * the gate evaluated to admin-only for every real user. Narrowed to say what
 * it actually does. /admin has NO layout guard, so this page-level check is
 * the only thing protecting the route.
 */
const ALLOWED_ROLES = ['admin'] as const;
type AllowedRole = (typeof ALLOWED_ROLES)[number];

function isAllowedRole(role: string | undefined): role is AllowedRole {
  return ALLOWED_ROLES.includes(role as AllowedRole);
}

export default async function WismoTestPage() {
  const supabase = await createSSRClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session) {
    redirect('/auth/login');
  }

  const userRole = session.user.app_metadata?.claims?.role as string | undefined;
  if (!isAllowedRole(userRole)) {
    notFound();
  }

  const operatorId = session.user.app_metadata?.claims?.operator_id as string;

  return <WismoTestClient operatorId={operatorId} />;
}
