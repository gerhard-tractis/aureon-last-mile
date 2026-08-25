import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import React from 'react';

// ── mocks ─────────────────────────────────────────────────────────────────────
const mockGetSession = vi.hoisted(() => vi.fn());

vi.mock('@/lib/supabase/server', () => ({
  createSSRClient: vi.fn().mockResolvedValue({
    auth: { getSession: mockGetSession },
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            is: vi.fn().mockReturnValue({
              order: vi.fn().mockResolvedValue({ data: [], error: null }),
            }),
          }),
        }),
      }),
    }),
  }),
}));

const mockRedirect = vi.hoisted(() =>
  vi.fn().mockImplementation(() => {
    throw new Error('NEXT_REDIRECT');
  }),
);

vi.mock('next/navigation', () => ({ redirect: mockRedirect }));

vi.mock('./OcrTestClient', () => ({
  default: () => <div data-testid="ocr-test-client" />,
}));

import OcrTestPage from './page';

// ── helpers ────────────────────────────────────────────────────────────────────
function sessionWithRole(role: string) {
  return {
    data: {
      session: { user: { app_metadata: { claims: { role, operator_id: 'op-1' } } } },
    },
  };
}

// ── tests ──────────────────────────────────────────────────────────────────────
describe('OcrTestPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('redirects to /auth/login when there is no session', async () => {
    mockGetSession.mockResolvedValue({ data: { session: null } });
    await expect(OcrTestPage()).rejects.toThrow('NEXT_REDIRECT');
    expect(mockRedirect).toHaveBeenCalledWith('/auth/login');
  });

  it('redirects to /app when role is not admin', async () => {
    mockGetSession.mockResolvedValue(sessionWithRole('operator'));
    await expect(OcrTestPage()).rejects.toThrow('NEXT_REDIRECT');
    expect(mockRedirect).toHaveBeenCalledWith('/app');
  });

  it('renders OcrTestClient when role is admin', async () => {
    mockGetSession.mockResolvedValue(sessionWithRole('admin'));
    const element = await OcrTestPage();
    const { getByTestId } = render(element as React.ReactElement);
    expect(getByTestId('ocr-test-client')).toBeInTheDocument();
  });
});
