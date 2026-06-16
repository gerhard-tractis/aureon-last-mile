import { vi, describe, it, expect } from 'vitest';
import { ModuleKey } from './registry';

const notFoundMock = vi.fn(() => {
  throw new Error('NEXT_NOT_FOUND');
});
vi.mock('next/navigation', () => ({ notFound: notFoundMock }));

vi.mock('./enabled', () => ({
  isModuleEnabled: vi.fn(),
}));

describe('requireModuleEnabled (spec-45)', () => {
  it('returns undefined when module enabled', async () => {
    const { isModuleEnabled } = await import('./enabled');
    (isModuleEnabled as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(true);
    const { requireModuleEnabled } = await import('./require-enabled');
    await expect(requireModuleEnabled(ModuleKey.PICKUP)).resolves.toBeUndefined();
    expect(notFoundMock).not.toHaveBeenCalled();
  });

  it('calls notFound() when module disabled', async () => {
    const { isModuleEnabled } = await import('./enabled');
    (isModuleEnabled as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(false);
    const { requireModuleEnabled } = await import('./require-enabled');
    await expect(requireModuleEnabled(ModuleKey.PICKUP)).rejects.toThrow('NEXT_NOT_FOUND');
  });
});
