// src/app/auth/login/page.tsx
'use client';

import { createSPASassClient } from '@/lib/supabase/client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import SSOButtons from '@/components/SSOButtons';
import { getSetRememberMeCookie, getClearRememberMeCookie } from '@/lib/supabase/cookies';

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
                if (rememberMe) {
                    // Force server-side session refresh so auth cookies are re-set with maxAge.
                    // The browser Supabase client sets them as session cookies by default.
                    await fetch('/api/auth/persist-session', { method: 'POST' })
                }
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
            <h2 className="text-2xl font-semibold tracking-tight text-foreground mb-1">
                Iniciar sesión
            </h2>
            <p className="text-sm text-muted-foreground mb-8">
                Ingresa tus credenciales para acceder
            </p>

            {error && (
                <div className="mb-6 px-4 py-3 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg">
                    {error}
                </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-5">
                <div>
                    <label htmlFor="email" className="block text-xs font-medium text-muted-foreground mb-1.5">
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
                        className="block w-full rounded-lg border border-border bg-card px-3.5 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500/30 transition-colors"
                    />
                </div>

                <div>
                    <div className="flex items-center justify-between mb-1.5">
                        <label htmlFor="password" className="block text-xs font-medium text-muted-foreground">
                            Contraseña
                        </label>
                        <Link href="/auth/forgot-password" className="text-xs text-muted-foreground hover:text-amber-600 transition-colors">
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
                        className="block w-full rounded-lg border border-border bg-card px-3.5 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500/30 transition-colors"
                    />
                    <div className="flex items-center justify-between mt-3">
                        <label className="flex items-center gap-2 cursor-pointer select-none">
                            <input
                                type="checkbox"
                                checked={rememberMe}
                                onChange={(e) => setRememberMe(e.target.checked)}
                                className="h-4 w-4 rounded border-border text-foreground focus:ring-amber-500"
                            />
                            <span className="text-xs text-muted-foreground">Recordarme</span>
                        </label>
                    </div>
                </div>

                <button
                    type="submit"
                    disabled={loading}
                    className="w-full rounded-lg bg-foreground py-2.5 px-4 text-sm font-medium text-background hover:bg-foreground/90 focus:outline-none focus:ring-2 focus:ring-foreground focus:ring-offset-2 disabled:opacity-50 transition-colors"
                >
                    {loading ? 'Ingresando...' : 'Ingresar'}
                </button>
            </form>

            <SSOButtons onError={setError} />

            <p className="mt-8 text-center text-sm text-muted-foreground">
                ¿No tienes cuenta?{' '}
                <Link href="/auth/register" className="font-medium text-foreground hover:text-amber-600 transition-colors">
                    Crear cuenta
                </Link>
            </p>
        </div>
    );
}
