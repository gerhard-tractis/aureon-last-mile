'use client';

import { DispatchPackageRow } from './DispatchPackageRow';
import type { StopPackageRow } from '@/lib/dispatch/mobile/route-packages-by-stop';

export interface PackageGroupSection {
  key: string;
  title: string;
  subtitle: string | null;
  /** The counted unit (StopGroup.packageCount for "Por parada"), NOT
   *  necessarily `packages.length`: a NO EMBARCADO row is listed below but
   *  is not itself a loaded package, so it must not inflate this number
   *  (Lecciones aplicadas "no proxy under a label asserting a fact"). */
  count: number;
  /** spec-76 review minor — "Por parada"'s `count` is a LOADED count and
   *  "Por hora"'s is a raw row count (every non-trailing hour bucket only
   *  ever holds loaded rows anyway, but the trailing "Retenidos" bucket is
   *  entirely unloaded) — two different meanings that both used to read
   *  "N paquetes". Each mapper (DispatchPackagesByStop.tsx) says which
   *  word applies to its own number instead of the label silently
   *  overclaiming. */
  countUnit: 'cargados' | 'paquetes';
  packages: StopPackageRow[];
}

export interface DispatchPackageGroupListProps {
  sections: PackageGroupSection[];
  emptyMessage: string;
}

/**
 * spec-76 2h — the grouped list body, shared by both toggles ("Por
 * parada" / "Por hora"): DispatchPackagesByStop maps either StopGroup[] or
 * HourGroup[] into the same `PackageGroupSection[]` shape before handing
 * it here, so this component does not know or care which grouping
 * produced it.
 *
 * No removal control passed through — see DispatchPackageRow.tsx's header
 * comment: removing a package removes its whole order from the plan, a
 * manager-only action (spec-70), not the crew's.
 */
export function DispatchPackageGroupList({ sections, emptyMessage }: DispatchPackageGroupListProps) {
  if (sections.length === 0) {
    return <p className="p-4 text-center text-[13px] text-text-secondary">{emptyMessage}</p>;
  }

  return (
    <div className="flex flex-col gap-4">
      {sections.map((section) => (
        <section key={section.key} data-testid={`dispatch-package-group-${section.key}`}>
          <header className="mb-2 flex items-baseline justify-between gap-2">
            <div className="flex flex-col">
              {/* spec-76 review minor — h2, not h3: DispatchPackagesByStop's
                  own "N paquetes cargados" is the h1, and there is no h2
                  anywhere in this screen otherwise. */}
              <h2 className="text-[13.5px] font-semibold text-text">{section.title}</h2>
              {section.subtitle && <p className="text-[11.5px] text-text-secondary">{section.subtitle}</p>}
            </div>
            <span className="text-[11.5px] text-text-muted">
              {section.count} {section.countUnit === 'cargados'
                ? (section.count === 1 ? 'cargado' : 'cargados')
                : (section.count === 1 ? 'paquete' : 'paquetes')}
            </span>
          </header>
          <div className="flex flex-col gap-1.5">
            {section.packages.map((pkg) => (
              <DispatchPackageRow key={pkg.packageId} pkg={pkg} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
