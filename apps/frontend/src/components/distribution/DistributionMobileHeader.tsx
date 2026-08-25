'use client';

import { useEffect, useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { BadgeVariant } from '@/components/StatusBadge';

/**
 * The Tractis isotype, geometry mirrored from SidebarBrand.tsx (which owns
 * the canonical copy taken from public/logos/tractis-color.svg). Not
 * imported from there — SidebarBrand's isn't exported, and the sidebar's
 * component also carries white-label logo-swap logic this header does not
 * need. Inline so the fill tracks the accent token through theme changes.
 */
function DistributionIsotype() {
  return (
    <svg
      viewBox="0 0 110 104"
      className="h-5 w-[21px] flex-none fill-accent"
      aria-hidden="true"
      data-testid="distribution-mobile-header-isotype"
    >
      <polygon points="0 41.766 30.817 57.54 30.817 93.694 51 104 51 67.846 51 45.08 0 19" />
      <polygon points="59 45.08 59 67.846 59 104 79.183 93.694 79.183 57.54 110 41.766 110 19" />
      <polygon points="105 11.955 85.674 0 54.017 14.451 22.326 0 3 11.955 54.017 38" />
    </svg>
  );
}

const CHIP_TONE: Record<'success' | 'error', string> = {
  success: 'bg-status-success-bg text-status-success-text border-status-success-border',
  error: 'bg-status-error-bg text-status-error-text border-status-error-border',
};

function ConnectionChip({ isOnline }: { isOnline: boolean }) {
  const tone = isOnline ? 'success' : 'error';
  return (
    <span
      className={cn(
        'inline-flex flex-none items-center rounded-sm border px-1.5 py-[3px] font-mono text-[9.5px] font-semibold uppercase tracking-[.08em]',
        CHIP_TONE[tone],
      )}
    >
      {isOnline ? 'EN LÍNEA' : 'SIN CONEXIÓN'}
    </span>
  );
}

export interface DistributionStatusChip {
  label: string;
  tone: BadgeVariant;
}

const STATUS_CHIP_TONE: Record<BadgeVariant, string> = {
  success: 'bg-status-success-bg text-status-success-text border-status-success-border',
  warning: 'bg-status-warning-bg text-status-warning-text border-status-warning-border',
  error: 'bg-status-error-bg text-status-error-text border-status-error-border',
  info: 'bg-status-info-bg text-status-info border-status-info-border',
  neutral: 'bg-surface-raised text-text-secondary border-border',
};

export interface DistributionMobileHeaderProps {
  /**
   * `'greeting'` (default) is `4c` — the home-of-the-nave screen: isotype,
   * "Hola, {nombre}", module context, connection chip. `'titled'` is the
   * shape every later phase (`4d`–`4j`) reuses: back arrow, title,
   * subtitle, status chip. One component, two mutually exclusive
   * presentations of the same header slot — see spec-68 §2.1.
   */
  variant?: 'greeting' | 'titled';
  /** Greeting variant only. */
  userName?: string | null;
  /** Greeting variant only. Injectable for tests; defaults to `navigator.onLine`. */
  isOnline?: boolean;
  /** Titled variant only. */
  title?: string;
  /** Titled variant only. */
  subtitle?: string;
  /** Titled variant only. */
  onBack?: () => void;
  /** Titled variant only. */
  statusChip?: DistributionStatusChip;
}

function useIsOnline(override?: boolean): boolean {
  const [online, setOnline] = useState(override ?? true);

  useEffect(() => {
    if (override !== undefined) return;
    if (typeof navigator === 'undefined') return;
    setOnline(navigator.onLine);
    const handleOnline = () => setOnline(true);
    const handleOffline = () => setOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [override]);

  return override ?? online;
}

export function DistributionMobileHeader({
  variant = 'greeting',
  userName,
  isOnline: isOnlineOverride,
  title,
  subtitle,
  onBack,
  statusChip,
}: DistributionMobileHeaderProps) {
  const isOnline = useIsOnline(isOnlineOverride);

  if (variant === 'titled') {
    return (
      <header className="flex items-center gap-3">
        <button
          type="button"
          onClick={onBack}
          aria-label="Volver"
          className="grid h-11 w-11 flex-none place-items-center rounded-full text-text-secondary transition-colors active:bg-surface-raised"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
        <div className="min-w-0 flex-1">
          <h2 className="truncate font-heading text-[18px] font-semibold leading-[1.1] tracking-[-.01em] text-text">
            {title}
          </h2>
          {subtitle && (
            <p className="mt-0.5 truncate text-[12.5px] text-text-secondary">{subtitle}</p>
          )}
        </div>
        {statusChip && (
          // Accessibility floor (spec-68): nothing informational under
          // 11px, except an eyebrow in uppercase+tracking at 9.5px — same
          // treatment as ConnectionChip above, not StatusBadge's 10.5px.
          <span
            className={cn(
              'inline-flex flex-none items-center rounded-sm border px-1.5 py-[3px] font-mono text-[9.5px] font-semibold uppercase tracking-[.08em]',
              STATUS_CHIP_TONE[statusChip.tone],
            )}
          >
            {statusChip.label}
          </span>
        )}
      </header>
    );
  }

  const firstName = userName?.trim().split(/\s+/)[0];

  return (
    <header className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <DistributionIsotype />
        <h2 className="mt-2 font-heading text-[22px] font-semibold leading-[1.1] tracking-[-.01em] text-text">
          {firstName ? `Hola, ${firstName}` : 'Hola'}
        </h2>
        <p className="mt-1 text-[12.5px] text-text-secondary">Distribución</p>
      </div>
      <ConnectionChip isOnline={isOnline} />
    </header>
  );
}
