import { defineConfig } from '@playwright/test';

/**
 * Playwright against the VPS QA environment (spec-57 phase 2).
 *
 * Separate from playwright.config.ts on purpose. That config is for a
 * developer laptop: it boots `npm run dev` itself and targets :3000. Neither
 * is right here — QA's frontend already runs under systemd (aureon-frontend-qa
 * on :3200), so a `webServer` block would try to start a second Next.js on a
 * port that is already taken and hang until timeout.
 *
 * Run by the `e2e-qa` job in .github/workflows/deploy.yml on the self-hosted
 * VPS runner. It cannot run from a GitHub-hosted runner: every QA port binds to
 * localhost on the VPS.
 *
 * Required env (the workflow sources them from /home/aureon/.env.qa):
 *   E2E_BASE_URL       QA frontend           (default http://localhost:3200)
 *   E2E_DATABASE_URL   QA Postgres on :5433  (read by e2e/support/spec52-fixture.ts)
 */
export default defineConfig({
  testDir: './e2e',

  // Scoped to the suites that have a real seed/teardown fixture — spec-52,
  // spec-62's reception-mobile (built on spec52-fixture.ts plus
  // support/reception-mobile-fixture.ts), and now spec-76's
  // despacho-crew-mobile (its OWN seed namespace — support/despacho-fixture.ts
  // — not spec-52's; see the `workers: 1` comment below). Of the rest:
  // auth-pages and branding are screenshot-generation tools rather than
  // assertions, the old dispatch-route.spec.ts only ever asserted a URL
  // redirect (`/(app\/dispatch|login)/`, true either way) and is replaced by
  // despacho-crew-mobile for the behaviour it should have covered — but not
  // fully: that old spec ran at 1440×900 against the desktop `RouteBuilder`
  // tree, while despacho-crew-mobile runs only at 390×844 and never mounts
  // it, so the desktop route-builder path has no E2E coverage here.
  // spec47-pickup has no fixture, and spec47-consolidated-reception is
  // `test.skip`ped pending exactly this environment. Widen this pattern as
  // each grows a fixture.
  testMatch: /(spec52-.*|reception-mobile|despacho-crew-mobile)\.spec\.ts$/,

  // The suite drives two browser contexts through a full pickup + reception
  // workday and polls the database between steps; the per-test timeouts inside
  // the spec go up to 240s. This is the outer bound for one test.
  timeout: 300_000,

  // No retries: a green-on-retry E2E hides exactly the flakiness we need to
  // see before this job is allowed to gate production.
  retries: 0,

  // LOAD-BEARING, not a default left alone. spec52-fixture.ts and
  // reception-mobile-fixture.ts share spec-52's seed namespace — same
  // PREFIX ('E2E52'), same PLATE, same two user emails — and seed() opens
  // with teardown(). despacho-fixture.ts (spec-76) is namespaced
  // separately (PREFIX 'E2E76', its own vehicle and crew email) precisely
  // so it does NOT collide with that pair, but it still shares the same
  // database and the same `routes`/`orders`/`operator_enabled_modules`
  // tables — two suites' seed()/teardown() interleaving is still a real
  // risk regardless of namespace (e.g. one suite's teardown scanning a
  // table mid-write by another). Serial execution is what keeps every
  // suite's seed()/teardown() pair from ever running concurrently with
  // another's. Raising this (or turning on fullyParallel) requires more
  // than namespacing — it requires auditing every fixture's queries for
  // cross-suite interference, not just cross-suite deletion.
  workers: 1,
  forbidOnly: true,

  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report-qa' }]],

  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3200',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
    viewport: { width: 1440, height: 900 },
  },

  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
});
