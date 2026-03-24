'use client';

import { Skeleton } from '@/components/ui/skeleton';

export default function HeroSLASkeleton() {
  return (
    <div className="bg-accent dark:bg-accent-muted dark:border dark:border-accent/25 rounded-md p-4 w-full">
      <Skeleton className="h-3 w-28 bg-white/20 dark:bg-accent/15 mb-2" />
      <Skeleton className="h-8 w-24 bg-white/20 dark:bg-accent/15 mb-2" />
      <div className="flex items-center gap-3">
        <Skeleton className="h-3.5 w-16 bg-white/20 dark:bg-accent/15" />
        <Skeleton className="h-3.5 w-24 bg-white/20 dark:bg-accent/15" />
      </div>
    </div>
  );
}
