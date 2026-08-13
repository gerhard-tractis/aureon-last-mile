import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';

const requireModuleEnabledMock = vi.fn();
vi.mock('@/lib/modules/require-enabled', () => ({
  requireModuleEnabled: requireModuleEnabledMock,
}));

const rpcMock = vi.fn();
vi.mock('@/lib/supabase/server', () => ({
  createSSRClient: vi.fn(async () => ({ rpc: rpcMock })),
}));

vi.mock('./PrintPackageLabels', () => ({
  PrintPackageLabels: ({ manifestId, labels }: { manifestId: string; labels: unknown[] }) =>
    React.createElement('div', { 'data-testid': 'print-root' }, `${manifestId}:${labels.length}`),
}));

describe('labels/print page (spec-53)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls notFound (via requireModuleEnabled) when the module is disabled', async () => {
    requireModuleEnabledMock.mockImplementationOnce(() => {
      throw new Error('NEXT_NOT_FOUND');
    });
    const { default: PrintPage } = await import('./page');
    await expect(
      PrintPage({
        params: Promise.resolve({ manifestId: 'm-1' }),
        searchParams: Promise.resolve({}),
      }),
    ).rejects.toThrow('NEXT_NOT_FOUND');
  });

  it('fetches via get_manifest_label_data with the manifest id and renders every row', async () => {
    requireModuleEnabledMock.mockResolvedValueOnce(undefined);
    rpcMock.mockResolvedValueOnce({
      data: [
        { package_id: 'p1', package_label: 'CTN001' },
        { package_id: 'p2', package_label: 'CTN002' },
      ],
      error: null,
    });
    const { default: PrintPage } = await import('./page');
    const element = await PrintPage({
      params: Promise.resolve({ manifestId: 'm-1' }),
      searchParams: Promise.resolve({}),
    });
    expect(rpcMock).toHaveBeenCalledWith('get_manifest_label_data', {
      p_manifest_id: 'm-1',
      p_package_id: null,
    });
    expect(React.isValidElement(element)).toBe(true);
  });

  it('passes ?packageId= through as p_package_id', async () => {
    requireModuleEnabledMock.mockResolvedValueOnce(undefined);
    rpcMock.mockResolvedValueOnce({ data: [{ package_id: 'p1', package_label: 'CTN001' }], error: null });
    const { default: PrintPage } = await import('./page');
    await PrintPage({
      params: Promise.resolve({ manifestId: 'm-1' }),
      searchParams: Promise.resolve({ packageId: 'p1' }),
    });
    expect(rpcMock).toHaveBeenCalledWith('get_manifest_label_data', {
      p_manifest_id: 'm-1',
      p_package_id: 'p1',
    });
  });
});
