import { redirect, notFound } from 'next/navigation';
import { createSSRClient } from '@/lib/supabase/server';
import WismoTestClient from './WismoTestClient';

const ALLOWED_ROLES = ['admin', 'maintainer'] as const;
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
