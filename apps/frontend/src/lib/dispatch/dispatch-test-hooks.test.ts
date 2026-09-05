import { describe, it, expect, afterEach, vi } from 'vitest';
import { shouldSimulateLocalDispatchFailure } from '@/lib/dispatch/dispatch-test-hooks';

/**
 * spec-77/spec-79 Fase 5 — the QA-only seam that lets the E2E harness force
 * the DT_ACCEPTED_LOCAL_FAILED path deterministically (spec-77 item 22): DT
 * genuinely confirms the route, our own local completion is made to fail
 * right after, exactly the window spec-79's Fase 0 describes. Double-gated
 * on purpose — the header alone must do nothing unless the environment flag
 * is ALSO set, and the flag is only ever set in /home/aureon/.env.qa, never
 * in production's env file. Neither condition alone may enable it.
 */
describe('shouldSimulateLocalDispatchFailure', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  function request(headers: Record<string, string> = {}): Request {
    return new Request('http://localhost/api/dispatch/routes/r1/dispatch', { headers });
  }

  it('is false with neither the env flag nor the header', () => {
    expect(shouldSimulateLocalDispatchFailure(request())).toBe(false);
  });

  it('is false when only the header is present — the env flag must also be set', () => {
    expect(shouldSimulateLocalDispatchFailure(request({ 'x-e2e-simulate-local-failure': 'true' }))).toBe(false);
  });

  it('is false when only the env flag is set — a request needs to opt in explicitly', () => {
    vi.stubEnv('ALLOW_E2E_TEST_HOOKS', 'true');
    expect(shouldSimulateLocalDispatchFailure(request())).toBe(false);
  });

  it('is true only when both the env flag and the header are set', () => {
    vi.stubEnv('ALLOW_E2E_TEST_HOOKS', 'true');
    expect(shouldSimulateLocalDispatchFailure(request({ 'x-e2e-simulate-local-failure': 'true' }))).toBe(true);
  });

  it('rejects a header value other than the literal string "true"', () => {
    vi.stubEnv('ALLOW_E2E_TEST_HOOKS', 'true');
    expect(shouldSimulateLocalDispatchFailure(request({ 'x-e2e-simulate-local-failure': '1' }))).toBe(false);
  });

  it('rejects any ALLOW_E2E_TEST_HOOKS value other than the literal string "true"', () => {
    vi.stubEnv('ALLOW_E2E_TEST_HOOKS', 'yes');
    expect(shouldSimulateLocalDispatchFailure(request({ 'x-e2e-simulate-local-failure': 'true' }))).toBe(false);
  });
});
