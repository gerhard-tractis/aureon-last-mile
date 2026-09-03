import { Skeleton } from '@/components/ui/skeleton';

/**
 * Shared loading placeholder for the dispatch tabs' route lists. Three of
 * these existed independently (page.tsx, DispatchOpenRoutesTab,
 * DispatchCompletedRoutesTab all had `h-28` copies; DispatchInProgressTab had
 * a fourth at `h-16`) — one component with a `rowClass` prop replaces all of
 * them.
 */
export function RouteSkeleton({ rowClass = 'h-28' }: { rowClass?: string }) {
  return (
    <div className="space-y-3" data-testid="route-skeleton">
      {Array.from({ length: 3 }).map((_, i) => (
        <Skeleton key={i} className={`${rowClass} w-full rounded-lg`} />
      ))}
    </div>
  );
}
