// src/app/app/layout.tsx
import AppLayout from '@/components/AppLayout';
import { GlobalProvider } from '@/lib/context/GlobalContext';
import Providers from '@/components/Providers';
import { BrandingProvider } from '@/providers/BrandingProvider';
import { Toaster } from 'sonner';
import { getEnabledModulesForCurrentUser } from '@/lib/modules/enabled';

export default async function Layout({ children }: { children: React.ReactNode }) {
    const enabled = await getEnabledModulesForCurrentUser();
    const enabledModules = Array.from(enabled);
    return (
        <GlobalProvider>
            <Providers>
                <BrandingProvider>
                    <AppLayout enabledModules={enabledModules}>{children}</AppLayout>
                </BrandingProvider>
                <Toaster />
            </Providers>
        </GlobalProvider>
    );
}
