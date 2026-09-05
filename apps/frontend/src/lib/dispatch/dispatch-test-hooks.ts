/**
 * spec-77/spec-79 Fase 5 — QA-only test seam. `DT_ACCEPTED_LOCAL_FAILED`
 * (DispatchTrack confirmed the route, our own local write failed right
 * after — spec-79's Fase 0 window) has no legitimate, deterministic way to
 * reach from an E2E harness: it is a real DispatchTrack acceptance racing a
 * genuine local DB fault, and no data seeding alone reproduces it without
 * either weakening the assertion (spec-77 item 22 forbids that) or racing a
 * real timing window (flaky by construction). This lets the E2E harness
 * request the failure explicitly, on ONE request, via a header the app
 * would otherwise never look at.
 *
 * Double-gated, not just header-gated: `ALLOW_E2E_TEST_HOOKS` lives ONLY in
 * `/home/aureon/.env.qa` (see `infra/supabase-qa/systemd/`), never in the
 * production env file — so the header alone is inert everywhere except QA,
 * even if it somehow leaked into a request against another environment.
 * Neither the flag nor the header alone is enough; both conditions must
 * hold before this returns true.
 */
export function shouldSimulateLocalDispatchFailure(request: Request): boolean {
  if (process.env.ALLOW_E2E_TEST_HOOKS !== 'true') return false;
  return request.headers.get('x-e2e-simulate-local-failure') === 'true';
}
