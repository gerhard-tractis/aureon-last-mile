import { describe, it, expect, vi } from 'vitest';
import { attachManifestsToRoute } from './attachManifestsToRoute';

describe('attachManifestsToRoute', () => {
  it('attaches every manifest to the one route', async () => {
    const attach = vi.fn().mockResolvedValue(undefined);
    const result = await attachManifestsToRoute('r1', ['m1', 'm2'], attach);
    expect(attach).toHaveBeenCalledWith({ routeId: 'r1', manifestId: 'm1' });
    expect(attach).toHaveBeenCalledWith({ routeId: 'r1', manifestId: 'm2' });
    expect(result).toEqual({ attempted: 2, failed: 0 });
  });

  /**
   * The reason this is allSettled and not all: `add_manifest_to_route`
   * rejects a manifest another leader claimed in the seconds since the list
   * loaded. With Promise.all, that one rejection would abandon the manifests
   * that were about to attach fine and the driver would leave with a route
   * far shorter than the one they assembled.
   */
  it('keeps attaching after one manifest is refused', async () => {
    const attach = vi
      .fn()
      .mockRejectedValueOnce(new Error('ya está en otra ruta'))
      .mockResolvedValue(undefined);
    const result = await attachManifestsToRoute('r1', ['m1', 'm2', 'm3'], attach);
    expect(attach).toHaveBeenCalledTimes(3);
    expect(result).toEqual({ attempted: 3, failed: 1 });
  });

  it('reports a total failure without throwing', async () => {
    const attach = vi.fn().mockRejectedValue(new Error('nope'));
    await expect(attachManifestsToRoute('r1', ['m1', 'm2'], attach)).resolves.toEqual({
      attempted: 2,
      failed: 2,
    });
  });

  it('does nothing when nothing was ticked', async () => {
    const attach = vi.fn();
    const result = await attachManifestsToRoute('r1', [], attach);
    expect(attach).not.toHaveBeenCalled();
    expect(result).toEqual({ attempted: 0, failed: 0 });
  });
});
