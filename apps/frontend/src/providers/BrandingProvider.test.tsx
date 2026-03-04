import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// Mock supabase client
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
vi.mock('@/hooks/useDashboardMetrics', () => ({
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
    // Reset body inline styles
    document.body.removeAttribute('style');
  });

  it('provides default/fallback values when no branding config exists', async () => {
    mockSingle.mockResolvedValue({ data: { settings: {} }, error: null });

    const { result } = renderHook(() => useBranding(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.logoUrl).toBeNull();
    expect(result.current.companyName).toBeNull();
    expect(result.current.primaryColor).toBeNull();
    expect(result.current.secondaryColor).toBeNull();
  });

  it('provides branding values when config exists', async () => {
    mockSingle.mockResolvedValue({
      data: {
        settings: {
          branding: {
            company_name: 'Test Corp',
            logo_url: 'https://example.com/logo.png',
            primary_color: '#1e40af',
            secondary_color: '#475569',
          },
        },
      },
      error: null,
    });

    const { result } = renderHook(() => useBranding(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.companyName).toBe('Test Corp');
    expect(result.current.logoUrl).toBe('https://example.com/logo.png');
    expect(result.current.primaryColor).toBe('#1e40af');
    expect(result.current.secondaryColor).toBe('#475569');
  });

  it('handles partial branding config (company_name only)', async () => {
    mockSingle.mockResolvedValue({
      data: {
        settings: {
          branding: {
            company_name: 'Partial Corp',
          },
        },
      },
      error: null,
    });

    const { result } = renderHook(() => useBranding(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.companyName).toBe('Partial Corp');
    expect(result.current.primaryColor).toBeNull();
  });

  it('applies CSS variables to document.body when custom colors are set', async () => {
    mockSingle.mockResolvedValue({
      data: {
        settings: {
          branding: {
            primary_color: '#1e40af',
          },
        },
      },
      error: null,
    });

    renderHook(() => useBranding(), { wrapper: createWrapper() });

    await waitFor(() => {
      expect(document.body.style.getPropertyValue('--color-primary-500')).not.toBe('');
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

  it('handles fetch error gracefully', async () => {
    mockSingle.mockResolvedValue({ data: null, error: { message: 'fail' } });

    const { result } = renderHook(() => useBranding(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.companyName).toBeNull();
    expect(result.current.logoUrl).toBeNull();
  });
});
