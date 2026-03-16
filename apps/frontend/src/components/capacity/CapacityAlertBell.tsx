'use client';

import React, { useState, useRef, useEffect } from 'react';
import { Bell } from 'lucide-react';
import { useCapacityAlerts } from '@/hooks/useCapacityAlerts';
import CapacityAlertPanel from './CapacityAlertPanel';

interface Props {
  operatorId: string | null;
}

export default function CapacityAlertBell({ operatorId }: Props) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const { data: alerts = [] } = useCapacityAlerts(operatorId);
  const count = alerts.length;
  const badgeLabel = count > 99 ? '99+' : String(count);

  // Close on outside click
  useEffect(() => {
    if (!isOpen) return;

    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  return (
    <div ref={containerRef} className="relative">
      <button
        onClick={() => setIsOpen((prev) => !prev)}
        aria-label="Alertas de capacidad"
        className="relative p-2 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
      >
        <Bell className="h-5 w-5" />
        {count > 0 && (
          <span
            data-testid="alert-badge"
            className="absolute -top-1 -right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-0.5 text-[10px] font-bold text-white leading-none"
          >
            {badgeLabel}
          </span>
        )}
      </button>

      {isOpen && (
        <CapacityAlertPanel
          alerts={alerts}
          onClose={() => setIsOpen(false)}
        />
      )}
    </div>
  );
}
