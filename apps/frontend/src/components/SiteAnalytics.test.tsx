import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import React from 'react';

// `usePathname` is mutable per-test so each case can point at a different route
// without re-mocking the module.
let mockPathname = '/legal';

vi.mock('next/navigation', () => ({
  usePathname: () => mockPathname,
}));

// Consent cookie value is mutable per-test for the same reason.
let mockConsentCookie: string | undefined;

vi.mock('cookies-next/client', () => ({
  getCookie: () => mockConsentCookie,
  setCookie: vi.fn(),
}));

// Stub GA and Vercel Analytics with testids so tests can assert on presence
// without pulling in the real third-party scripts.
vi.mock('@next/third-parties/google', () => ({
  GoogleAnalytics: () => <div data-testid="ga" />,
}));

vi.mock('@vercel/analytics/next', () => ({
  Analytics: () => <div data-testid="vercel-analytics" />,
}));

import SiteAnalytics from '@/components/SiteAnalytics';

const GA_ID = 'G-TEST123';

describe('SiteAnalytics', () => {
  beforeEach(() => {
    mockPathname = '/legal';
    mockConsentCookie = undefined;
    // Cookies.tsx delays showing the banner by 1s to avoid a first-paint
    // flash; fake timers let tests fast-forward past that delay.
    vi.useFakeTimers();
    // window is shared across tests in this file; clear any disable flag a
    // previous test may have left behind so each test starts from a clean slate.
    delete (window as unknown as Record<string, unknown>)[`ga-disable-${GA_ID}`];
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders nothing on an internal /app route: no banner, no GA', () => {
    mockPathname = '/app/reception';
    render(<SiteAnalytics gaId={GA_ID} />);
    act(() => {
      vi.advanceTimersByTime(1000);
    });

    expect(screen.queryByTestId('ga')).not.toBeInTheDocument();
    expect(screen.queryByTestId('vercel-analytics')).not.toBeInTheDocument();
    expect(screen.queryByText(/We use cookies/i)).not.toBeInTheDocument();
  });

  it('renders nothing on an internal /admin route: no banner, no GA', () => {
    mockPathname = '/admin/tools';
    render(<SiteAnalytics gaId={GA_ID} />);
    act(() => {
      vi.advanceTimersByTime(1000);
    });

    expect(screen.queryByTestId('ga')).not.toBeInTheDocument();
    expect(screen.queryByTestId('vercel-analytics')).not.toBeInTheDocument();
    expect(screen.queryByText(/We use cookies/i)).not.toBeInTheDocument();
  });

  it('on a public route with no consent cookie, shows the banner but not GA', () => {
    mockPathname = '/legal';
    mockConsentCookie = undefined;
    render(<SiteAnalytics gaId={GA_ID} />);
    act(() => {
      vi.advanceTimersByTime(1000);
    });

    expect(screen.getByText(/We use cookies/i)).toBeInTheDocument();
    expect(screen.queryByTestId('ga')).not.toBeInTheDocument();
    expect(screen.getByTestId('vercel-analytics')).toBeInTheDocument();
  });

  it('on a public route with accepted consent, renders GA', () => {
    mockPathname = '/legal';
    mockConsentCookie = 'accepted';
    render(<SiteAnalytics gaId={GA_ID} />);

    expect(screen.getByTestId('ga')).toBeInTheDocument();
  });

  it('on a public route with declined consent, does NOT render GA — this is the whole point of this spec', () => {
    mockPathname = '/legal';
    mockConsentCookie = 'declined';
    render(<SiteAnalytics gaId={GA_ID} />);

    expect(screen.queryByTestId('ga')).not.toBeInTheDocument();
    // Vercel Web Analytics is cookieless, so it stays regardless of consent.
    expect(screen.getByTestId('vercel-analytics')).toBeInTheDocument();
  });

  it('clicking Accept mounts GA without a reload', () => {
    mockPathname = '/legal';
    mockConsentCookie = undefined;
    render(<SiteAnalytics gaId={GA_ID} />);
    act(() => {
      vi.advanceTimersByTime(1000);
    });

    expect(screen.queryByTestId('ga')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /accept/i }));

    // No reload occurred (jsdom would throw/no-op on navigation); GA appears
    // purely from the in-memory consent state update.
    expect(screen.getByTestId('ga')).toBeInTheDocument();
  });

  it('treats /application as PUBLIC, not internal (prefix match must be exact-segment)', () => {
    mockPathname = '/application';
    mockConsentCookie = 'accepted';
    render(<SiteAnalytics gaId={GA_ID} />);

    // Consent already exists, so the banner has no reason to show (Cookies.tsx
    // only surfaces it when there is no prior decision) — the point here is
    // that this route is NOT treated as internal, so GA is allowed to render.
    expect(screen.getByTestId('vercel-analytics')).toBeInTheDocument();
    expect(screen.getByTestId('ga')).toBeInTheDocument();
  });

  it('does not render GA when gaId is not configured, even with accepted consent on a public route', () => {
    mockPathname = '/legal';
    mockConsentCookie = 'accepted';
    render(<SiteAnalytics />);

    expect(screen.queryByTestId('ga')).not.toBeInTheDocument();
  });

  describe('GA opt-out flag (window["ga-disable-<id>"])', () => {
    // gtag.js has no unmount cleanup, so unmounting <GoogleAnalytics> alone
    // does not stop already-loaded GA from reporting client-side navigations.
    // Google's documented kill switch is this window flag, which gtag.js
    // checks before sending any hit.
    const disableFlag = () =>
      (window as unknown as Record<string, unknown>)[`ga-disable-${GA_ID}`];

    it('sets the flag to true on an internal route', () => {
      mockPathname = '/app/reception';
      mockConsentCookie = 'accepted';
      render(<SiteAnalytics gaId={GA_ID} />);

      expect(disableFlag()).toBe(true);
    });

    it('sets the flag to false on a public route with accepted consent', () => {
      mockPathname = '/legal';
      mockConsentCookie = 'accepted';
      render(<SiteAnalytics gaId={GA_ID} />);

      expect(disableFlag()).toBe(false);
    });

    it('sets the flag to true on a public route with declined consent', () => {
      mockPathname = '/legal';
      mockConsentCookie = 'declined';
      render(<SiteAnalytics gaId={GA_ID} />);

      expect(disableFlag()).toBe(true);
    });

    it('flips the flag to true when navigating from a public route to an internal one', () => {
      mockPathname = '/legal';
      mockConsentCookie = 'accepted';
      const { rerender } = render(<SiteAnalytics gaId={GA_ID} />);
      expect(disableFlag()).toBe(false);

      mockPathname = '/app/reception';
      rerender(<SiteAnalytics gaId={GA_ID} />);

      expect(disableFlag()).toBe(true);
    });

    it('flips the flag to false the instant Accept is clicked, without a reload', () => {
      // Consent is in-memory state, not a page reload: this proves the flag
      // reacts to a live decision made through the banner (not just to the
      // cookie value read once at mount), which is the same mechanism that
      // must apply if the user were to later revoke consent.
      mockPathname = '/legal';
      mockConsentCookie = undefined;
      render(<SiteAnalytics gaId={GA_ID} />);
      act(() => {
        vi.advanceTimersByTime(1000);
      });
      expect(disableFlag()).toBe(true);

      fireEvent.click(screen.getByRole('button', { name: /accept/i }));

      expect(disableFlag()).toBe(false);
      expect(screen.getByTestId('ga')).toBeInTheDocument();
    });

    it('sets the flag to true when the user declines through the banner (no prior cookie)', () => {
      mockPathname = '/legal';
      mockConsentCookie = undefined;
      render(<SiteAnalytics gaId={GA_ID} />);
      act(() => {
        vi.advanceTimersByTime(1000);
      });
      expect(disableFlag()).toBe(true);

      fireEvent.click(screen.getByRole('button', { name: /decline/i }));

      expect(disableFlag()).toBe(true);
      expect(screen.queryByTestId('ga')).not.toBeInTheDocument();
    });
  });
});
