// src/lib/context/GlobalContext.tsx
'use client';

import React, { createContext, useContext, useState, useEffect } from 'react';
import { createSPASassClientAuthenticated as createSPASassClient } from '@/lib/supabase/client';
import { createSPAClient } from '@/lib/supabase/client';


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

const GlobalContext = createContext<GlobalContextType | undefined>(undefined);

export function GlobalProvider({ children }: { children: React.ReactNode }) {
    const [loading, setLoading] = useState(true);
    const [user, setUser] = useState<User | null>(null);
    const [operatorId, setOperatorId] = useState<string | null>(null);
    const [role, setRole] = useState<string | null>(null);
    const [permissions, setPermissions] = useState<string[]>([]);

    useEffect(() => {
        async function loadData() {
            try {
                const supabase = await createSPASassClient();
                const client = supabase.getSupabaseClient();

                // Get user data
                const { data: { user } } = await client.auth.getUser();
                if (user) {
                    setUser({
                        email: user.email!,
                        id: user.id,
                        registered_at: new Date(user.created_at)
                    });
                } else {
                    throw new Error('User not found');
                }

                // Get claims from session (app_metadata.claims is synced from public.users)
                const spaClient = createSPAClient();
                const { data: { session } } = await spaClient.auth.getSession();
                const claims = session?.user?.app_metadata?.claims;
                setOperatorId(claims?.operator_id ?? null);
                setRole(claims?.role ?? null);
                setPermissions(claims?.permissions ?? []);
            } catch (error) {
                console.error('Error loading data:', error);
            } finally {
                setLoading(false);
            }
        }

        loadData();
    }, []);

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