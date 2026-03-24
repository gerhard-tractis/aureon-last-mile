'use client';

import React, { useState } from 'react';
import { Bell } from 'lucide-react';
import { useCapacityAlerts } from '@/hooks/useCapacityAlerts';
import CapacityAlertPanel from './CapacityAlertPanel';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';

interface Props {
  operatorId: string | null;
}

export default function CapacityAlertBell({ operatorId }: Props) {
  const [isOpen, setIsOpen] = useState(false);
  const { data: alerts = [] } = useCapacityAlerts(operatorId);
  const count = alerts.length;
  const badgeLabel = count > 99 ? '99+' : String(count);

  if (count === 0) return null;

  return (
    <>
      <button
        onClick={() => setIsOpen(true)}
        aria-label="Alertas de capacidad"
        className="relative p-2 rounded-md text-[var(--color-text-secondary)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-raised)] transition-colors"
      >
        <Bell className="h-5 w-5" />
        <span
          data-testid="alert-badge"
          className="absolute -top-1 -right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-[var(--color-status-error)] px-0.5 text-[10px] font-bold text-white leading-none"
        >
          {badgeLabel}
        </span>
      </button>

      <Sheet open={isOpen} onOpenChange={setIsOpen}>
        <SheetContent side="right" className="w-96 p-0">
          <SheetHeader className="px-4 py-3 border-b border-border">
            <SheetTitle className="text-sm font-semibold">Alertas de Capacidad</SheetTitle>
          </SheetHeader>
          <CapacityAlertPanel alerts={alerts} onClose={() => setIsOpen(false)} />
        </SheetContent>
      </Sheet>
    </>
  );
}
