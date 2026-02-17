import { useEffect } from 'react';
import * as Sentry from '@sentry/nextjs';
import { createSPAClient } from '@/lib/supabase/client';
import type { User } from '@supabase/supabase-js';

/**
 * useSentryUser Hook
 *
 * Automatically enriches Sentry error context with authenticated user information.
 * Updates Sentry user context on auth state changes (login/logout).
 *
 * Multi-tenant aware: Includes operator_id and role for filtering errors by operator.
 *
 * Usage:
 * - Call once in root layout or app-level component
 * - Automatically tracks auth state changes via Supabase listener
 *
 * @example
 * export default function RootLayout({ children }) {
 *   useSentryUser(); // Auto-update Sentry user context
 *   return <>{children}</>;
 * }
 */
export function useSentryUser() {
  useEffect(() => {
    const supabase = createSPAClient();

    // Set initial user context from current session
    const initializeUser = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      updateSentryUser(session?.user || null);
    };

    initializeUser();

    // Listen for auth state changes (login/logout)
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        updateSentryUser(session?.user || null);
      }
    );

    // Cleanup subscription on unmount
    return () => {
      subscription.unsubscribe();
    };
  }, []);
}

/**
 * Helper function to update Sentry user context
 * @param user - Supabase user object or null
 */
function updateSentryUser(user: User | null) {
  if (user) {
    Sentry.setUser({
      id: user.id,
      email: user.email,
      username: user.user_metadata?.full_name as string | undefined,
      // Multi-tenant context for error filtering
      operator_id: user.app_metadata?.operator_id as string | undefined,
      role: user.app_metadata?.claims?.role as string | undefined,
    });
  } else {
    // Clear user context on logout
    Sentry.setUser(null);
  }
}
