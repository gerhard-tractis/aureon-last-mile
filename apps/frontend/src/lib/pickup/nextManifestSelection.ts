import { isManifestComplete } from './manifestProgress';
import type { RouteManifestRow } from '@/components/pickup/RouteManifestList';

export interface NextManifestSelection {
  nextIndex: number;
  nextManifest: RouteManifestRow | null;
  routeComplete: boolean;
  /** Manifests AFTER the highlighted one, capped at 3 — never "everything
   *  else", which could list already-completed manifests as if still ahead. */
  upcoming: RouteManifestRow[];
}

/**
 * spec-54 phase 4.6 — extracted from `route/active/page.tsx` in spec-95
 * fase 3, when the map panel's address hook needed `nextManifest` computed
 * BEFORE that page's early `if (routeLoading) return …` guards (hooks
 * cannot be called after a conditional return), which was pushing the page
 * further over its 300-line budget.
 *
 * `useRouteManifests` orders by created_at ASCENDING (append-only queue),
 * so array position is stable across refetches and across adding a new
 * manifest from this same screen. "Next" is the first one genuinely
 * incomplete (a null or zero total_packages counts as incomplete/unknown,
 * never as done — see `isManifestComplete`). When nothing is incomplete the
 * route IS finished — no fallback that would advertise verification work
 * that no longer exists.
 */
export function selectNextManifest(
  routeManifests: RouteManifestRow[],
): NextManifestSelection {
  const nextIndex = routeManifests.findIndex((m) => !isManifestComplete(m));
  const nextManifest = nextIndex === -1 ? null : routeManifests[nextIndex];
  const routeComplete = routeManifests.length > 0 && nextManifest === null;
  const upcoming = nextManifest
    ? routeManifests.slice(nextIndex + 1, nextIndex + 4)
    : [];
  return { nextIndex, nextManifest, routeComplete, upcoming };
}
