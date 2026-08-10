import { createServerClient } from '@supabase/ssr'
import {Database} from "@/lib/types";
import {assertSafeSupabaseTarget} from "@/lib/supabase/environment-guard";

export async function createServerAdminClient() {
    // Highest-risk client in the codebase: service-role key, so RLS does not
    // apply. A preview deployment pointed at production would have unrestricted
    // write access to real data. Refuse that combination outright (spec-51).
    assertSafeSupabaseTarget();

    return createServerClient<Database>(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_KEY!,
        {
            cookies: {
                getAll: () => [],
                setAll: () => {},
            },
            auth: {
                persistSession: false,
                autoRefreshToken: false,
            },
            db: {
                schema: 'public'
            },
        }
    )
}