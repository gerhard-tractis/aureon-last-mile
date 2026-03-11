import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { REMEMBER_ME_MAX_AGE } from '@/lib/supabase/cookies'

// Called after login when "Recordarme" is checked.
// Forces a server-side session refresh so Supabase auth cookies are re-set
// with maxAge=30d via setAll — the browser client sets them as session cookies
// by default, which are lost when the browser closes.
export async function POST() {
    const cookieStore = await cookies()
    const response = NextResponse.json({ ok: true })

    const supabase = createServerClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        {
            cookies: {
                getAll() {
                    return cookieStore.getAll()
                },
                setAll(cookiesToSet) {
                    cookiesToSet.forEach(({ name, value, options }) => {
                        response.cookies.set(name, value, { ...options, maxAge: REMEMBER_ME_MAX_AGE })
                    })
                },
            },
        }
    )

    const { error } = await supabase.auth.refreshSession()
    if (error) {
        return NextResponse.json({ error: error.message }, { status: 400 })
    }

    return response
}
