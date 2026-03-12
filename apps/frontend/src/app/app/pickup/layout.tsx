'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useOperatorId } from '@/hooks/useOperatorId';
import { hasPermission } from '@/lib/types/auth.types';

export default function PickupLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { permissions } = useOperatorId();

  useEffect(() => {
    if (permissions.length > 0 && !hasPermission(permissions, 'pickup')) {
      router.push('/app');
    }
  }, [permissions, router]);

  if (permissions.length > 0 && !hasPermission(permissions, 'pickup')) {
    return null;
  }

  return <>{children}</>;
}
