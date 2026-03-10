'use client';

import { Suspense, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

const ANALYTICS_MAP: Record<string, string> = {
  analytics_otif: 'otif',
  analytics_unit_economics: 'unit_economics',
  analytics_cx: 'cx',
};

const OPS_TABS = ['loading', 'pickup', 'reception', 'distribution', 'routing', 'lastmile'];

function DashboardRedirect() {
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    const tab = searchParams.get('tab');

    if (tab && ANALYTICS_MAP[tab]) {
      router.replace(`/app/dashboard/analitica?tab=${ANALYTICS_MAP[tab]}`);
    } else if (tab === 'delivery') {
      router.replace('/app/dashboard/operaciones?tab=lastmile');
    } else if (tab && OPS_TABS.includes(tab)) {
      router.replace(`/app/dashboard/operaciones?tab=${tab}`);
    } else {
      router.replace('/app/dashboard/operaciones');
    }
  }, [router, searchParams]);

  return null;
}

export default function DashboardPage() {
  return (
    <Suspense fallback={null}>
      <DashboardRedirect />
    </Suspense>
  );
}
