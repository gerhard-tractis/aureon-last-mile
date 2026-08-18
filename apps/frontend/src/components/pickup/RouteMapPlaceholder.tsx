import { Map, Navigation } from 'lucide-react';

/**
 * spec-54 phase 4.6 — mock 1i's map (polyline, origin point, current-stop pin)
 * has no backing geometry anywhere in the schema, and there is no map
 * provider wired into this project (out of scope). This is a neutral
 * placeholder using the map design tokens reserved for exactly this case
 * (`--color-map-surface` / `--color-map-line` in globals.css) — no map
 * library, no fake pins or polyline.
 *
 * The mock's "ABRIR NAVEGACIÓN" button IS honest, though: `manifests
 * .pickup_location` is a plain TEXT column on the same row `useRouteManifests`
 * already selects. A `https://maps.google.com/?q=<address>` search link needs
 * no map provider, so it is rendered whenever the highlighted manifest has an
 * address, and omitted (not stubbed) when it does not.
 */

interface RouteMapPlaceholderProps {
  /** The highlighted next manifest's pickup address, or null when unknown. */
  pickupLocation: string | null;
}

export function RouteMapPlaceholder({ pickupLocation }: RouteMapPlaceholderProps) {
  return (
    <div
      data-testid="route-map-placeholder"
      className="relative flex h-[186px] flex-col items-center justify-center gap-2 rounded-lg border border-border bg-map-surface"
    >
      {/* text-body, not text-secondary: text-secondary (#64748b) on the
          light map-surface (#eef1f5) is ~4.20:1, just under the 4.5:1 floor
          for this small text. text-body clears it in both modes. */}
      <Map className="h-6 w-6 text-text-body" aria-hidden="true" />
      <p className="text-[11.5px] text-text-body">Mapa no disponible</p>

      {pickupLocation && (
        <a
          href={`https://maps.google.com/?q=${encodeURIComponent(pickupLocation)}`}
          target="_blank"
          rel="noopener noreferrer"
          className="absolute bottom-3 right-3 flex min-h-[44px] items-center gap-1.5 rounded-md bg-accent px-3 text-xs font-semibold text-accent-foreground shadow-sm"
        >
          <Navigation className="h-3.5 w-3.5" aria-hidden="true" />
          Abrir navegación
        </a>
      )}
    </div>
  );
}
