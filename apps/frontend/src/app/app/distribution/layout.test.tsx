import { describe, it, expect, vi } from 'vitest';
import React from 'react';

const requireModuleEnabledMock = vi.fn();
vi.mock('@/lib/modules/require-enabled', () => ({
  requireModuleEnabled: requireModuleEnabledMock,
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

describe('DistributionLayout (spec-46 activation guard)', () => {
  it('returns children subtree when distribution module enabled', async () => {
    requireModuleEnabledMock.mockResolvedValueOnce(undefined);
    const { default: DistributionLayout } = await import('./layout');
    const element = (await DistributionLayout({
      children: React.createElement('div', null, 'Distribution Children'),
    } as { children: React.ReactNode })) as React.ReactElement;
    expect(element).toBeTruthy();
    expect(requireModuleEnabledMock).toHaveBeenCalledWith('distribution');
  });

  it('propagates notFound when distribution module disabled', async () => {
    requireModuleEnabledMock.mockImplementationOnce(() => {
      throw new Error('NEXT_NOT_FOUND');
    });
    const { default: DistributionLayout } = await import('./layout');
    await expect(
      DistributionLayout({ children: React.createElement('div') } as { children: React.ReactNode }),
    ).rejects.toThrow('NEXT_NOT_FOUND');
  });
});
