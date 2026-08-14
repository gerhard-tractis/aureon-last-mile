import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

/**
 * Guard against the detached-rpc idiom coming back.
 *
 * `await (supabase.rpc as unknown as Fn)('my_rpc', args)` is a bare function
 * reference, not a method call, so `this` is undefined inside it and
 * supabase-js throws reading `this.rest`. Use callRpc(client, fn, args) from
 * lib/supabase/rpc.ts, which casts the *client* and keeps the call a method
 * call.
 *
 * This is a source scan rather than a runtime test on purpose. Unit tests mock
 * the client as a plain object whose `rpc` is a vi.fn(), and detaching a mock
 * works fine — only a real client cares about its receiver. Every instance of
 * this bug reached production green, twice (#404, then usePipelineCounts and
 * useActiveRoutes during spec-54). A grep is the only thing that sees it.
 */

const SRC = resolve(process.cwd(), 'src');

// Matches the method being cast away from its receiver: `.rpc as`.
const DETACHED_RPC = /\.rpc\s+as\b/;

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.next') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...walk(full));
    } else if (/\.(ts|tsx)$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

describe('no detached supabase rpc calls', () => {
  it('has no source file casting .rpc away from its client', () => {
    const offenders: string[] = [];

    for (const file of walk(SRC)) {
      const rel = relative(SRC, file).replace(/\\/g, '/');
      // rpc.ts documents the broken form in its comment, and its own test
      // asserts that the broken form throws. Both are deliberate.
      if (rel === 'lib/supabase/rpc.ts' || rel === 'lib/supabase/rpc.test.ts') continue;
      if (rel === 'lib/supabase/no-detached-rpc.test.ts') continue;

      const source = readFileSync(file, 'utf8');
      source.split('\n').forEach((line, i) => {
        if (DETACHED_RPC.test(line)) offenders.push(`${rel}:${i + 1}`);
      });
    }

    expect(offenders).toEqual([]);
  });
});
