/** The minimum a caller must know about a manifest to attach and name it. */
export interface AttachableManifest {
  id?: string | null;
  externalLoadId: string;
}

export interface AttachResult {
  attempted: number;
  /** `externalLoadId` of everything that did NOT make it onto the route. */
  failedLoadIds: string[];
}

/**
 * Attaches every ticked manifest to a freshly-created pickup route.
 *
 * Extracted from page.tsx (spec-61 Task 5) so that file stays under the
 * 300-line limit while carrying the new role/crew/failed-lookup wiring.
 *
 * `Promise.allSettled`, never `Promise.all`: `add_manifest_to_route` rejects
 * a manifest another leader claimed in the seconds since the list loaded,
 * and one such rejection must not abandon the manifests that would have
 * attached fine.
 *
 * Returns the failed loads BY NAME, not just a count. The count alone was a
 * dead end for the driver: the toast fires, the selection is cleared and the
 * screen navigates away, so "3 de 5 no se pudieron agregar" left them with no
 * way to find out WHICH three short of hunting through AddManifestSheet on
 * the destination screen. `externalLoadId` is the code printed on the load,
 * so it is the one identifier that is useful on a warehouse floor.
 */
export async function attachManifestsToRoute(
  routeId: string,
  manifests: AttachableManifest[],
  attach: (args: { routeId: string; manifestId: string }) => Promise<unknown>,
): Promise<AttachResult> {
  const attachable = manifests.filter((m): m is AttachableManifest & { id: string } => !!m.id);
  const results = await Promise.allSettled(
    attachable.map((m) => attach({ routeId, manifestId: m.id })),
  );
  return {
    attempted: attachable.length,
    failedLoadIds: attachable
      .filter((_, i) => results[i].status === 'rejected')
      .map((m) => m.externalLoadId),
  };
}

/**
 * What the driver is told when part of the selection did not attach.
 *
 * Capped: a leader who ticked forty loads and lost thirty gets a toast, not a
 * wall. The count always leads, so the number is never the thing that gets
 * truncated — the same rule PickupRouteCrewStrip applies to its chips.
 */
const MAX_NAMED = 5;

export function partialAttachMessage(failedLoadIds: string[], attempted: number): string {
  const named = failedLoadIds.slice(0, MAX_NAMED).join(', ');
  const rest = failedLoadIds.length - MAX_NAMED;
  const tail = rest > 0 ? `${named} y ${rest} más` : named;
  return `La ruta se creó, pero ${failedLoadIds.length} de ${attempted} manifiestos no se pudieron agregar: ${tail}. Agrégalos desde la ruta activa.`;
}
