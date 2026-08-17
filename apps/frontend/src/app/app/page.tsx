import { redirect } from 'next/navigation';
import { createSSRClient } from '@/lib/supabase/server';
import { getEnabledModulesForCurrentUser } from '@/lib/modules/enabled';
import { resolveLandingPath } from '@/components/sidebar/navigation';

/**
 * `/app` is the single answer to "where does a signed-in user start".
 *
 * It replaces the boilerplate welcome card that shipped with the template.
 * Every path into the product converges here — the root route, the post-login
 * redirect in the Supabase middleware, and the PWA start_url — so the landing
 * decision only has to be made once, and it is made server-side to avoid a
 * flash of the wrong shell before the client knows the user's role.
 */
export default async function AppIndexPage() {
  const supabase = await createSSRClient();
  const [{ data }, enabledModules] = await Promise.all([
    supabase.auth.getSession(),
    getEnabledModulesForCurrentUser(),
  ]);

  const claims = data.session?.user?.app_metadata?.claims;

  redirect(
    resolveLandingPath({
      role: claims?.role ?? null,
      permissions: claims?.permissions ?? [],
      enabledModules: Array.from(enabledModules),
    }),
  );
}
