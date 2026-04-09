import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// Mock supabase client — controlled via mockSingle
const mockSingle = vi.fn();

vi.mock('@/lib/supabase/client', () => ({
  createSPAClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({ single: mockSingle }),
      }),
    }),
  }),
}));

// Mock useOperatorId to return a stable operator ID immediately
vi.mock('@/hooks/useOperatorId', () => ({
  useOperatorId: () => ({ operatorId: 'test-op-id', role: 'admin' }),
}));

import { BrandingProvider, useBranding } from './BrandingProvider';

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <BrandingProvider>{children}</BrandingProvider>
      </QueryClientProvider>
    );
  };
}

describe('BrandingProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset documentElement inline styles between tests
    document.documentElement.removeAttribute('style');
    document.body.removeAttribute('style');
  });

  it('provides hasBranding: false and palette: null when no branding configured', async () => {
    mockSingle.mockResolvedValue({ data: { settings: {} }, error: null });

    const { result } = renderHook(() => useBranding(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.hasBranding).toBe(false);
    expect(result.current.palette).toBeNull();
    expect(result.current.logoUrl).toBeNull();
    expect(result.current.companyName).toBeNull();
  });

  it('provides hasBranding: false when palette fields are missing required colors', async () => {
    mockSingle.mockResolvedValue({
      data: {
        settings: {
          branding: {
            company_name: 'Partial Corp',
            // Missing brand_primary, brand_background, brand_text
          },
        },
      },
      error: null,
    });

    const { result } = renderHook(() => useBranding(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.hasBranding).toBe(false);
    expect(result.current.palette).toBeNull();
    expect(result.current.companyName).toBe('Partial Corp');
  });

  it('provides hasBranding: true and non-null palette when all 3 required colors are valid', async () => {
    mockSingle.mockResolvedValue({
      data: {
        settings: {
          branding: {
            company_name: 'Brand Corp',
            logo_url: 'https://example.com/logo.png',
            brand_primary: '#c8102e',
            brand_background: '#ffffff',
            brand_text: '#1a1a1a',
          },
        },
      },
      error: null,
    });

    const { result } = renderHook(() => useBranding(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.hasBranding).toBe(true);
    expect(result.current.palette).toEqual({
      brand_primary: '#c8102e',
      brand_background: '#ffffff',
      brand_text: '#1a1a1a',
      brand_secondary: undefined,
    });
    expect(result.current.companyName).toBe('Brand Corp');
    expect(result.current.logoUrl).toBe('https://example.com/logo.png');
  });

  it('includes brand_secondary in palette when provided', async () => {
    mockSingle.mockResolvedValue({
      data: {
        settings: {
          branding: {
            brand_primary: '#c8102e',
            brand_background: '#ffffff',
            brand_text: '#1a1a1a',
            brand_secondary: '#0057b8',
          },
        },
      },
      error: null,
    });

    const { result } = renderHook(() => useBranding(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.hasBranding).toBe(true);
    expect(result.current.palette?.brand_secondary).toBe('#0057b8');
  });

  it('injects CSS tokens to documentElement (not body) when palette is valid', async () => {
    mockSingle.mockResolvedValue({
      data: {
        settings: {
          branding: {
            brand_primary: '#c8102e',
            brand_background: '#ffffff',
            brand_text: '#1a1a1a',
          },
        },
      },
      error: null,
    });

    renderHook(() => useBranding(), { wrapper: createWrapper() });

    await waitFor(() => {
      expect(
        document.documentElement.style.getPropertyValue('--color-accent')
      ).not.toBe('');
    });

    // Must NOT be on body
    expect(document.body.style.getPropertyValue('--color-accent')).toBe('');
  });

  it('does NOT inject tokens to documentElement when palette is null', async () => {
    mockSingle.mockResolvedValue({ data: { settings: {} }, error: null });

    renderHook(() => useBranding(), { wrapper: createWrapper() });

    await waitFor(() => {
      // Small wait to let the effect run
      expect(document.documentElement.style.getPropertyValue('--color-accent')).toBe('');
    });
  });

  it('updates document.title when companyName is set', async () => {
    mockSingle.mockResolvedValue({
      data: {
        settings: {
          branding: { company_name: 'Title Corp' },
        },
      },
      error: null,
    });

    renderHook(() => useBranding(), { wrapper: createWrapper() });

    await waitFor(() => {
      expect(document.title).toBe('Title Corp — Aureon Last Mile');
    });
  });

  it('falls back to default title when no companyName', async () => {
    mockSingle.mockResolvedValue({ data: { settings: {} }, error: null });

    renderHook(() => useBranding(), { wrapper: createWrapper() });

    await waitFor(() => {
      expect(document.title).toBe('Aureon Last Mile');
    });
  });

  it('handles fetch error gracefully — returns null branding fields', async () => {
    mockSingle.mockResolvedValue({ data: null, error: { message: 'fail' } });

    const { result } = renderHook(() => useBranding(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.hasBranding).toBe(false);
    expect(result.current.palette).toBeNull();
    expect(result.current.companyName).toBeNull();
    expect(result.current.logoUrl).toBeNull();
  });
});
