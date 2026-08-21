import { describe, it, expect, vi } from 'vitest';
import { attachManifestsToRoute, partialAttachMessage } from './attachManifestsToRoute';

const m = (id: string | null, externalLoadId: string) => ({ id, externalLoadId });

describe('attachManifestsToRoute', () => {
  it('attaches every manifest to the one route', async () => {
    const attach = vi.fn().mockResolvedValue(undefined);
    const result = await attachManifestsToRoute(
      'r1',
      [m('m1', 'CARGA-1'), m('m2', 'CARGA-2')],
      attach,
    );
    expect(attach).toHaveBeenCalledWith({ routeId: 'r1', manifestId: 'm1' });
    expect(attach).toHaveBeenCalledWith({ routeId: 'r1', manifestId: 'm2' });
    expect(result).toEqual({ attempted: 2, failedLoadIds: [] });
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
    const result = await attachManifestsToRoute(
      'r1',
      [m('m1', 'CARGA-1'), m('m2', 'CARGA-2'), m('m3', 'CARGA-3')],
      attach,
    );
    expect(attach).toHaveBeenCalledTimes(3);
    expect(result).toEqual({ attempted: 3, failedLoadIds: ['CARGA-1'] });
  });

  // The whole point of returning names rather than a count: the failed ids
  // must be the ones that actually rejected, not the first N. Rejecting the
  // MIDDLE manifest is what makes the index alignment falsifiable — a naive
  // `slice(0, failed)` would return CARGA-1 here and still look plausible.
  it('names the manifests that actually failed, not the first ones', async () => {
    const attach = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('nope'))
      .mockResolvedValueOnce(undefined);
    const result = await attachManifestsToRoute(
      'r1',
      [m('m1', 'CARGA-1'), m('m2', 'CARGA-2'), m('m3', 'CARGA-3')],
      attach,
    );
    expect(result.failedLoadIds).toEqual(['CARGA-2']);
  });

  it('reports a total failure without throwing', async () => {
    const attach = vi.fn().mockRejectedValue(new Error('nope'));
    await expect(
      attachManifestsToRoute('r1', [m('m1', 'CARGA-1'), m('m2', 'CARGA-2')], attach),
    ).resolves.toEqual({ attempted: 2, failedLoadIds: ['CARGA-1', 'CARGA-2'] });
  });

  // `PendingManifest.id` is nullable until a manifests row exists for the
  // load (spec-53). Attaching one is impossible, so it must not be counted
  // as attempted either — otherwise the toast reports a failure the driver
  // can do nothing about.
  it('skips manifests that have no row to attach yet', async () => {
    const attach = vi.fn().mockResolvedValue(undefined);
    const result = await attachManifestsToRoute(
      'r1',
      [m(null, 'CARGA-SIN-FILA'), m('m2', 'CARGA-2')],
      attach,
    );
    expect(attach).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ attempted: 1, failedLoadIds: [] });
  });

  it('does nothing when nothing was ticked', async () => {
    const attach = vi.fn();
    const result = await attachManifestsToRoute('r1', [], attach);
    expect(attach).not.toHaveBeenCalled();
    expect(result).toEqual({ attempted: 0, failedLoadIds: [] });
  });
});

describe('partialAttachMessage', () => {
  // The defect this replaced: a bare count. The selection is cleared and the
  // screen navigates away straight after, so a driver told "3 de 5" had no
  // way left to find out WHICH three.
  it('names the loads that did not make it', () => {
    const msg = partialAttachMessage(['CARGA-1', 'CARGA-2'], 5);
    expect(msg).toContain('CARGA-1');
    expect(msg).toContain('CARGA-2');
    expect(msg).toContain('2 de 5');
  });

  it('tells the driver where to add them from', () => {
    expect(partialAttachMessage(['CARGA-1'], 2)).toContain('ruta activa');
  });

  // A leader who ticked forty loads and lost thirty gets a toast, not a wall
  // of codes — but the COUNT still leads, so the number is never what gets
  // truncated.
  it('caps the names and says how many more there are', () => {
    const ids = ['C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7'];
    const msg = partialAttachMessage(ids, 10);
    expect(msg).toContain('7 de 10');
    expect(msg).toContain('C5');
    expect(msg).toContain('y 2 más');
    expect(msg).not.toContain('C6');
  });
});
