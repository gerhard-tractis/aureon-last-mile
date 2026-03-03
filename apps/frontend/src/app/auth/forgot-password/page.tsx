'use client';

import { useState } from 'react';
import { createSPASassClient } from '@/lib/supabase/client';
import Link from 'next/link';
import { CheckCircle } from 'lucide-react';

export default function ForgotPasswordPage() {
    const [email, setEmail] = useState('');
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);
    const [success, setSuccess] = useState(false);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');
        setLoading(true);

        try {
            const supabase = await createSPASassClient();
            const { error } = await supabase.getSupabaseClient().auth.resetPasswordForEmail(email, {
                redirectTo: `${window.location.origin}/auth/reset-password`,
            });

            if (error) throw error;

            setSuccess(true);
        } catch (err) {
            if (err instanceof Error) {
                setError(err.message);
            } else {
                setError('Ocurrió un error inesperado');
            }
        } finally {
            setLoading(false);
        }
    };

    if (success) {
        return (
            <div className="text-center py-4">
                <div className="flex justify-center mb-5">
                    <div className="w-14 h-14 rounded-full bg-emerald-50 flex items-center justify-center">
                        <CheckCircle className="h-7 w-7 text-emerald-500" />
                    </div>
                </div>

                <h2 className="text-2xl font-semibold tracking-tight text-stone-900 mb-2">
                    Revisa tu email
                </h2>

                <p className="text-sm text-stone-400 mb-8 leading-relaxed">
                    Hemos enviado un enlace de recuperación a tu correo electrónico.
                    Revisa tu bandeja de entrada.
                </p>

                <Link
                    href="/auth/login"
                    className="text-sm font-medium text-stone-700 hover:text-amber-600 transition-colors"
                >
                    Volver al inicio de sesión
                </Link>
            </div>
        );
    }

    return (
        <div>
            <h2 className="text-2xl font-semibold tracking-tight text-stone-900 mb-1">
                Recuperar contraseña
            </h2>
            <p className="text-sm text-stone-400 mb-8">
                Ingresa tu email y te enviaremos un enlace de recuperación
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

                <button
                    type="submit"
                    disabled={loading}
                    className="w-full rounded-lg bg-stone-900 py-2.5 px-4 text-sm font-medium text-white hover:bg-stone-800 focus:outline-none focus:ring-2 focus:ring-stone-900 focus:ring-offset-2 disabled:opacity-50 transition-colors"
                >
                    {loading ? 'Enviando...' : 'Enviar enlace de recuperación'}
                </button>
            </form>

            <p className="mt-8 text-center text-sm text-stone-400">
                ¿Recordaste tu contraseña?{' '}
                <Link href="/auth/login" className="font-medium text-stone-700 hover:text-amber-600 transition-colors">
                    Iniciar sesión
                </Link>
            </p>
        </div>
    );
}
