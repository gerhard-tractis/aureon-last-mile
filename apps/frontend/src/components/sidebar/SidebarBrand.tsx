'use client';

import { cn } from '@/lib/utils';

/**
 * The Tractis isotype — the three polygons, no wordmark. Inline rather than an
 * <img> so the fill tracks the accent token through theme and white-label
 * changes. Geometry copied from public/logos/tractis-color.svg.
 */
function Isotype({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 110 104" className={cn('flex-none fill-accent', className)} aria-hidden="true">
      <polygon points="0 41.766 30.817 57.54 30.817 93.694 51 104 51 67.846 51 45.08 0 19" />
      <polygon points="59 45.08 59 67.846 59 104 79.183 93.694 79.183 57.54 110 41.766 110 19" />
      <polygon points="105 11.955 85.674 0 54.017 14.451 22.326 0 3 11.955 54.017 38" />
    </svg>
  );
}

export function SidebarBrand({
  logoUrl,
  companyName,
  pinned,
  onLogoError,
}: {
  logoUrl: string | null;
  companyName: string | null;
  pinned: boolean;
  onLogoError: () => void;
}) {
  // A white-label operator's own logo replaces the lockup entirely.
  if (logoUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={logoUrl}
        alt={companyName || 'Logo'}
        className={cn('max-h-10 object-contain transition-all', pinned ? 'max-w-[140px]' : 'max-w-8')}
        onError={onLogoError}
      />
    );
  }

  return (
    <>
      <Isotype className="h-4 w-[17px]" />
      {pinned && (
        <div className="flex min-w-0 flex-col gap-px">
          <span className="font-heading text-[13.5px] font-semibold leading-none tracking-[-.01em] text-text truncate">
            {companyName || 'Aureon'}
          </span>
          {!companyName && (
            <span className="font-mono text-[8px] font-medium leading-none tracking-[.14em] text-sidebar-section">
              LAST MILE
            </span>
          )}
        </div>
      )}
      {!pinned && <span className="sr-only">{companyName || 'Aureon'}</span>}
    </>
  );
}
