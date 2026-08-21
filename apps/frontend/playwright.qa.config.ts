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
  // and now spec-62's reception-mobile (built on spec52-fixture.ts plus
  // support/reception-mobile-fixture.ts). Of the rest: auth-pages and
  // branding are screenshot-generation tools rather than assertions,
  // dispatch-route and spec47-pickup have no fixture, and
  // spec47-consolidated-reception is `test.skip`ped pending exactly this
  // environment. Widen this pattern as each grows a fixture.
  testMatch: /(spec52-.*|reception-mobile)\.spec\.ts$/,

  // The suite drives two browser contexts through a full pickup + reception
  // workday and polls the database between steps; the per-test timeouts inside
  // the spec go up to 240s. This is the outer bound for one test.
  timeout: 300_000,

  // No retries: a green-on-retry E2E hides exactly the flakiness we need to
  // see before this job is allowed to gate production.
  retries: 0,
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
