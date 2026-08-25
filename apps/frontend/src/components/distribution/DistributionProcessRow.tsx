'use client';

import Link from 'next/link';
import type { LucideIcon } from 'lucide-react';
import { ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * A single "PROCESOS DE LA NAVE" row on `4c`.
 *
 * spec-68 review fix (finding 1) — `href` is explicitly `string | null`,
 * not a route this component assumes exists. `/pendientes`, `/consolidacion`
 * and `/andenes` are Fases 3/4/6, not this one: a `<Link>` to any of them
 * today 404s on the only distribution screen a phone gets, and the desktop
 * `ConsolidationPanel` that used to serve the same need isn't rendered
 * below `lg` either — so pointing at a route that doesn't exist is a live
 * regression, not just an unfinished link. With `href={null}` the row
 * renders as a plain, non-navigable block: same geometry, muted tone, no
 * chevron — but the label and the count (still useful on their own) stay.
 * Each later phase turns exactly one row on by supplying its `href` once
 * that route ships.
 */
export interface DistributionProcessRowProps {
  href: string | null;
  icon: LucideIcon;
  title: string;
  subtitle: string;
  count?: number;
  testId?: string;
}

export function DistributionProcessRow({
  href,
  icon: Icon,
  title,
  subtitle,
  count,
  testId = 'distribution-process-row',
}: DistributionProcessRowProps) {
  const iconWrap = (
    <span className="grid h-10 w-10 flex-none place-items-center rounded-full bg-surface-raised">
      <Icon className="h-[18px] w-[18px] text-text-secondary" aria-hidden="true" />
    </span>
  );
  const labels = (
    <span className="min-w-0 flex-1">
      <span className="block truncate text-[14px] font-semibold text-text">{title}</span>
      <span className="block truncate text-[12px] text-text-secondary">{subtitle}</span>
    </span>
  );
  const countBadge =
    count !== undefined ? (
      <span className="flex-none font-mono text-[15px] font-bold text-text">{count}</span>
    ) : null;

  if (href) {
    return (
      <Link
        href={href}
        data-testid={testId}
        className={cn(
          'flex min-h-[64px] items-center gap-3 rounded-xl border border-border bg-surface px-3.5 py-2.5',
          'transition-colors active:bg-surface-raised',
        )}
      >
        {iconWrap}
        {labels}
        {countBadge}
        <ChevronRight className="h-4 w-4 flex-none text-text-muted" aria-hidden="true" />
      </Link>
    );
  }

  return (
    <div
      data-testid={testId}
      aria-disabled="true"
      className="flex min-h-[64px] items-center gap-3 rounded-xl border border-border bg-surface-raised px-3.5 py-2.5 opacity-60"
    >
      {iconWrap}
      {labels}
      {countBadge}
    </div>
  );
}
