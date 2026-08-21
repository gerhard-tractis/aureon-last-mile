/**
 * Attaches every ticked manifest to a freshly-created pickup route.
 *
 * Extracted from page.tsx (spec-61 Task 5) so that file stays under the
 * 300-line limit while carrying the new role/crew/failed-lookup wiring.
 *
 * `Promise.allSettled`, never `Promise.all`: `add_manifest_to_route` rejects
 * a manifest another leader claimed in the seconds since the list loaded,
 * and one such rejection must not abandon the manifests that would have
 * attached fine. The caller decides what to say about `failed`.
 */
export async function attachManifestsToRoute(
  routeId: string,
  manifestIds: string[],
  attach: (args: { routeId: string; manifestId: string }) => Promise<unknown>,
): Promise<{ attempted: number; failed: number }> {
  const results = await Promise.allSettled(
    manifestIds.map((manifestId) => attach({ routeId, manifestId })),
  );
  return {
    attempted: manifestIds.length,
    failed: results.filter((r) => r.status === 'rejected').length,
  };
}
