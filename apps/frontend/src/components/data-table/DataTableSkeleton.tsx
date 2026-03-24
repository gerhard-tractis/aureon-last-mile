import { Skeleton } from '@/components/ui/skeleton';

interface DataTableSkeletonProps {
  columns: number;
  rows?: number;
}

export function DataTableSkeleton({ columns, rows = 5 }: DataTableSkeletonProps) {
  return (
    <div className="w-full">
      {/* Header skeleton */}
      <div className="flex gap-3 py-2 border-b border-border mb-1">
        {Array.from({ length: columns }).map((_, i) => (
          <Skeleton key={`h-${i}`} className="h-3 flex-1" />
        ))}
      </div>
      {/* Row skeletons */}
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} data-skeleton-row className="flex gap-3 py-2.5 border-b border-border-subtle">
          {Array.from({ length: columns }).map((_, c) => (
            <Skeleton key={`${r}-${c}`} className="h-3 flex-1" />
          ))}
        </div>
      ))}
    </div>
  );
}
