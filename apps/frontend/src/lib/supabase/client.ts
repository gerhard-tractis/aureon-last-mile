import {createBrowserClient} from '@supabase/ssr'
import {SupabaseClient} from '@supabase/supabase-js'
import {ClientType, SassClient} from "@/lib/supabase/unified";
import {Database} from "@/lib/types";

export function createSPAClient(): SupabaseClient<Database> {
    // Cast needed: @supabase/ssr@0.5.2 returns SupabaseClient<Db, SchemaName, Schema>
    // but @supabase/supabase-js@2.x SupabaseClient now has SchemaNameOrClientOptions as
    // 2nd param, so the 3rd arg (Schema) lands in the SchemaName slot → Schema collapses
    // to never. Casting to SupabaseClient<Database> lets TypeScript infer correct defaults.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return createBrowserClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    ) as unknown as SupabaseClient<Database>
}

export async function createSPASassClient() {
    const client = createSPAClient();
    // This must be some bug that SupabaseClient is not properly recognized, so must be ignored
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return new SassClient(client as any, ClientType.SPA);
}

export async function createSPASassClientAuthenticated() {
    const client = createSPAClient();
    const user = await client.auth.getSession();
    if (!user.data || !user.data.session) {
        window.location.href = '/auth/login';
    }
    // This must be some bug that SupabaseClient is not properly recognized, so must be ignored
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return new SassClient(client as any, ClientType.SPA);
}