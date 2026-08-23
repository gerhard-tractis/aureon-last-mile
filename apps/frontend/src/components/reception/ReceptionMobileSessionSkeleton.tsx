import { Skeleton } from '@/components/ui/skeleton';

/**
 * Gap fix (post spec-62 task 19) — loading placeholder for
 * `ReceptionMobileSession` below `lg`. The page's `isLoading` guard used to
 * fall through to a single desktop-shaped `max-w-2xl` skeleton even on a
 * phone, because the mobile branch sat below that guard. Below `lg` this is
 * the state seen longest on a slow andén connection, so its geometry mirrors
 * `ReceptionMobileSession`'s own chrome — fixed header band (route code,
 * driver, counter, progress bar), then the scan field, then a couple of
 * history rows — at the same heights and radii, so nothing jumps when the
 * real data lands. Never a centred spinner.
 *
 * Kept as its own file (rather than inlined in the page) to keep the page
 * under the repo's 300-line budget.
 */
export function ReceptionMobileSessionSkeleton() {
  return (
    <div data-testid="reception-mobile-loading-skeleton" className="flex min-h-0 flex-1 flex-col">
      <header className="flex-none border-b border-border bg-surface px-4 pb-3 pt-4">
        <div className="flex items-baseline justify-between gap-3">
          <div className="min-w-0 flex-1 space-y-1.5">
            {/* route code line, matches header's font-mono text-[13px] row */}
            <Skeleton className="h-[13px] w-24 rounded" />
            {/* driver name line, matches header's text-[12px] row */}
            <Skeleton className="h-[12px] w-32 rounded" />
          </div>
          {/* received/expected counter, matches header's text-[26px] row */}
          <Skeleton className="h-[26px] w-16 flex-none rounded" />
        </div>
        {/* progress bar track, matches header's h-2 rounded-full bar */}
        <Skeleton className="mt-2.5 h-2 w-full rounded-full" />
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4 pt-3">
        {/* ScanField at size="sm" is a fixed h-[62px] box */}
        <Skeleton className="h-[62px] w-full rounded-lg" />

        <div className="mt-4 flex flex-col gap-1.5">
          {/* a couple of ScanHistoryRow placeholders */}
          <Skeleton className="h-11 w-full rounded-lg" />
          <Skeleton className="h-11 w-full rounded-lg" />
        </div>
      </div>
    </div>
  );
}
