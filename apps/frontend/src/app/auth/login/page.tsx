// src/app/auth/login/page.tsx
'use client';

import { createSPASassClient } from '@/lib/supabase/client';
import {useEffect, useState} from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import SSOButtons from '@/components/SSOButtons';

export default function LoginPage() {
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
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
                setShowMFAPrompt(true);
            } else {
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
        if(showMFAPrompt) {
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
