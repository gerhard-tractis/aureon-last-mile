'use client';

import { useState, useEffect } from 'react';
import { createSPASassClient } from '@/lib/supabase/client';
import { useRouter } from 'next/navigation';
import { CheckCircle, Key } from 'lucide-react';

export default function ResetPasswordPage() {
    const [newPassword, setNewPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);
    const [success, setSuccess] = useState(false);
    const router = useRouter();

    useEffect(() => {
        const checkSession = async () => {
            try {
                const supabase = await createSPASassClient();
                const { data: { user }, error } = await supabase.getSupabaseClient().auth.getUser();

                if (error || !user) {
                    setError('Enlace inválido o expirado. Solicita un nuevo restablecimiento de contraseña.');
                }
            } catch {
                setError('Error al verificar la sesión');
            }
        };

        checkSession();
    }, []);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');

        if (newPassword !== confirmPassword) {
            setError("Las contraseñas no coinciden");
            return;
        }

        if (newPassword.length < 6) {
            setError('La contraseña debe tener al menos 6 caracteres');
            return;
        }

        setLoading(true);

        try {
            const supabase = await createSPASassClient();
            const { error } = await supabase.getSupabaseClient().auth.updateUser({
                password: newPassword
            });

            if (error) throw error;

            setSuccess(true);
            setTimeout(() => {
                router.push('/app');
            }, 3000);
        } catch (err) {
            if (err instanceof Error) {
                setError(err.message);
            } else {
                setError('Error al restablecer la contraseña');
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
                    Contraseña actualizada
                </h2>

                <p className="text-sm text-stone-400 mb-8 leading-relaxed">
                    Tu contraseña ha sido restablecida exitosamente.
                    Serás redirigido en un momento.
                </p>
            </div>
        );
    }

    return (
        <div>
            <div className="flex justify-center mb-5">
                <div className="w-12 h-12 rounded-full bg-stone-100 flex items-center justify-center">
                    <Key className="h-5 w-5 text-stone-600" />
                </div>
            </div>

            <h2 className="text-2xl font-semibold tracking-tight text-stone-900 mb-1 text-center">
                Nueva contraseña
            </h2>
            <p className="text-sm text-stone-400 mb-8 text-center">
                Ingresa tu nueva contraseña
            </p>

            {error && (
                <div className="mb-6 px-4 py-3 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg">
                    {error}
                </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-5">
                <div>
                    <label htmlFor="new-password" className="block text-xs font-medium text-stone-600 mb-1.5">
                        Nueva contraseña
                    </label>
                    <input
                        id="new-password"
                        name="new-password"
                        type="password"
                        autoComplete="new-password"
                        required
                        value={newPassword}
                        onChange={(e) => setNewPassword(e.target.value)}
                        className="block w-full rounded-lg border border-stone-200 bg-white px-3.5 py-2.5 text-sm text-stone-900 placeholder:text-stone-300 focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500/30 transition-colors"
                    />
                </div>

                <div>
                    <label htmlFor="confirm-password" className="block text-xs font-medium text-stone-600 mb-1.5">
                        Confirmar contraseña
                    </label>
                    <input
                        id="confirm-password"
                        name="confirm-password"
                        type="password"
                        autoComplete="new-password"
                        required
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        className="block w-full rounded-lg border border-stone-200 bg-white px-3.5 py-2.5 text-sm text-stone-900 placeholder:text-stone-300 focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500/30 transition-colors"
                    />
                    <p className="mt-1.5 text-xs text-stone-400">
                        Mínimo 6 caracteres
                    </p>
                </div>

                <button
                    type="submit"
                    disabled={loading}
                    className="w-full rounded-lg bg-stone-900 py-2.5 px-4 text-sm font-medium text-white hover:bg-stone-800 focus:outline-none focus:ring-2 focus:ring-stone-900 focus:ring-offset-2 disabled:opacity-50 transition-colors"
                >
                    {loading ? 'Actualizando...' : 'Actualizar contraseña'}
                </button>
            </form>
        </div>
    );
}
