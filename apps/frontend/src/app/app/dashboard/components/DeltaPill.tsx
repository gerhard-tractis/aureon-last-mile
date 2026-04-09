import { formatDelta } from '@/app/app/dashboard/lib/format';

interface DeltaPillProps {
  value: number | null;
  label?: string;
  'aria-label'?: string;
}

export function DeltaPill({ value, label, 'aria-label': ariaLabel }: DeltaPillProps) {
  if (value === null) {
    return (
      <span
        className="text-muted-foreground font-mono tabular-nums text-sm"
        aria-label={ariaLabel ?? 'Delta no disponible'}
      >
        —
      </span>
    );
  }

  const isPositive = value > 0;
  const isNegative = value < 0;
  const colorClass = isPositive
    ? 'text-green-600 dark:text-green-400'
    : isNegative
      ? 'text-red-600 dark:text-red-400'
      : 'text-muted-foreground';

  return (
    <span className={`font-mono tabular-nums text-sm font-medium ${colorClass}`}>
      {formatDelta(value)}
      {label !== undefined && (
        <span className="ml-1 font-sans font-normal">{label}</span>
      )}
    </span>
  );
}
