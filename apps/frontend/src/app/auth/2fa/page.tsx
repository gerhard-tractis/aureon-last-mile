// src/app/auth/2fa/page.tsx
'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { createSPASassClient } from '@/lib/supabase/client';
import { MFAVerification } from '@/components/MFAVerification';
import { getSetRememberMeCookie, getClearRememberMeCookie } from '@/lib/supabase/cookies';

export default function TwoFactorAuthPage() {
    const router = useRouter();
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    useEffect(() => {
        checkMFAStatus();
    }, []);

    const checkMFAStatus = async () => {
        try {
            const supabase = await createSPASassClient();
            const client = supabase.getSupabaseClient();

            const { data: { user }, error: sessionError } = await client.auth.getUser();
            if (sessionError || !user) {
                router.push('/auth/login');
                return;
            }

            const { data: aal, error: aalError } = await client.auth.mfa.getAuthenticatorAssuranceLevel();

            if (aalError) throw aalError;

            if (aal.currentLevel === 'aal2' || aal.nextLevel === 'aal1') {
                router.push('/app');
                return;
            }

            setLoading(false);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'An error occurred');
            setLoading(false);
        }
    };

    const handleVerified = async () => {
        const pending = sessionStorage.getItem('remember_me_pending');
        sessionStorage.removeItem('remember_me_pending');
        document.cookie = pending === '1' ? getSetRememberMeCookie() : getClearRememberMeCookie();
        if (pending === '1') {
            await fetch('/api/auth/persist-session', { method: 'POST' })
        }
        router.push('/app');
    };

    if (loading) {
        return (
            <div className="flex justify-center items-center">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-accent"></div>
            </div>
        );
    }

    if (error) {
        return (
            <div className="flex justify-center items-center">
                <div className="text-sm text-[var(--color-status-error)]">{error}</div>
            </div>
        );
    }

    return (
            <div className="w-full max-w-md">
                <MFAVerification onVerified={handleVerified} />
            </div>
    );
}