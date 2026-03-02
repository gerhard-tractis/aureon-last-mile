'use client';

import { Skeleton } from '@/components/ui/skeleton';

export default function MetricsCardSkeleton() {
  return (
    <div className="bg-white rounded-xl p-6 shadow-sm border border-slate-200 min-h-[240px]">
      <div className="flex items-center gap-2 mb-4">
        <Skeleton className="h-5 w-5" />
        <Skeleton className="h-5 w-20" />
      </div>
      <Skeleton className="h-12 w-32 mb-2" />
      <Skeleton className="h-5 w-40 mb-2" />
      <Skeleton className="h-4 w-24 mb-3" />
      <Skeleton className="h-4 w-48 mb-4" />
      <Skeleton className="h-[40px] w-full" />
    </div>
  );
}
