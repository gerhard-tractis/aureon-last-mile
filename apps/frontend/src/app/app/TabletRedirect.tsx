'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useViewport } from '@/hooks/useViewport';

export default function TabletRedirect() {
  const { isTablet } = useViewport();
  const router = useRouter();

  useEffect(() => {
    if (isTablet) {
      router.push('/app/tablet-home');
    }
  }, [isTablet, router]);

  return null;
}
