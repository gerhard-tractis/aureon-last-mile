// src/connectors/beetrack.ts — DispatchTrack browser connector (cookie-based session + export API)
import { chromium, Browser } from 'playwright';
import { JobRecord, JobResult } from './types';
import { pool } from '../db';
import { decryptField } from '../crypto';
import { log } from '../logger';

interface ConnectorConfig {
  dispatchtrack_url: string;
  session_cookie: string;
  remember_token: string;
  report_email_to: string;
  [key: string]: unknown;
}

export async function executeBeetrack(job: JobRecord): Promise<JobResult> {
  const { rows } = await pool.query(
    `SELECT connector_config FROM tenant_clients WHERE id = $1`,
    [job.client_id],
  );
  if (rows.length === 0) {
    return { success: false, errorMessage: 'No connector_config found for client' };
  }

  const config = rows[0].connector_config as ConnectorConfig;
  const baseUrl = config.dispatchtrack_url || 'https://paris.dispatchtrack.com';
  const emailTo = config.report_email_to;
  if (!emailTo) {
    return { success: false, errorMessage: 'report_email_to not configured' };
  }

  let browser: Browser | null = null;

  try {
    const sessionCookie = decryptField(config.session_cookie);
    const rememberToken = decryptField(config.remember_token);

    // Launch browser just for cookie-authenticated page load + export trigger
    browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'],
    });
    const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });

    const domain = new URL(baseUrl).hostname.replace(/^[^.]+/, '');
    await context.addCookies([
      { name: '_cluster_4_dt_auth_session', value: sessionCookie, domain, path: '/' },
      { name: 'remember_user_token', value: rememberToken, domain, path: '/' },
    ]);

    const page = await context.newPage();

    // Load the orders page with today's creation-date filter
    const today = new Date();
    const dd = String(today.getDate()).padStart(2, '0');
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    const yyyy = today.getFullYear();
    const dateParam = `${dd}-${mm}-${yyyy}`;

    const listUrl = `${baseUrl}/dispatch_guides_list?fld=&dft=1&se[from]=${dateParam}&se[to]=${dateParam}`;
    log('info', 'beetrack_navigate', { jobId: job.id, url: listUrl });

    await page.goto(listUrl, { waitUntil: 'networkidle', timeout: 30000 });

    // Detect expired session (redirect to sign_in)
    if (page.url().includes('sign_in')) {
      log('error', 'beetrack_session_expired', { jobId: job.id });
      // TODO: Send Slack notification for cookie recalibration
      return { success: false, errorMessage: 'Session cookies expired — recalibration needed' };
    }

    // Open export modal
    await page.locator('button').filter({ hasText: 'Exportar a excel' }).click({ force: true });
    await page.waitForTimeout(1000);

    // Fill email in modal
    const emailInput = page.locator('.hp-modal__surface input[type="email"]').first();
    await emailInput.fill(emailTo);

    // Check "Incluir items" checkbox (for carton IDs)
    const checkbox = page.locator('.hp-modal__surface input[type="checkbox"]').first();
    const isChecked = await checkbox.isChecked();
    if (!isChecked) {
      await checkbox.click({ force: true });
      await page.waitForTimeout(300);
    }

    // Click "Generar reporte"
    await page.locator('.hp-modal__surface button').filter({ hasText: 'Generar reporte' }).click();
    await page.waitForTimeout(2000);

    // Verify success toast (evaluate runs in browser context — use string to avoid DOM types)
    const feedback = await page.evaluate(`
      (() => {
        const toasts = document.querySelectorAll("[class*='toast'], [role='alert']");
        return Array.from(toasts).map(t => (t.textContent || '').trim()).filter(t => t.length > 0);
      })()
    `) as string[];
    const success = feedback.some(f => f.includes('correo electrónico'));

    if (success) {
      log('info', 'beetrack_export_triggered', {
        jobId: job.id,
        date: `${yyyy}-${mm}-${dd}`,
        emailTo,
        includeItems: true,
      });
      return {
        success: true,
        result: {
          report_triggered: true,
          date: `${yyyy}-${mm}-${dd}`,
          email_to: emailTo,
          include_items: true,
        },
      };
    }

    return { success: false, errorMessage: 'Export modal did not confirm email send' };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    log('error', 'beetrack_error', { jobId: job.id, error: errorMessage });
    return { success: false, errorMessage };
  } finally {
    if (browser) {
      await browser.close().catch(() => {});
    }
  }
}
