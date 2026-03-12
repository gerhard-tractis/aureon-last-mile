import {createServerClient} from '@supabase/ssr'
import {SupabaseClient} from '@supabase/supabase-js'
import {cookies} from 'next/headers'
import {ClientType, SassClient} from "@/lib/supabase/unified";
import {Database} from "@/lib/types";

export async function createSSRClient(): Promise<SupabaseClient<Database>> {
    const cookieStore = await cookies()

    // Cast needed: same @supabase/ssr version mismatch as client.ts — see comment there.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return createServerClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        {
            cookies: {
                getAll() {
                    return cookieStore.getAll()
                },
                setAll(cookiesToSet: { name: string; value: string; options?: Record<string, unknown> }[]) {
                    try {
                        cookiesToSet.forEach(({ name, value, options }) =>
                            cookieStore.set(name, value, options)
                        )
                    } catch {
                        // The `setAll` method was called from a Server Component.
                        // This can be ignored if you have middleware refreshing
                        // user sessions.
                    }
                },
            }
        }
    ) as unknown as SupabaseClient<Database>
}



export async function createSSRSassClient() {
    const client = await createSSRClient();
    // This must be some bug that SupabaseClient is not properly recognized, so must be ignored
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return new SassClient(client as any, ClientType.SERVER);
}