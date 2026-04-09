'use client';

import { Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { useIsMobile } from '@/hooks/useIsMobile';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { drillRegistry, type DrillKey } from './drillRegistry';

const VALID_KEYS = new Set<DrillKey>(['fadr', 'late_reasons', 'region', 'customer']);

function isDrillKey(value: string | null): value is DrillKey {
  return value !== null && VALID_KEYS.has(value as DrillKey);
}

export function DrillSheet() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const isMobile = useIsMobile();

  const drillParam = searchParams.get('drill');
  const isOpen = isDrillKey(drillParam);
  const entry = isOpen ? drillRegistry[drillParam] : null;

  const handleOpenChange = (open: boolean) => {
    if (!open) {
      const params = new URLSearchParams(searchParams.toString());
      params.delete('drill');
      params.delete('drill_params');
      router.replace(`?${params.toString()}`, { scroll: false });
    }
  };

  const drillParamsRaw = searchParams.get('drill_params');
  let drillParams: unknown = undefined;
  if (drillParamsRaw) {
    try {
      drillParams = JSON.parse(atob(drillParamsRaw));
    } catch {
      drillParams = undefined;
    }
  }

  const side = isMobile ? 'bottom' : 'right';

  if (!isOpen || !entry) {
    return (
      <Sheet open={false} onOpenChange={handleOpenChange}>
        <SheetContent side={side} />
      </Sheet>
    );
  }

  const DrillContent = entry.content;

  return (
    <Sheet open={true} onOpenChange={handleOpenChange}>
      <SheetContent side={side}>
        <SheetHeader>
          <SheetTitle>{entry.title}</SheetTitle>
          {entry.subtitle && (
            <p className="text-sm text-muted-foreground">{entry.subtitle}</p>
          )}
        </SheetHeader>
        <Suspense
          fallback={
            <div className="p-6 text-sm text-muted-foreground">Cargando...</div>
          }
        >
          <DrillContent params={drillParams} />
        </Suspense>
      </SheetContent>
    </Sheet>
  );
}
