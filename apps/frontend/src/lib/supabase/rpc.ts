export interface RpcResult<T> {
  data: T | null;
  error: { message: string } | null;
}

interface RpcCapable<T> {
  rpc: (fn: string, args?: Record<string, unknown>) => Promise<RpcResult<T>>;
}

/**
 * Call a Postgres RPC whose name is not in the generated types union.
 *
 * WHY THIS EXISTS — do not inline it back.
 *
 * The obvious workaround for an un-generated RPC name is to cast the method:
 *
 *   const { data } = await (supabase.rpc as unknown as Fn)('my_rpc', args);
 *
 * That parenthesised expression is a *bare function reference*, not a method
 * call, so `this` is undefined inside it. supabase-js's `SupabaseClient.rpc()`
 * reads `this.rest`, so every such call threw at runtime:
 *
 *   TypeError: Cannot read properties of undefined (reading 'rest')
 *
 * It shipped because unit tests mock the client as a plain object whose `rpc`
 * is a `vi.fn()` — detaching a mock works fine, so no test could see it. Only a
 * real client cares about its receiver. Found on 2026-08-13 when
 * /admin/modules 500'd in QA; the same idiom was present in four files,
 * including two added by spec-53.
 *
 * Casting the *client* instead of the method keeps the call a method call, so
 * the receiver survives.
 */
export async function callRpc<T>(
  client: unknown,
  fn: string,
  args?: Record<string, unknown>,
): Promise<RpcResult<T>> {
  return (client as RpcCapable<T>).rpc(fn, args);
}
