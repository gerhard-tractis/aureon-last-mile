import Providers from '@/components/Providers';
import { Toaster } from 'sonner';

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <Providers>
      {children}
      <Toaster />
    </Providers>
  );
}
