import AppLayout from '@/components/AppLayout';
import Providers from '@/components/Providers';
import { GlobalProvider } from '@/lib/context/GlobalContext';
import { BrandingProvider } from '@/providers/BrandingProvider';
import { Toaster } from 'sonner';

export default function AdminLayout({ children }: { children: React.ReactNode }) {
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
