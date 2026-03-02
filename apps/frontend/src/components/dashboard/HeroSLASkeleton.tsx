'use client';

import { Skeleton } from '@/components/ui/skeleton';

export default function HeroSLASkeleton() {
  return (
    <div className="bg-white rounded-xl p-6 md:p-12 shadow-sm w-full">
      <Skeleton className="h-5 w-64 mx-auto mb-6" />
      <Skeleton className="h-16 w-40 mx-auto mb-4" />
      <Skeleton className="h-6 w-48 mx-auto mb-6" />
      <Skeleton className="h-8 w-full max-w-[800px] mx-auto rounded-2xl mb-4" />
      <Skeleton className="h-6 w-56 mx-auto mb-8" />
      <div className="flex justify-center gap-12">
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-5 w-32" />
      </div>
    </div>
  );
}
