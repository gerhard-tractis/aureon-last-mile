import { vi, describe, it, expect } from 'vitest';
import { ModuleKey } from './registry';

vi.mock('./enabled', () => ({ isModuleEnabled: vi.fn() }));

describe('withModule (spec-45)', () => {
  it('invokes handler when enabled', async () => {
    const { isModuleEnabled } = await import('./enabled');
    (isModuleEnabled as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(true);
    const { withModule } = await import('./with-module');
    const handler = vi.fn(async () => new Response('ok'));
    const wrapped = withModule(ModuleKey.DISPATCH, handler);
    const res = await wrapped(new Request('http://x'));
    expect(res.status).toBe(200);
    expect(handler).toHaveBeenCalled();
  });

  it('returns 404 when disabled', async () => {
    const { isModuleEnabled } = await import('./enabled');
    (isModuleEnabled as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(false);
    const { withModule } = await import('./with-module');
    const handler = vi.fn();
    const wrapped = withModule(ModuleKey.DISPATCH, handler);
    const res = await wrapped(new Request('http://x'));
    expect(res.status).toBe(404);
    expect(handler).not.toHaveBeenCalled();
  });
});
