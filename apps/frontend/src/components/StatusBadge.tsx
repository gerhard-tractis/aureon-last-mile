import { cn } from '@/lib/utils';

export type OrderStatus = 'pending' | 'picked_up' | 'in_transit' | 'delivered' | 'failed' | 'returned';
export type BadgeVariant = 'success' | 'warning' | 'error' | 'info' | 'neutral';

interface StatusBadgeProps {
  status: OrderStatus | string;
  variant?: BadgeVariant;
  size?: 'sm' | 'md';
  className?: string;
}

const STATUS_CONFIG: Record<string, { variant: BadgeVariant; label: string }> = {
  delivered:  { variant: 'success', label: 'Entregado' },
  in_transit: { variant: 'warning', label: 'En Ruta' },
  failed:     { variant: 'error',   label: 'Fallido' },
  picked_up:  { variant: 'info',    label: 'Recogido' },
  pending:    { variant: 'neutral', label: 'Pendiente' },
  returned:   { variant: 'error',   label: 'Devuelto' },
};

// spec-54: text now comes from the -text tokens rather than the base hue. The
// base hue is a fill colour — #10b981 on #ecfdf5 is a pale green on a paler
// green. -text (#047857) is the readable pairing the prototype uses.
const VARIANT_CLASSES: Record<BadgeVariant, string> = {
  success: 'bg-status-success-bg text-status-success-text border-status-success-border',
  warning: 'bg-status-warning-bg text-status-warning-text border-status-warning-border',
  error:   'bg-status-error-bg text-status-error-text border-status-error-border',
  info:    'bg-status-info-bg text-status-info border-status-info-border',
  neutral: 'bg-surface-raised text-text-secondary border-border',
};

export function StatusBadge({ status, variant, size = 'md', className }: StatusBadgeProps) {
  const config = STATUS_CONFIG[status];
  const resolvedVariant = variant ?? config?.variant ?? 'neutral';
  const label = config?.label ?? status;

  return (
    <span
      className={cn(
        // Rounded-sm, not a pill: the rebrand reserves pills for filter chips,
        // and a square-ish badge sits better against tabular rows.
        'inline-flex items-center rounded-sm border font-semibold',
        size === 'sm' ? 'px-1.5 py-0.5 text-[10px]' : 'px-1.5 py-[3px] text-[10.5px]',
        VARIANT_CLASSES[resolvedVariant],
        className,
      )}
    >
      {label}
    </span>
  );
}
