// src/lib/context/GlobalContext.tsx
'use client';

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { createSPASassClientAuthenticated as createSPASassClient } from '@/lib/supabase/client';


type User = {
    email: string;
    id: string;
    registered_at: Date;
};

interface GlobalContextType {
    loading: boolean;
    user: User | null;
    operatorId: string | null;
    role: string | null;
    permissions: string[];
}

/**
 * Shape of auth.users.raw_app_meta_data.claims, kept in step with public.users
 * by the sync_claims_on_user_change trigger.
 */
interface Claims {
    operator_id?: string | null;
    role?: string | null;
    permissions?: string[] | null;
}

/** Minimal shape we need off a Supabase user — both getUser and the auth event carry it. */
type ClaimsCarrier = { app_metadata?: { [key: string]: unknown } | null } | null | undefined;

const GlobalContext = createContext<GlobalContextType | undefined>(undefined);

export function GlobalProvider({ children }: { children: React.ReactNode }) {
    const [loading, setLoading] = useState(true);
    const [user, setUser] = useState<User | null>(null);
    const [operatorId, setOperatorId] = useState<string | null>(null);
    const [role, setRole] = useState<string | null>(null);
    const [permissions, setPermissions] = useState<string[]>([]);

    /**
     * Claims must come from the user object, never from getSession().
     *
     * getSession() returns the session cached in local storage — the claims as
     * they were when the access token was minted. Revoking a permission in
     * /admin updates public.users and, through sync_claims_on_user_change,
     * auth.users.raw_app_meta_data; neither touches a device that is already
     * signed in. A warehouse account kept working Recepción and Distribución
     * for as long as its old token lived. getUser() and the session handed to
     * onAuthStateChange both come from the server, so they carry the revocation.
     */
    const applyClaims = useCallback((carrier: ClaimsCarrier) => {
        const claims = carrier?.app_metadata?.claims as Claims | undefined;
        setOperatorId(claims?.operator_id ?? null);
        setRole(claims?.role ?? null);
        setPermissions(claims?.permissions ?? []);
    }, []);

    useEffect(() => {
        let active = true;
        const supabasePromise = createSPASassClient();

        async function loadData() {
            try {
                const supabase = await supabasePromise;
                const client = supabase.getSupabaseClient();

                const { data: { user } } = await client.auth.getUser();
                if (!active) return;
                if (!user) {
                    throw new Error('User not found');
                }

                setUser({
                    email: user.email!,
                    id: user.id,
                    registered_at: new Date(user.created_at)
                });
                applyClaims(user);
            } catch (error) {
                console.error('Error loading data:', error);
            } finally {
                if (active) setLoading(false);
            }
        }

        loadData();

        // A token refresh re-issues claims from the database, which is how a
        // permission revoked mid-shift reaches a device that never signs out.
        // Read them straight off the event's session: calling back into the
        // Supabase client from inside this handler can deadlock.
        let unsubscribe: (() => void) | undefined;
        supabasePromise.then((supabase) => {
            if (!active) return;
            const { data } = supabase.getSupabaseClient().auth.onAuthStateChange((_event, session) => {
                if (!active) return;
                applyClaims(session?.user);
            });
            unsubscribe = () => data.subscription.unsubscribe();
            if (!active) unsubscribe();
        });

        return () => {
            active = false;
            unsubscribe?.();
        };
    }, [applyClaims]);

    return (
        <GlobalContext.Provider value={{ loading, user, operatorId, role, permissions }}>
            {children}
        </GlobalContext.Provider>
    );
}

export const useGlobal = () => {
    const context = useContext(GlobalContext);
    if (context === undefined) {
        throw new Error('useGlobal must be used within a GlobalProvider');
    }
    return context;
};
