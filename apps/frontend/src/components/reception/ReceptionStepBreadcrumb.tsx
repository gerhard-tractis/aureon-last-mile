export type ReceptionStep = 'reception' | 'scan' | 'confirm';

const STEPS: { key: ReceptionStep; label: string }[] = [
  { key: 'reception', label: 'Recepción' },
  { key: 'scan', label: 'Escaneo' },
  { key: 'confirm', label: 'Confirmación' },
];

interface ReceptionStepBreadcrumbProps {
  current: ReceptionStep;
}

export function ReceptionStepBreadcrumb({ current }: ReceptionStepBreadcrumbProps) {
  const currentIndex = STEPS.findIndex((s) => s.key === current);

  return (
    <nav aria-label="Reception flow steps" className="flex items-center gap-1 text-sm mb-3">
      {STEPS.map((step, i) => {
        const isCurrent = i === currentIndex;
        const isCompleted = i < currentIndex;
        const labelClass = isCurrent
          ? 'text-accent font-semibold'
          : isCompleted
            ? 'text-text-secondary'
            : 'text-text-muted';

        return (
          <span key={step.key} className="flex items-center gap-1">
            {i > 0 && <span className="text-text-muted">›</span>}
            <span className={labelClass} aria-current={isCurrent ? 'step' : undefined}>
              {step.label}
            </span>
          </span>
        );
      })}
    </nav>
  );
}
