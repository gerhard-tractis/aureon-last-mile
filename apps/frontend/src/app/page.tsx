import { redirect } from 'next/navigation';
import { createSSRClient } from '@/lib/supabase/server';

/**
 * `/` is a router, not a page.
 *
 * The marketing landing page was removed from both QA and production: the
 * product is only ever reached by people who already have an account, so the
 * root route sends them where they were going anyway. The landing components
 * are still in `app/(landing)/components` — that directory holds no page, so
 * nothing under it is routable — should a marketing site be wanted later.
 */
export default async function RootPage() {
  const supabase = await createSSRClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  redirect(user ? '/app' : '/auth/login');
}
