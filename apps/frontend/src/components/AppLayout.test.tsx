import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';

// Mock dependencies
vi.mock('next/navigation', () => ({
  usePathname: () => '/app',
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock('@/lib/context/GlobalContext', () => ({
  useGlobal: () => ({ user: { email: 'test@example.com' } }),
}));

vi.mock('@/lib/supabase/client', () => ({
  createSPAClient: () => ({
    auth: {
      getSession: () => Promise.resolve({
        data: { session: { user: { app_metadata: { claims: { role: 'admin' } } } } },
      }),
    },
  }),
  createSPASassClient: () => Promise.resolve({ logout: vi.fn() }),
}));

const mockBranding = {
  logoUrl: null as string | null,
  companyName: null as string | null,
  primaryColor: null,
  secondaryColor: null,
  faviconUrl: null,
  isLoading: false,
};

vi.mock('@/providers/BrandingProvider', () => ({
  useBranding: () => mockBranding,
}));

import AppLayout from './AppLayout';

describe('AppLayout sidebar branding', () => {
  it('renders default product name when no branding', () => {
    mockBranding.logoUrl = null;
    mockBranding.companyName = null;

    render(<AppLayout><div>content</div></AppLayout>);

    // Product name from env or fallback
    const sidebar = document.querySelector('.border-b');
    expect(sidebar).toBeTruthy();
  });

  it('renders company name when set but no logo', () => {
    mockBranding.logoUrl = null;
    mockBranding.companyName = 'Musan Logistics';

    render(<AppLayout><div>content</div></AppLayout>);

    expect(screen.getByText('Musan Logistics')).toBeTruthy();
  });

  it('renders logo image when logoUrl is set', () => {
    mockBranding.logoUrl = 'https://example.com/logo.png';
    mockBranding.companyName = 'Musan Logistics';

    render(<AppLayout><div>content</div></AppLayout>);

    const img = document.querySelector('img[src="https://example.com/logo.png"]') as HTMLImageElement;
    expect(img).toBeTruthy();
    expect(img.alt).toBe('Musan Logistics');
    expect(img.className).toContain('max-h-10');
    expect(img.className).toContain('object-contain');
  });

  it('falls back to text on logo error', () => {
    mockBranding.logoUrl = 'https://example.com/broken.png';
    mockBranding.companyName = 'Fallback Corp';

    render(<AppLayout><div>content</div></AppLayout>);

    const img = document.querySelector('img') as HTMLImageElement;
    expect(img).toBeTruthy();

    // Simulate image error
    fireEvent.error(img);

    // After error, should show text instead
    expect(screen.getByText('Fallback Corp')).toBeTruthy();
  });
});
