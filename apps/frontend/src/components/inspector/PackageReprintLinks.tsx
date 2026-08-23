import { Printer } from 'lucide-react';

/**
 * spec-65 Task 8 — `OrderInspector`'s only remaining bit of package display
 * logic. `OrderPackageList` (Task 7) renders status/weight/dock only; it has
 * no reprint affordance because the mock it was built against doesn't show
 * one. spec-53's per-package reprint link still needs to reach `1f` though —
 * `packageLabelsEnabled` is one of `OrderInspector`'s three public props —
 * so it lives here instead of being folded into `OrderPackageList`, which
 * would mean editing a Task 7 file this task was told not to touch.
 *
 * Same target URL `PackageStatusBreakdown` (the component this replaces)
 * already used: `/app/pickup/manifests/:manifestId/labels/print?packageId=:id`.
 */
interface Props {
  packages: { id: string; label: string }[];
  manifestId: string | null;
  labelsEnabled: boolean;
}

export function PackageReprintLinks({ packages, manifestId, labelsEnabled }: Props) {
  if (!labelsEnabled || !manifestId || packages.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-2" data-testid="package-reprint-links">
      {packages.map((pkg) => (
        <a
          key={pkg.id}
          href={`/app/pickup/manifests/${manifestId}/labels/print?packageId=${pkg.id}`}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`Reimprimir etiqueta de ${pkg.label}`}
          className="inline-flex items-center gap-1.5 rounded-md border border-border px-2 py-1 text-[11px] text-text-secondary hover:text-accent"
        >
          <Printer className="h-3.5 w-3.5" aria-hidden="true" />
          {pkg.label}
        </a>
      ))}
    </div>
  );
}
