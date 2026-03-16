'use client';

import { CheckCircle } from 'lucide-react';
import Link from 'next/link';
import {useState} from "react";
import {createSPASassClient} from "@/lib/supabase/client";

export default function VerifyEmailPage() {
    const [email, setEmail] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState(false);

    const resendVerificationEmail = async () => {
        if (!email) {
            setError('Ingresa tu email');
            return;
        }

        try {
            setLoading(true);
            setError('');
            const supabase = await createSPASassClient();
            const {error} = await supabase.resendVerificationEmail(email);
            if(error) {
                setError(error.message);
                return;
            }
            setSuccess(true);
        } catch (err: Error | unknown) {
            if (err instanceof Error) {
                setError(err.message);
            } else {
                setError('Ocurrió un error inesperado');
            }
        } finally {
            setLoading(false);
        }
    }

    return (
        <div className="text-center py-4">
            <div className="flex justify-center mb-5">
                <div className="w-14 h-14 rounded-full bg-emerald-50 flex items-center justify-center">
                    <CheckCircle className="h-7 w-7 text-emerald-500" />
                </div>
            </div>

            <h2 className="text-2xl font-semibold tracking-tight text-foreground mb-2">
                Revisa tu email
            </h2>

            <p className="text-sm text-muted-foreground mb-8 leading-relaxed">
                Te hemos enviado un enlace de verificación.
                Revisa tu bandeja de entrada y haz clic en el enlace para verificar tu cuenta.
            </p>

            <div className="space-y-4">
                <p className="text-xs text-muted-foreground">
                    ¿No recibiste el email? Revisa spam o ingresa tu email para reenviar:
                </p>

                {error && (
                    <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-4 py-3">
                        {error}
                    </div>
                )}

                {success && (
                    <div className="text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-4 py-3">
                        Email de verificación reenviado exitosamente.
                    </div>
                )}

                <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="tu@empresa.cl"
                    className="block w-full rounded-lg border border-border bg-card px-3.5 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500/30 transition-colors"
                />

                <button
                    className="text-sm font-medium text-foreground hover:text-amber-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    onClick={resendVerificationEmail}
                    disabled={loading}
                >
                    {loading ? 'Enviando...' : 'Reenviar email'}
                </button>
            </div>

            <div className="mt-8 pt-6 border-t border-border">
                <Link
                    href="/auth/login"
                    className="text-sm font-medium text-foreground hover:text-amber-600 transition-colors"
                >
                    Volver al inicio de sesión
                </Link>
            </div>
        </div>
    );
}
