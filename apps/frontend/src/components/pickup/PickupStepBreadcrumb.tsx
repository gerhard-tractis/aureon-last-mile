// spec-80 fase 0 — `handoff` (Entrega) se elimina del contrato.
//
// spec-47 borró esa pantalla al pasar al modelo centrado en ruta, pero el
// breadcrumb siguió anunciándola durante meses: el operario veía `Entrega` y
// `Firma` como pasos por venir y no había forma de llegar a ninguno de los dos.
// Un paso dibujado que no existe es peor que un paso ausente — hace que el
// operario espere una pantalla y crea que se la saltó.
export type PickupStep = 'pickup' | 'scan' | 'review' | 'complete';

const STEPS: { key: PickupStep; label: string }[] = [
  { key: 'pickup', label: 'Recogida' },
  { key: 'scan', label: 'Escaneo' },
  { key: 'review', label: 'Revisión' },
  { key: 'complete', label: 'Firma' },
];

interface PickupStepBreadcrumbProps {
  current: PickupStep;
}

export function PickupStepBreadcrumb({ current }: PickupStepBreadcrumbProps) {
  const currentIndex = STEPS.findIndex((s) => s.key === current);

  return (
    <nav aria-label="Pickup flow steps" className="flex items-center gap-1 text-sm mb-3">
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
            <span
              className={labelClass}
              aria-current={isCurrent ? 'step' : undefined}
            >
              {step.label}
            </span>
          </span>
        );
      })}
    </nav>
  );
}
