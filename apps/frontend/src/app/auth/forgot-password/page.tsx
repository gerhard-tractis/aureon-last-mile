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
                    <div className="w-14 h-14 rounded-full bg-status-success-bg flex items-center justify-center">
                        <CheckCircle className="h-7 w-7 text-status-success" />
                    </div>
                </div>

                <h2 className="text-2xl font-semibold tracking-tight text-foreground mb-2">
                    Revisa tu email
                </h2>

                <p className="text-sm text-muted-foreground mb-8 leading-relaxed">
                    Hemos enviado un enlace de recuperación a tu correo electrónico.
                    Revisa tu bandeja de entrada.
                </p>

                <Link
                    href="/auth/login"
                    className="text-sm font-medium text-foreground hover:text-amber-600 transition-colors"
                >
                    Volver al inicio de sesión
                </Link>
            </div>
        );
    }

    return (
        <div>
            <h2 className="text-2xl font-semibold tracking-tight text-foreground mb-1">
                Recuperar contraseña
            </h2>
            <p className="text-sm text-muted-foreground mb-8">
                Ingresa tu email y te enviaremos un enlace de recuperación
            </p>

            {error && (
                <div className="mb-6 px-4 py-3 text-sm text-status-error bg-status-error-bg border border-status-error-border rounded-lg">
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

                <button
                    type="submit"
                    disabled={loading}
                    className="w-full rounded-lg bg-foreground py-2.5 px-4 text-sm font-medium text-background hover:bg-foreground/90 focus:outline-none focus:ring-2 focus:ring-foreground focus:ring-offset-2 disabled:opacity-50 transition-colors"
                >
                    {loading ? 'Enviando...' : 'Enviar enlace de recuperación'}
                </button>
            </form>

            <p className="mt-8 text-center text-sm text-muted-foreground">
                ¿Recordaste tu contraseña?{' '}
                <Link href="/auth/login" className="font-medium text-foreground hover:text-amber-600 transition-colors">
                    Iniciar sesión
                </Link>
            </p>
        </div>
    );
}
