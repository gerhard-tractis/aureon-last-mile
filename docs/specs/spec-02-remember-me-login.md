# Remember Me — Login Session Persistence

**Date:** 2026-03-10
**Status:** completed

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

## Problem

Every time a user visits aureon.tractis.ai, they are redirected to the login page. Supabase SSR auth cookies are currently set without `maxAge`, making them session cookies that expire when the browser closes.

## Solution

Add a "Recordarme" checkbox to the login form. When checked, a `remember_me=1` cookie is written client-side after successful login. The Next.js middleware reads this cookie in its `setAll` handler and injects `maxAge: 2592000` (30d) into every Supabase auth cookie it sets. The cookie is written only after the full login flow completes (post-MFA if applicable). On logout, the `remember_me` cookie is cleared.

**Tech Stack:** Next.js 14 App Router, `@supabase/ssr`, Vitest + React Testing Library

**Known limitation:** `SameSite=Strict` on `remember_me` means the cookie is not sent on cross-site navigations (e.g. clicking a link from email). Supabase session cookies will still be valid on re-visit, but `maxAge` won't be re-injected until the next same-site request. This is acceptable.

## UI

- Checkbox placed on the same row as "¿Olvidaste tu contraseña?", left-aligned
- Label: "Recordarme"
- Default: unchecked
- Without checkbox: session expires on browser close (current behavior)
- With checkbox: session persists 30 days, auto-refreshed by middleware on each request

## Data Flow

1. User checks "Recordarme" and submits the form
2. Login succeeds → client writes `remember_me=1` cookie (`maxAge: 30d`, `path=/`, `SameSite=Strict`)
3. Every request hits `middleware.ts` → Supabase `setAll` is called to persist auth cookies
4. `setAll` reads `remember_me` from request cookies → if present, adds `maxAge: 2592000` to each Supabase auth cookie
5. On logout, `remember_me` cookie is cleared before Supabase signOut

## Constraints

- No new API routes
- No schema changes
- No new dependencies
- Cookie: `remember_me=1`, `path=/`, `SameSite=Strict`, `maxAge: 2592000`

## File Map

| File | Change |
|---|---|
| `apps/frontend/src/lib/supabase/middleware.ts` | Export `REMEMBER_ME_MAX_AGE` + `applyRememberMe()` pure helper; use it in `setAll` |
| `apps/frontend/src/app/auth/login/page.tsx` | Add `rememberMe` state, checkbox UI, write cookie after full login completes |
| `apps/frontend/src/lib/supabase/unified.ts` | `logout()` clears `remember_me` cookie before Supabase signOut |
| `apps/frontend/__tests__/lib/remember-me.test.ts` | Unit tests for `applyRememberMe` and `getClearCookieString` |

---

## Chunk 1: Middleware — export pure helper + use in setAll

### Task 1: Extract and test `applyRememberMe`

**Files:**
- Modify: `apps/frontend/src/lib/supabase/middleware.ts`
- Test: `apps/frontend/__tests__/lib/remember-me.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/frontend/__tests__/lib/remember-me.test.ts
import { describe, it, expect } from 'vitest'
import { applyRememberMe, REMEMBER_ME_MAX_AGE } from '@/lib/supabase/middleware'

describe('applyRememberMe', () => {
  it('adds maxAge to all cookies when rememberMe=true', () => {
    const result = applyRememberMe(
      [{ name: 'sb-access-token', value: 'tok', options: { path: '/' } }],
      true
    )
    expect(result[0].options?.maxAge).toBe(REMEMBER_ME_MAX_AGE)
  })

  it('does not add maxAge when rememberMe=false', () => {
    const result = applyRememberMe(
      [{ name: 'sb-access-token', value: 'tok', options: { path: '/' } }],
      false
    )
    expect(result[0].options?.maxAge).toBeUndefined()
  })

  it('preserves existing options when adding maxAge', () => {
    const result = applyRememberMe(
      [{ name: 'sb-access-token', value: 'tok', options: { path: '/', httpOnly: true } }],
      true
    )
    expect(result[0].options?.httpOnly).toBe(true)
    expect(result[0].options?.maxAge).toBe(REMEMBER_ME_MAX_AGE)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd apps/frontend && pnpm test:run __tests__/lib/remember-me.test.ts
```

Expected: FAIL — `applyRememberMe` is not exported from `@/lib/supabase/middleware`

- [ ] **Step 3: Update middleware.ts — export the helper and use it in setAll**

Full updated file `apps/frontend/src/lib/supabase/middleware.ts`:

```ts
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
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd apps/frontend && pnpm test:run __tests__/lib/remember-me.test.ts
```

Expected: PASS — 3 tests green

- [ ] **Step 5: Commit**

```bash
git add apps/frontend/src/lib/supabase/middleware.ts apps/frontend/__tests__/lib/remember-me.test.ts
git commit -m "feat: export applyRememberMe helper and apply maxAge in middleware setAll"
```

---

## Chunk 2: Login form — checkbox + cookie after full login

### Task 2: Add Recordarme checkbox, write cookie only after login completes

**Files:**
- Modify: `apps/frontend/src/app/auth/login/page.tsx`
- Test: `apps/frontend/__tests__/lib/remember-me.test.ts`

- [ ] **Step 1: Add logout cookie helper test**

Append to `apps/frontend/__tests__/lib/remember-me.test.ts`:

```ts
import { getClearRememberMeCookie, getSetRememberMeCookie } from '@/lib/supabase/middleware'

describe('remember_me cookie strings', () => {
  it('getSetRememberMeCookie returns a persistent cookie string', () => {
    const s = getSetRememberMeCookie()
    expect(s).toContain('remember_me=1')
    expect(s).toContain(`max-age=${REMEMBER_ME_MAX_AGE}`)
    expect(s).toContain('SameSite=Strict')
  })

  it('getClearRememberMeCookie returns an expiring cookie string', () => {
    const s = getClearRememberMeCookie()
    expect(s).toContain('remember_me=0')
    expect(s).toContain('max-age=0')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd apps/frontend && pnpm test:run __tests__/lib/remember-me.test.ts
```

Expected: FAIL — `getClearRememberMeCookie` and `getSetRememberMeCookie` not exported

- [ ] **Step 3: Export the two cookie string helpers from middleware.ts**

Add to the top of `apps/frontend/src/lib/supabase/middleware.ts` (after `REMEMBER_ME_MAX_AGE`):

```ts
export function getSetRememberMeCookie() {
    return `remember_me=1; path=/; max-age=${REMEMBER_ME_MAX_AGE}; SameSite=Strict`
}

export function getClearRememberMeCookie() {
    return 'remember_me=0; path=/; max-age=0; SameSite=Strict'
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd apps/frontend && pnpm test:run __tests__/lib/remember-me.test.ts
```

Expected: PASS — 5 tests green

- [ ] **Step 5: Update login page**

Full updated `apps/frontend/src/app/auth/login/page.tsx`:

```tsx
'use client';

import { createSPASassClient } from '@/lib/supabase/client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import SSOButtons from '@/components/SSOButtons';
import { getSetRememberMeCookie, getClearRememberMeCookie } from '@/lib/supabase/middleware';

export default function LoginPage() {
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [rememberMe, setRememberMe] = useState(false);
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);
    const [showMFAPrompt, setShowMFAPrompt] = useState(false);
    const router = useRouter();

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');
        setLoading(true);

        try {
            const client = await createSPASassClient();
            const { error: signInError } = await client.loginEmail(email, password);

            if (signInError) throw signInError;

            // Check if MFA is required
            const supabase = client.getSupabaseClient();
            const { data: mfaData, error: mfaError } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();

            if (mfaError) throw mfaError;

            if (mfaData.nextLevel === 'aal2' && mfaData.nextLevel !== mfaData.currentLevel) {
                // Store rememberMe preference for the 2FA page to pick up
                sessionStorage.setItem('remember_me_pending', rememberMe ? '1' : '0');
                setShowMFAPrompt(true);
            } else {
                // Full login complete — write the remember_me cookie now
                document.cookie = rememberMe ? getSetRememberMeCookie() : getClearRememberMeCookie();
                router.push('/app');
                return;
            }
        } catch (err) {
            if (err instanceof Error) {
                setError(err.message);
            } else {
                setError('An unknown error occurred');
            }
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        if (showMFAPrompt) {
            router.push('/auth/2fa');
        }
    }, [showMFAPrompt, router]);

    return (
        <div>
            <h2 className="text-2xl font-semibold tracking-tight text-stone-900 mb-1">
                Iniciar sesión
            </h2>
            <p className="text-sm text-stone-400 mb-8">
                Ingresa tus credenciales para acceder
            </p>

            {error && (
                <div className="mb-6 px-4 py-3 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg">
                    {error}
                </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-5">
                <div>
                    <label htmlFor="email" className="block text-xs font-medium text-stone-600 mb-1.5">
                        Email
                    </label>
                    <input
                        id="email"
                        name="email"
                        type="email"
                        autoComplete="email"
                        required
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="tu@empresa.cl"
                        className="block w-full rounded-lg border border-stone-200 bg-white px-3.5 py-2.5 text-sm text-stone-900 placeholder:text-stone-300 focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500/30 transition-colors"
                    />
                </div>

                <div>
                    <div className="flex items-center justify-between mb-1.5">
                        <label htmlFor="password" className="block text-xs font-medium text-stone-600">
                            Contraseña
                        </label>
                        <Link href="/auth/forgot-password" className="text-xs text-stone-400 hover:text-amber-600 transition-colors">
                            ¿Olvidaste tu contraseña?
                        </Link>
                    </div>
                    <input
                        id="password"
                        name="password"
                        type="password"
                        autoComplete="current-password"
                        required
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        className="block w-full rounded-lg border border-stone-200 bg-white px-3.5 py-2.5 text-sm text-stone-900 placeholder:text-stone-300 focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500/30 transition-colors"
                    />
                    <div className="flex items-center justify-between mt-3">
                        <label className="flex items-center gap-2 cursor-pointer select-none">
                            <input
                                type="checkbox"
                                checked={rememberMe}
                                onChange={(e) => setRememberMe(e.target.checked)}
                                className="h-4 w-4 rounded border-stone-300 text-stone-900 focus:ring-amber-500"
                            />
                            <span className="text-xs text-stone-500">Recordarme</span>
                        </label>
                    </div>
                </div>

                <button
                    type="submit"
                    disabled={loading}
                    className="w-full rounded-lg bg-stone-900 py-2.5 px-4 text-sm font-medium text-white hover:bg-stone-800 focus:outline-none focus:ring-2 focus:ring-stone-900 focus:ring-offset-2 disabled:opacity-50 transition-colors"
                >
                    {loading ? 'Ingresando...' : 'Ingresar'}
                </button>
            </form>

            <SSOButtons onError={setError} />

            <p className="mt-8 text-center text-sm text-stone-400">
                ¿No tienes cuenta?{' '}
                <Link href="/auth/register" className="font-medium text-stone-700 hover:text-amber-600 transition-colors">
                    Crear cuenta
                </Link>
            </p>
        </div>
    );
}
```

- [ ] **Step 6: Build check**

```bash
cd apps/frontend && pnpm build 2>&1 | tail -20
```

Expected: No TypeScript errors.

- [ ] **Step 7: Commit**

```bash
git add apps/frontend/src/app/auth/login/page.tsx apps/frontend/src/lib/supabase/middleware.ts apps/frontend/__tests__/lib/remember-me.test.ts
git commit -m "feat: add Recordarme checkbox to login form"
```

---

## Chunk 3: 2FA page — apply remember_me after MFA completes

### Task 3: Read remember_me_pending from sessionStorage on 2FA success

**Files:**
- Modify: `apps/frontend/src/app/auth/2fa/page.tsx`

- [ ] **Step 1: Read the 2FA page**

Open `apps/frontend/src/app/auth/2fa/page.tsx` and locate where `router.push('/app')` is called after successful MFA verification.

- [ ] **Step 2: Add cookie write after MFA success**

After the successful MFA verification, before `router.push('/app')`, add:

```ts
import { getSetRememberMeCookie, getClearRememberMeCookie } from '@/lib/supabase/middleware';

// inside the success handler, before router.push('/app'):
const pending = sessionStorage.getItem('remember_me_pending');
sessionStorage.removeItem('remember_me_pending');
document.cookie = pending === '1' ? getSetRememberMeCookie() : getClearRememberMeCookie();
```

- [ ] **Step 3: Build check**

```bash
cd apps/frontend && pnpm build 2>&1 | tail -20
```

Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add apps/frontend/src/app/auth/2fa/page.tsx
git commit -m "feat: apply remember_me cookie after MFA verification completes"
```

---

## Chunk 4: Logout — clear remember_me cookie

### Task 4: Clear remember_me on logout

**Files:**
- Modify: `apps/frontend/src/lib/supabase/unified.ts:45-53`

- [ ] **Step 1: Update logout() in unified.ts**

```ts
async logout() {
    if (this.clientType === ClientType.SPA) {
        document.cookie = getClearRememberMeCookie()
    }
    const { error } = await this.client.auth.signOut({ scope: 'local' })
    if (error) throw error
    if (this.clientType === ClientType.SPA) {
        window.location.href = '/auth/login'
    }
}
```

Add the import at the top of `unified.ts`:

```ts
import { getClearRememberMeCookie } from '@/lib/supabase/middleware'
```

- [ ] **Step 2: Build check**

```bash
cd apps/frontend && pnpm build 2>&1 | tail -20
```

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add apps/frontend/src/lib/supabase/unified.ts
git commit -m "feat: clear remember_me cookie on logout"
```

---

## Chunk 5: Branch + PR

- [ ] **Step 1: Create feature branch and push**

```bash
git checkout -b feat/remember-me-login
git push origin feat/remember-me-login
```

- [ ] **Step 2: Open PR**

```bash
gh pr create --title "feat: remember me login session persistence" --body "$(cat <<'EOF'
## Summary
- Adds Recordarme checkbox to login form (inline with password field, option B layout)
- Writes remember_me=1 cookie after full login completes (post-MFA if applicable)
- Middleware injects maxAge=30d into Supabase auth cookies when remember_me=1 is present
- Clears remember_me cookie on logout

## Test plan
- [ ] `cd apps/frontend && pnpm test:run __tests__/lib/remember-me.test.ts` — all green
- [ ] Login with Recordarme checked → close browser → reopen aureon.tractis.ai → still logged in
- [ ] Login without Recordarme → close browser → reopen → redirected to login
- [ ] Logout clears session and remember_me cookie
- [ ] MFA users: remember_me applied only after 2FA completes

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
gh pr merge --auto --squash
```

- [ ] **Step 3: Update spec status**

In this file, change `**Status:** backlog` → `**Status:** in progress`

- [ ] **Step 4: Verify CI and merge**

```bash
gh pr checks <PR_NUMBER>
gh pr view <PR_NUMBER> --json state,mergedAt
```

Wait for green + merged before declaring done.
