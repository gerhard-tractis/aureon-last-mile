'use client';

import {createSPASassClient} from '@/lib/supabase/client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import SSOButtons from "@/components/SSOButtons";

export default function RegisterPage() {
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);
    const [acceptedTerms, setAcceptedTerms] = useState(false);
    const router = useRouter();

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');

        if (!acceptedTerms) {
            setError('Debes aceptar los Términos de Servicio y la Política de Privacidad');
            return;
        }

        if (password !== confirmPassword) {
            setError("Las contraseñas no coinciden");
            return;
        }

        setLoading(true);

        try {
            const supabase = await createSPASassClient();
            const { error } = await supabase.registerEmail(email, password);

            if (error) throw error;

            router.push('/auth/verify-email');
        } catch (err: Error | unknown) {
            if(err instanceof Error) {
                setError(err.message);
            } else {
                setError('Ocurrió un error inesperado');
            }
        } finally {
            setLoading(false);
        }
    };

    return (
        <div>
            <h2 className="text-2xl font-semibold tracking-tight text-foreground mb-1">
                Crear cuenta
            </h2>
            <p className="text-sm text-muted-foreground mb-8">
                Regístrate para acceder a la plataforma
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

                <div>
                    <label htmlFor="password" className="block text-xs font-medium text-muted-foreground mb-1.5">
                        Contraseña
                    </label>
                    <input
                        id="password"
                        name="password"
                        type="password"
                        autoComplete="new-password"
                        required
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        className="block w-full rounded-lg border border-border bg-card px-3.5 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500/30 transition-colors"
                    />
                </div>

                <div>
                    <label htmlFor="confirmPassword" className="block text-xs font-medium text-muted-foreground mb-1.5">
                        Confirmar contraseña
                    </label>
                    <input
                        id="confirmPassword"
                        name="confirmPassword"
                        type="password"
                        autoComplete="new-password"
                        required
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        className="block w-full rounded-lg border border-border bg-card px-3.5 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500/30 transition-colors"
                    />
                </div>

                <div className="flex items-start gap-2.5">
                    <input
                        id="terms"
                        name="terms"
                        type="checkbox"
                        checked={acceptedTerms}
                        onChange={(e) => setAcceptedTerms(e.target.checked)}
                        className="mt-0.5 h-4 w-4 rounded border-border text-foreground focus:ring-amber-500"
                    />
                    <label htmlFor="terms" className="text-xs text-muted-foreground leading-relaxed">
                        Acepto los{' '}
                        <Link href="/legal/terms" className="text-foreground hover:text-amber-600 underline underline-offset-2" target="_blank">
                            Términos de Servicio
                        </Link>{' '}
                        y la{' '}
                        <Link href="/legal/privacy" className="text-foreground hover:text-amber-600 underline underline-offset-2" target="_blank">
                            Política de Privacidad
                        </Link>
                    </label>
                </div>

                <button
                    type="submit"
                    disabled={loading}
                    className="w-full rounded-lg bg-foreground py-2.5 px-4 text-sm font-medium text-background hover:bg-foreground/90 focus:outline-none focus:ring-2 focus:ring-foreground focus:ring-offset-2 disabled:opacity-50 transition-colors"
                >
                    {loading ? 'Creando cuenta...' : 'Crear cuenta'}
                </button>
            </form>

            <SSOButtons onError={setError}/>

            <p className="mt-8 text-center text-sm text-muted-foreground">
                ¿Ya tienes cuenta?{' '}
                <Link href="/auth/login" className="font-medium text-foreground hover:text-amber-600 transition-colors">
                    Iniciar sesión
                </Link>
            </p>
        </div>
    );
}
