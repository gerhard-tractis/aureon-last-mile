'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useOperatorId } from '@/hooks/useOperatorId';
import { hasPermission } from '@/lib/types/auth.types';

export default function DispatchLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { permissions } = useOperatorId();

  const canAccess =
    hasPermission(permissions, 'dispatch') || hasPermission(permissions, 'admin');

  useEffect(() => {
    if (permissions.length > 0 && !canAccess) {
      router.push('/app/dashboard');
    }
  }, [permissions, canAccess, router]);

  if (permissions.length > 0 && !canAccess) {
    return null;
  }

  return <>{children}</>;
}
