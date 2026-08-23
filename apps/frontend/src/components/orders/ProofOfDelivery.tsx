import { MapPin } from 'lucide-react';
import type { DossierDispatch } from '@/hooks/useOrderDossier';
import type { Json } from '@/lib/types';

/**
 * spec-65 Task 7 — photo, signature, geolocation. Verified against the live
 * QA database: 0 of 751 non-deleted dispatches carry `raw_data.photo_url`,
 * so the "no photo" state is the one this block renders almost every time
 * it's opened — it has to read as informative, not broken. The rule here is
 * the mirror image of `WhyLateBlock`'s: a missing field is an EXPLICIT
 * statement naming the null field, never a blank.
 *
 * Review round 1 — missing photo and missing signature now use the same
 * plain, informative style. The warning palette on the missing-signature
 * message was inconsistent with the missing-photo message right above it
 * (plain text) even though missing-photo is the far more common case (751
 * of 751 QA rows) — warning is reserved for something actually actionable,
 * and "DispatchTrack didn't send this field" isn't, on its own, one of
 * those.
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

function readStringField(raw: Json, key: string): string | null {
  const value = readRawField(raw, key);
  return typeof value === 'string' && value.length > 0 ? value : null;
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

  const photoUrl = readStringField(dispatch.raw_data, 'photo_url');
  const hasSignature = isPresent(readRawField(dispatch.raw_data, 'signature'));
  const hasCoords = dispatch.latitude !== null && dispatch.longitude !== null;

  return (
    <section className="flex flex-col gap-3.5 rounded-lg border border-border bg-surface p-3.5">
      <h3 className="font-heading text-xs font-semibold text-text">Prueba de entrega</h3>

      <div className="flex flex-col gap-1.5">
        <span className="font-mono text-[10px] uppercase tracking-wide text-text-muted">Fotografía</span>
        {photoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={photoUrl}
            alt="Foto del intento de entrega"
            className="h-24 w-full rounded-md border border-border object-cover"
          />
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
          <p className="text-[10.5px] leading-relaxed text-text-secondary">
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
