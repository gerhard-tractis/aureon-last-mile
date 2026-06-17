import { describe, it, expect, vi } from 'vitest';
import React from 'react';

const requireModuleEnabledMock = vi.fn();
vi.mock('@/lib/modules/require-enabled', () => ({
  requireModuleEnabled: requireModuleEnabledMock,
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

describe('DispatchLayout (spec-46 activation guard)', () => {
  it('returns children subtree when dispatch module enabled', async () => {
    requireModuleEnabledMock.mockResolvedValueOnce(undefined);
    const { default: DispatchLayout } = await import('./layout');
    const element = (await DispatchLayout({
      children: React.createElement('div', null, 'Dispatch Children'),
    } as { children: React.ReactNode })) as React.ReactElement;
    expect(element).toBeTruthy();
    expect(requireModuleEnabledMock).toHaveBeenCalledWith('dispatch');
  });

  it('propagates notFound when dispatch module disabled', async () => {
    requireModuleEnabledMock.mockImplementationOnce(() => {
      throw new Error('NEXT_NOT_FOUND');
    });
    const { default: DispatchLayout } = await import('./layout');
    await expect(
      DispatchLayout({ children: React.createElement('div') } as { children: React.ReactNode }),
    ).rejects.toThrow('NEXT_NOT_FOUND');
  });
});
