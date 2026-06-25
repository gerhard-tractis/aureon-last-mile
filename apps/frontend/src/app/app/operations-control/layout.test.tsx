import { describe, it, expect, vi } from 'vitest';
import React from 'react';

const requireModuleEnabledMock = vi.fn();
vi.mock('@/lib/modules/require-enabled', () => ({
  requireModuleEnabled: requireModuleEnabledMock,
}));

describe('OperationsControlLayout (spec-46 activation guard)', () => {
  it('returns children subtree when ops_control module enabled', async () => {
    requireModuleEnabledMock.mockResolvedValueOnce(undefined);
    const { default: Layout } = await import('./layout');
    const element = (await Layout({
      children: React.createElement('div', null, 'Ops Children'),
    } as { children: React.ReactNode })) as React.ReactElement;
    expect(element).toBeTruthy();
    expect(requireModuleEnabledMock).toHaveBeenCalledWith('ops_control');
  });

  it('propagates notFound when ops_control module disabled', async () => {
    requireModuleEnabledMock.mockImplementationOnce(() => {
      throw new Error('NEXT_NOT_FOUND');
    });
    const { default: Layout } = await import('./layout');
    await expect(
      Layout({ children: React.createElement('div') } as { children: React.ReactNode }),
    ).rejects.toThrow('NEXT_NOT_FOUND');
  });
});
