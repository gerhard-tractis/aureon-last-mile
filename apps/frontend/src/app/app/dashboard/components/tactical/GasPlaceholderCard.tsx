import { TACTICAL_LABELS, PLACEHOLDER_COPY } from '@/app/app/dashboard/lib/labels.es';
import { Badge } from '@/components/ui/badge';

export function GasPlaceholderCard() {
  return (
    <div
      className="rounded-lg border bg-card p-4 flex flex-col gap-2 cursor-default"
      title="Requiere odómetro"
    >
      <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
        {TACTICAL_LABELS.gas}
      </span>
      <span className="font-mono tabular-nums text-3xl font-semibold leading-none text-muted-foreground">
        —
      </span>
      <div className="flex flex-col gap-1">
        <Badge variant="secondary" className="w-fit text-xs">
          Próximamente
        </Badge>
        <span className="text-xs text-muted-foreground">
          Requiere odómetro — {PLACEHOLDER_COPY.gas}
        </span>
      </div>
    </div>
  );
}
