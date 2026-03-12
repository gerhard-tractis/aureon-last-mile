import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { REMEMBER_ME_MAX_AGE } from '@/lib/supabase/cookies'

export function applyRememberMe(
    cookiesToSet: { name: string; value: string; options?: Record<string, unknown> }[],
    rememberMe: boolean
) {
    return cookiesToSet.map(({ name, value, options }) => ({
        name,
        value,
        options: rememberMe ? { ...options, maxAge: REMEMBER_ME_MAX_AGE } : options,
    }))
}

export async function updateSession(request: NextRequest) {
    let supabaseResponse = NextResponse.next({ request })
    const rememberMe = request.cookies.get('remember_me')?.value === '1'

    const supabase = createServerClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        {
            cookies: {
                getAll() {
                    return request.cookies.getAll()
                },
                setAll(cookiesToSet: { name: string; value: string; options?: Record<string, unknown> }[]) {
                    const resolved = applyRememberMe(cookiesToSet, rememberMe)
                    resolved.forEach(({ name, value }) => request.cookies.set(name, value))
                    supabaseResponse = NextResponse.next({ request })
                    resolved.forEach(({ name, value, options }) =>
                        supabaseResponse.cookies.set(name, value, options)
                    )
                },
            },
        }
    )

    // Do not run code between createServerClient and
    // supabase.auth.getUser(). A simple mistake could make it very hard to debug
    // issues with users being randomly logged out.

    // IMPORTANT: DO NOT REMOVE auth.getUser()

    const { data: user } = await supabase.auth.getUser()
    if ((!user || !user.user) && request.nextUrl.pathname.startsWith('/app')) {
        const url = request.nextUrl.clone()
        url.pathname = '/auth/login'
        return NextResponse.redirect(url)
    }

    // Redirect authenticated users away from /auth routes to /app
    if (user?.user && request.nextUrl.pathname.startsWith('/auth')) {
        const url = request.nextUrl.clone()
        url.pathname = '/app'
        return NextResponse.redirect(url)
    }

    // IMPORTANT: You *must* return the supabaseResponse object as it is.
    return supabaseResponse
}
