import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { useQueryClient } from '@tanstack/react-query';
import Providers from './Providers';

// Capture the QueryClient created inside Providers
let capturedClient: ReturnType<typeof useQueryClient> | null = null;

function QueryClientCapture() {
  capturedClient = useQueryClient();
  return null;
}

function renderProviders() {
  capturedClient = null;
  render(
    <Providers>
      <QueryClientCapture />
    </Providers>
  );
  return capturedClient!;
}

describe('Providers', () => {
  beforeEach(() => {
    capturedClient = null;
  });

  it('configures retry: 3', () => {
    const client = renderProviders();
    expect(client.getDefaultOptions().queries?.retry).toBe(3);
  });

  it('configures retryDelay with exponential backoff [1000, 2000, 4000]', () => {
    const client = renderProviders();
    const retryDelay = client.getDefaultOptions().queries?.retryDelay as (attempt: number) => number;
    expect(retryDelay(0)).toBe(1000);
    expect(retryDelay(1)).toBe(2000);
    expect(retryDelay(2)).toBe(4000);
    expect(retryDelay(3)).toBe(4000); // fallback
  });

  it('configures refetchOnWindowFocus: true', () => {
    const client = renderProviders();
    expect(client.getDefaultOptions().queries?.refetchOnWindowFocus).toBe(true);
  });

  it('configures refetchOnReconnect: true', () => {
    const client = renderProviders();
    expect(client.getDefaultOptions().queries?.refetchOnReconnect).toBe(true);
  });

  it('configures staleTime: 30000', () => {
    const client = renderProviders();
    expect(client.getDefaultOptions().queries?.staleTime).toBe(30000);
  });

  it('configures gcTime: 300000', () => {
    const client = renderProviders();
    expect(client.getDefaultOptions().queries?.gcTime).toBe(300000);
  });

  it('renders ReactQueryDevtools only in development', () => {
    const originalEnv = process.env.NODE_ENV;
    // NODE_ENV is 'test' in vitest — devtools should NOT render
    render(
      <Providers>
        <span data-testid="child">child</span>
      </Providers>
    );
    expect(screen.getByTestId('child')).toBeDefined();
    // ReactQueryDevtools renders a button with title "Open TanStack Query Devtools"
    // in dev mode — in test/prod mode it should not be present
    expect(screen.queryByTitle(/TanStack Query Devtools/i)).toBeNull();
    process.env.NODE_ENV = originalEnv;
  });
});
