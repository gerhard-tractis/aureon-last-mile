import { describe, it, expect, vi } from 'vitest';
import React from 'react';

const requireModuleEnabledMock = vi.fn();
vi.mock('@/lib/modules/require-enabled', () => ({
  requireModuleEnabled: requireModuleEnabledMock,
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

describe('PickupLayout (spec-46 activation guard)', () => {
  it('returns rendered children subtree when pickup module enabled', async () => {
    requireModuleEnabledMock.mockResolvedValueOnce(undefined);
    const { default: PickupLayout } = await import('./layout');
    const element = (await PickupLayout({
      children: React.createElement('div', null, 'Pickup Children'),
    } as { children: React.ReactNode })) as React.ReactElement;
    expect(element).toBeTruthy();
    expect(requireModuleEnabledMock).toHaveBeenCalledWith('pickup');
  });

  it('propagates notFound when pickup module disabled', async () => {
    requireModuleEnabledMock.mockImplementationOnce(() => {
      throw new Error('NEXT_NOT_FOUND');
    });
    const { default: PickupLayout } = await import('./layout');
    await expect(
      PickupLayout({ children: React.createElement('div') } as { children: React.ReactNode }),
    ).rejects.toThrow('NEXT_NOT_FOUND');
  });
});
