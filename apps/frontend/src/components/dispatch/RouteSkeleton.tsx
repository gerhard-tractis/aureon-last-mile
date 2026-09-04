import { Skeleton } from '@/components/ui/skeleton';

/**
 * Shared loading placeholder for the dispatch tabs' route lists. Originally
 * replaced four independent copies (page.tsx, DispatchOpenRoutesTab, and
 * the tabs phase 5 later rebuilt as DispatchEnRutaTab/DispatchCompletadasTab
 * each had their own `h-28`/`h-16` skeleton) — one component with a
 * `rowClass` prop instead.
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
