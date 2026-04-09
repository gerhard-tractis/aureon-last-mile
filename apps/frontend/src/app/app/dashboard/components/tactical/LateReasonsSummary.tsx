import { useRouter, useSearchParams } from 'next/navigation';
import { Skeleton } from '@/components/ui/skeleton';

interface LateReason {
  reason: string;
  count: number;
  pct: number;
}

interface LateReasonsSummaryProps {
  data: LateReason[] | undefined;
  isLoading: boolean;
}

const MAX_REASONS = 5;

function buildDrillUrl(searchParams: URLSearchParams): string {
  const params = new URLSearchParams(searchParams.toString());
  params.set('drill', 'late_reasons');
  return `?${params.toString()}`;
}

export function LateReasonsSummary({ data, isLoading }: LateReasonsSummaryProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  if (isLoading) {
    return (
      <div className="flex flex-col gap-2">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-6 w-full" />
        <Skeleton className="h-6 w-full" />
        <Skeleton className="h-6 w-full" />
        <Skeleton className="h-6 w-full" />
        <Skeleton className="h-6 w-full" />
      </div>
    );
  }

  const reasons = (data ?? []).slice(0, MAX_REASONS);

  const handleViewAll = () => {
    const url = buildDrillUrl(searchParams);
    router.replace(url, { scroll: false });
  };

  return (
    <div className="flex flex-col gap-3">
      <h3 className="text-sm font-semibold text-foreground">
        Razones de retraso
      </h3>

      <div className="flex flex-col gap-2">
        {reasons.map((item) => (
          <div key={item.reason} className="flex flex-col gap-1">
            <div className="flex items-center justify-between">
              <span className="text-xs text-foreground truncate max-w-[60%]">
                {item.reason}
              </span>
              <span className="font-mono tabular-nums text-xs font-medium">
                {item.count}
              </span>
            </div>
            <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
              <div
                className="h-full rounded-full bg-primary"
                style={{ width: `${Math.min(item.pct, 100)}%` }}
              />
            </div>
          </div>
        ))}
      </div>

      <button
        type="button"
        className="self-start text-xs font-medium text-primary hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onClick={handleViewAll}
      >
        Ver todas →
      </button>
    </div>
  );
}
