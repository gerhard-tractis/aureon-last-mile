'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useOperatorId } from '@/hooks/useOperatorId';
import { hasPermission } from '@/lib/types/auth.types';

export default function DistributionLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { permissions } = useOperatorId();

  useEffect(() => {
    if (permissions.length > 0 && !hasPermission(permissions, 'distribution')) {
      router.push('/app');
    }
  }, [permissions, router]);

  if (permissions.length > 0 && !hasPermission(permissions, 'distribution')) {
    return null;
  }

  return <>{children}</>;
}
