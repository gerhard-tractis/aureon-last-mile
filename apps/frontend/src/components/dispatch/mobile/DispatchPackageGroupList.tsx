'use client';

import { DispatchPackageRow } from './DispatchPackageRow';
import type { StopPackageRow } from '@/lib/dispatch/mobile/route-packages-by-stop';

export interface PackageGroupSection {
  key: string;
  title: string;
  subtitle: string | null;
  /** What the header's "N paquetes" names — the loaded/counted unit
   *  (StopGroup.packageCount for "Por parada"), NOT necessarily
   *  `packages.length`: a NO EMBARCADO row is listed below but is not
   *  itself a loaded package, so it must not inflate this number
   *  (Lecciones aplicadas "no proxy under a label asserting a fact"). */
  count: number;
  packages: StopPackageRow[];
}

export interface DispatchPackageGroupListProps {
  sections: PackageGroupSection[];
  onRemove: (pkg: StopPackageRow) => void;
  emptyMessage: string;
}

/**
 * spec-76 2h — the grouped list body, shared by both toggles ("Por
 * parada" / "Por hora"): DispatchPackagesByStop maps either StopGroup[] or
 * HourGroup[] into the same `PackageGroupSection[]` shape before handing
 * it here, so this component does not know or care which grouping
 * produced it.
 */
export function DispatchPackageGroupList({ sections, onRemove, emptyMessage }: DispatchPackageGroupListProps) {
  if (sections.length === 0) {
    return <p className="p-4 text-center text-[13px] text-text-secondary">{emptyMessage}</p>;
  }

  return (
    <div className="flex flex-col gap-4">
      {sections.map((section) => (
        <section key={section.key} data-testid={`dispatch-package-group-${section.key}`}>
          <header className="mb-2 flex items-baseline justify-between gap-2">
            <div className="flex flex-col">
              <h3 className="text-[13.5px] font-semibold text-text">{section.title}</h3>
              {section.subtitle && <p className="text-[11.5px] text-text-secondary">{section.subtitle}</p>}
            </div>
            <span className="text-[11.5px] text-text-muted">
              {section.count} {section.count === 1 ? 'paquete' : 'paquetes'}
            </span>
          </header>
          <div className="flex flex-col gap-1.5">
            {section.packages.map((pkg) => (
              <DispatchPackageRow key={pkg.packageId} pkg={pkg} onRemove={onRemove} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
