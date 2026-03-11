import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

export const REMEMBER_ME_MAX_AGE = 2592000 // 30 days in seconds

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

export function getSetRememberMeCookie() {
    return `remember_me=1; path=/; max-age=${REMEMBER_ME_MAX_AGE}; SameSite=Strict`
}

export function getClearRememberMeCookie() {
    return 'remember_me=0; path=/; max-age=0; SameSite=Strict'
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

    // IMPORTANT: You *must* return the supabaseResponse object as it is.
    return supabaseResponse
}
