import { describe, it, expect, vi } from 'vitest';
import { callRpc } from './rpc';

/**
 * A stand-in for supabase-js's SupabaseClient. The only thing that matters
 * here is that `rpc` reads `this` — the real client's `rpc()` does
 * `this.rest.rpc(...)`, which is why calling it detached throws
 * "Cannot read properties of undefined (reading 'rest')".
 */
function makeClient(payload: unknown) {
  return {
    rest: { marker: 'attached' },
    rpc(this: { rest?: { marker: string } }, fn: string, args?: Record<string, unknown>) {
      // Mirrors the real client: blows up when invoked without its receiver.
      const marker = this.rest!.marker;
      return Promise.resolve({ data: { fn, args, marker, payload }, error: null });
    },
  };
}

describe('callRpc', () => {
  it('invokes rpc as a method so the client receiver is preserved', async () => {
    const client = makeClient('ok');

    const { data, error } = await callRpc<{ marker: string; fn: string }>(
      client,
      'get_enabled_modules_for_operator',
      { p_operator_id: 'op-1' },
    );

    expect(error).toBeNull();
    expect(data?.marker).toBe('attached');
    expect(data?.fn).toBe('get_enabled_modules_for_operator');
  });

  it('throws if the receiver is lost — guards the regression this exists to prevent', async () => {
    const client = makeClient('ok');
    const detached = client.rpc;

    // This is the shape the codebase used before: `(supabase.rpc as Fn)(...)`.
    // It must fail, otherwise this test proves nothing about callRpc.
    expect(() => detached('some_fn', {})).toThrow(/rest/);
  });

  it('passes args through and forwards the error untouched', async () => {
    const client = {
      rest: {},
      rpc: vi.fn().mockResolvedValue({ data: null, error: { message: 'boom' } }),
    };

    const { data, error } = await callRpc(client, 'failing_fn', { a: 1 });

    expect(client.rpc).toHaveBeenCalledWith('failing_fn', { a: 1 });
    expect(data).toBeNull();
    expect(error).toEqual({ message: 'boom' });
  });

  it('omits args entirely when none are given', async () => {
    const client = {
      rest: {},
      rpc: vi.fn().mockResolvedValue({ data: [], error: null }),
    };

    await callRpc(client, 'list_operators_with_module_state');

    expect(client.rpc).toHaveBeenCalledWith('list_operators_with_module_state', undefined);
  });
});
