// src/app/app/layout.tsx
import AppLayout from '@/components/AppLayout';
import { GlobalProvider } from '@/lib/context/GlobalContext';
import Providers from '@/components/Providers';
import { BrandingProvider } from '@/providers/BrandingProvider';
import { Toaster } from 'sonner';

export default function Layout({ children }: { children: React.ReactNode }) {
    return (
        <GlobalProvider>
            <Providers>
                <BrandingProvider>
                    <AppLayout>{children}</AppLayout>
                </BrandingProvider>
                <Toaster />
            </Providers>
        </GlobalProvider>
    );
}