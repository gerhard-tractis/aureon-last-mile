import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  mockQuery,
  mockGoto,
  mockLocator,
  mockEvaluate,
  mockWaitForTimeout,
  mockNewContext,
  mockBrowserClose,
  mockLaunch,
  mockDecryptField,
  mockAddCookies,
  mockUrl,
} = vi.hoisted(() => {
  const mockFill = vi.fn().mockResolvedValue(undefined);
  const mockClick = vi.fn().mockResolvedValue(undefined);
  const mockIsChecked = vi.fn().mockResolvedValue(false);
  const mockFirst = vi.fn().mockReturnValue({ fill: mockFill });

  const mockFilter = vi.fn().mockReturnValue({ click: mockClick });
  const mockLocator = vi.fn().mockImplementation((sel: string) => {
    if (sel.includes('input[type="email"]')) return { first: () => ({ fill: mockFill }) };
    if (sel.includes('input[type="checkbox"]')) return { first: () => ({ isChecked: mockIsChecked, click: mockClick }) };
    if (sel === 'button') return { filter: mockFilter };
    if (sel.includes('hp-modal__surface button')) return { filter: mockFilter };
    return { first: mockFirst, filter: mockFilter };
  });

  const mockUrl = vi.fn().mockReturnValue('https://paris.dispatchtrack.com/dispatch_guides_list');
  const mockEvaluate = vi.fn().mockResolvedValue(['Reporte enviado al correo electrónico']);
  const mockGoto = vi.fn().mockResolvedValue(undefined);
  const mockWaitForTimeout = vi.fn().mockResolvedValue(undefined);
  const mockAddCookies = vi.fn().mockResolvedValue(undefined);

  const mockPage = {
    goto: mockGoto,
    locator: mockLocator,
    evaluate: mockEvaluate,
    waitForTimeout: mockWaitForTimeout,
    url: mockUrl,
  };

  const mockNewPage = vi.fn().mockResolvedValue(mockPage);
  const mockNewContext = vi.fn().mockResolvedValue({
    newPage: mockNewPage,
    addCookies: mockAddCookies,
  });
  const mockBrowserClose = vi.fn().mockResolvedValue(undefined);
  const mockLaunch = vi.fn().mockResolvedValue({
    newContext: mockNewContext,
    close: mockBrowserClose,
  });

  return {
    mockQuery: vi.fn(),
    mockGoto,
    mockLocator,
    mockEvaluate,
    mockWaitForTimeout,
    mockNewContext,
    mockBrowserClose,
    mockLaunch,
    mockDecryptField: vi.fn(),
    mockAddCookies,
    mockUrl,
  };
});

vi.mock('../db', () => ({
  pool: { query: mockQuery },
}));

vi.mock('../logger', () => ({
  log: vi.fn(),
}));

vi.mock('@sentry/node', () => ({
  captureException: vi.fn(),
}));

vi.mock('playwright', () => ({
  chromium: { launch: mockLaunch },
}));

vi.mock('../crypto', () => ({
  decryptField: mockDecryptField,
}));

import { executeBeetrack } from './beetrack';
import { JobRecord } from './types';

const baseJob: JobRecord = {
  id: 'job-123',
  job_type: 'browser',
  client_id: 'paris-client-id',
  operator_id: '92dc5797-047d-458d-bbdb-63f18c0dd1e7',
  retry_count: 0,
  max_retries: 3,
  priority: 5,
  scheduled_at: '2026-02-27T10:00:00Z',
};

const mockConnectorConfig = {
  dispatchtrack_url: 'https://paris.dispatchtrack.com',
  session_cookie: 'ENCRYPTED:session123',
  remember_token: 'ENCRYPTED:remember456',
  report_email_to: 'contacto@transportesmusan.com',
};

describe('executeBeetrack', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockQuery.mockResolvedValueOnce({
      rows: [{ connector_config: mockConnectorConfig }],
    });
    mockDecryptField.mockImplementation((val: string) => val.replace('ENCRYPTED:', 'decrypted_'));
    mockUrl.mockReturnValue('https://paris.dispatchtrack.com/dispatch_guides_list');
    mockEvaluate.mockResolvedValue(['Reporte enviado al correo electrónico']);
  });

  it('loads connector_config from DB using client_id', async () => {
    await executeBeetrack(baseJob);
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('tenant_clients'),
      [baseJob.client_id],
    );
  });

  it('decrypts session_cookie and remember_token', async () => {
    await executeBeetrack(baseJob);
    expect(mockDecryptField).toHaveBeenCalledWith('ENCRYPTED:session123');
    expect(mockDecryptField).toHaveBeenCalledWith('ENCRYPTED:remember456');
  });

  it('launches Playwright with minimal memory flags', async () => {
    await executeBeetrack(baseJob);
    expect(mockLaunch).toHaveBeenCalledWith(
      expect.objectContaining({
        headless: true,
        args: expect.arrayContaining([
          '--no-sandbox',
          '--disable-gpu',
          '--disable-dev-shm-usage',
        ]),
      }),
    );
  });

  it('sets session cookies on browser context', async () => {
    await executeBeetrack(baseJob);
    expect(mockAddCookies).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ name: '_cluster_1_dt_auth_session', value: 'decrypted_session123' }),
        expect.objectContaining({ name: 'remember_user_token', value: 'decrypted_remember456' }),
      ]),
    );
  });

  it('navigates to dispatch_guides_list with date filter params', async () => {
    await executeBeetrack(baseJob);
    expect(mockGoto).toHaveBeenCalledWith(
      expect.stringMatching(/dispatch_guides_list\?fld=&dft=1&se\[from\]=.*&se\[to\]=/),
      expect.any(Object),
    );
  });

  it('returns success with report_triggered on happy path', async () => {
    const result = await executeBeetrack(baseJob);
    expect(result.success).toBe(true);
    expect(result.result).toEqual(expect.objectContaining({
      report_triggered: true,
      email_to: 'contacto@transportesmusan.com',
      include_items: true,
    }));
  });

  it('detects expired session (redirect to sign_in)', async () => {
    mockUrl.mockReturnValue('https://paris.dispatchtrack.com/sign_in');
    const result = await executeBeetrack(baseJob);
    expect(result.success).toBe(false);
    expect(result.errorMessage).toContain('expired');
  });

  it('always closes browser even on error', async () => {
    mockGoto.mockReset().mockRejectedValueOnce(new Error('Navigation failed'));
    await executeBeetrack(baseJob);
    expect(mockBrowserClose).toHaveBeenCalled();
  });

  it('returns failure when connector_config not found', async () => {
    mockQuery.mockReset();
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const result = await executeBeetrack(baseJob);
    expect(result.success).toBe(false);
    expect(result.errorMessage).toContain('connector_config');
  });

  it('returns failure when report_email_to not configured', async () => {
    mockQuery.mockReset();
    mockQuery.mockResolvedValueOnce({
      rows: [{ connector_config: { ...mockConnectorConfig, report_email_to: '' } }],
    });
    const result = await executeBeetrack(baseJob);
    expect(result.success).toBe(false);
    expect(result.errorMessage).toContain('report_email_to');
  });

  it('returns failure when cookies cannot be decrypted', async () => {
    mockDecryptField.mockImplementation(() => {
      throw new Error('Invalid key');
    });
    const result = await executeBeetrack(baseJob);
    expect(result.success).toBe(false);
    expect(result.errorMessage).toContain('Invalid key');
  });

  it('returns failure when export modal does not confirm', async () => {
    mockEvaluate.mockResolvedValue([]);
    const result = await executeBeetrack(baseJob);
    expect(result.success).toBe(false);
    expect(result.errorMessage).toContain('Export modal');
  });
});
