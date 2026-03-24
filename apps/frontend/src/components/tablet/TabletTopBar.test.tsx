import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';

vi.mock('next/navigation', () => ({
  usePathname: () => '/app/pickup',
  useRouter: () => ({ push: vi.fn() }),
}));

const mockBranding = {
  logoUrl: null as string | null,
  companyName: 'TestCo' as string | null,
  primaryColor: null,
  secondaryColor: null,
  faviconUrl: null,
  isLoading: false,
};

vi.mock('@/providers/BrandingProvider', () => ({
  useBranding: () => mockBranding,
}));

import TabletTopBar from './TabletTopBar';

beforeEach(() => {
  mockBranding.logoUrl = null;
  mockBranding.companyName = 'TestCo';
});

describe('TabletTopBar', () => {
  it('renders back button linking to /app/tablet-home', () => {
    render(<TabletTopBar />);
    const link = screen.getByRole('link', { name: /inicio/i });
    expect(link.getAttribute('href')).toBe('/app/tablet-home');
  });

  it('renders company name when no logo', () => {
    render(<TabletTopBar />);
    expect(screen.getByText('TestCo')).toBeTruthy();
  });

  it('renders logo image when logoUrl is set', () => {
    mockBranding.logoUrl = 'https://example.com/logo.png';
    mockBranding.companyName = 'AcmeCo';
    render(<TabletTopBar />);
    const img = document.querySelector('img') as HTMLImageElement;
    expect(img).toBeTruthy();
    expect(img.alt).toBe('AcmeCo');
  });

  it('back button has minimum touch target', () => {
    render(<TabletTopBar />);
    const link = screen.getByRole('link', { name: /inicio/i });
    expect(link.className).toContain('min-h-[48px]');
  });
});
