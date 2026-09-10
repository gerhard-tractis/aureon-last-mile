interface OfflinePickupNoticeProps {
  /** `offline.snapshot?.downloadedAt` — `null` cuando no hay snapshot
   * (bloqueado o todavía cargando; el llamador decide si renderiza esto
   * en ese caso). */
  downloadedAt: string | null;
}

/** DD/MM/AAAA HH:MM, a mano — Intl/toLocaleString varía el padding de
 * día/mes entre entornos de ICU, y esto sólo necesita ser legible, no
 * localizado. Con año — ronda 3 de revisión: `manifest_cache` no tiene
 * invalidación automática (ver el spec), así que un snapshot puede quedar
 * viejo por meses; "08/09 11:30" no dice si es de hoy o del año pasado. */
function formatDownloadedAt(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * spec-82 fase 2 (mock 5d) — el aviso que reemplaza la pantalla "perfecta"
 * que `5d` mostraba sin red antes de esta fase. Tres cosas, ninguna
 * opcional:
 *
 * - B1: descargar sólo habilita VER el manifiesto sin red, nunca escanear
 *   — `useScanMutation` sigue yendo directo a Supabase, sin cola offline
 *   en esta pantalla (eso es spec-81, no esto).
 * - B2: `usePickupScans` es una query de red pausada sin señal — el
 *   progreso no se perdió, no se puede LEER sin red.
 * - Menor: `downloadedAt`, para que un caché sin invalidación automática
 *   al menos diga DE CUÁNDO son los datos.
 *
 * Extraído de `scan/[loadId]/page.tsx` (ronda 3 de revisión) — mismo
 * precedente que `ManifestNotDownloadedNotice` en este mismo spec.
 */
export function OfflinePickupNotice({ downloadedAt }: OfflinePickupNoticeProps) {
  return (
    <div className="space-y-2">
      <p className="text-sm text-status-warning-text bg-status-warning-bg border border-status-warning-border rounded-lg px-3 py-2">
        Sin conexión: no se puede escanear ahora. Vuelve a tener señal para
        registrar bultos.
      </p>
      <p className="text-xs text-text-muted">
        No se puede confirmar cuántos bultos ya se verificaron mientras no
        haya red. Lo que ves abajo puede no reflejar el progreso real.
      </p>
      {downloadedAt && (
        <p className="text-xs text-text-muted">
          Descargado el {formatDownloadedAt(downloadedAt)}
        </p>
      )}
    </div>
  );
}
