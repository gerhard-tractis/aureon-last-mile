import { Image as ImageIcon, MapPin } from 'lucide-react';
import type { DossierDispatch } from '@/hooks/useOrderDossier';
import type { Json } from '@/lib/types';

/**
 * spec-65 Task 7 — photo, signature, geolocation. Verified against the live
 * QA database: 0 of 751 non-deleted dispatches carry `raw_data.photo_url`,
 * so the "no photo" state is the one this block renders almost every time
 * it's opened — it has to read as informative, not broken. The rule here is
 * the mirror image of `WhyLateBlock`'s: a missing field is an EXPLICIT
 * statement naming the null field, never a blank.
 */
interface Props {
  dispatch: DossierDispatch | null;
}

function readRawField(raw: Json, key: string): unknown {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    return (raw as Record<string, unknown>)[key];
  }
  return undefined;
}

function isPresent(value: unknown): boolean {
  return value !== null && value !== undefined && value !== '';
}

export function ProofOfDelivery({ dispatch }: Props) {
  if (!dispatch) {
    return (
      <section className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-3.5">
        <h3 className="font-heading text-xs font-semibold text-text">Prueba de entrega</h3>
        <p className="text-[11.5px] text-text-secondary">
          Sin intento de entrega registrado para esta orden.
        </p>
      </section>
    );
  }

  const hasPhoto = isPresent(readRawField(dispatch.raw_data, 'photo_url'));
  const hasSignature = isPresent(readRawField(dispatch.raw_data, 'signature'));
  const hasCoords = dispatch.latitude !== null && dispatch.longitude !== null;

  return (
    <section className="flex flex-col gap-3.5 rounded-lg border border-border bg-surface p-3.5">
      <h3 className="font-heading text-xs font-semibold text-text">Prueba de entrega</h3>

      <div className="flex flex-col gap-1.5">
        <span className="font-mono text-[10px] uppercase tracking-wide text-text-muted">Fotografía</span>
        {hasPhoto ? (
          <div className="flex h-24 items-center justify-center gap-2 rounded-md border border-border bg-surface-raised">
            <ImageIcon className="h-4 w-4 text-text-muted" aria-hidden="true" />
            <span className="text-[10.5px] text-text-secondary">foto del intento</span>
          </div>
        ) : (
          <p className="text-[10.5px] leading-relaxed text-text-secondary">
            DispatchTrack no envió fotografía. Campo{' '}
            <code className="font-mono text-[10px]">photo_url</code> nulo en el webhook.
          </p>
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        <span className="font-mono text-[10px] uppercase tracking-wide text-text-muted">Firma</span>
        {hasSignature ? (
          <p className="text-[10.5px] text-status-success-text">Firma recibida.</p>
        ) : (
          <p className="rounded-md border border-dashed border-status-warning-border bg-status-warning-bg p-2.5 text-[10.5px] leading-relaxed text-status-warning-text">
            DispatchTrack no envió firma. Campo <code className="font-mono text-[10px]">signature</code>{' '}
            nulo en el webhook.
          </p>
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        <span className="font-mono text-[10px] uppercase tracking-wide text-text-muted">
          Geolocalización
        </span>
        {hasCoords ? (
          <div
            data-testid="pod-map-placeholder"
            className="flex h-20 flex-col items-center justify-center gap-1 rounded-md border border-border bg-map-surface"
          >
            <MapPin className="h-4 w-4 text-map-line" aria-hidden="true" />
            <span className="font-mono text-[10px] text-text-body">
              {dispatch.latitude} / {dispatch.longitude}
            </span>
          </div>
        ) : (
          <p className="text-[10.5px] text-text-secondary">Sin coordenadas registradas.</p>
        )}
      </div>
    </section>
  );
}
