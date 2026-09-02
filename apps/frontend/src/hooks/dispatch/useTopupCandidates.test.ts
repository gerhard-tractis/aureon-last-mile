import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import {
  useTopupCandidates,
  useAcceptTopup,
  TopupCandidatesError,
  TopupAcceptError,
} from './useTopupCandidates';

const mockFetch = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  global.fetch = mockFetch as unknown as typeof fetch;
});

function wrapper({ children }: { children: React.ReactNode }) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return React.createElement(QueryClientProvider, { client: queryClient }, children);
}

function jsonResponse(body: unknown, ok = true, status = 200) {
  return { ok, status, json: async () => body };
}

describe('useTopupCandidates', () => {
  it('fetches and camelCases the GET /topup payload', async () => {
    mockFetch.mockResolvedValue(
      jsonResponse({
        route_id: 'r1',
        eligible: true,
        reason: null,
        candidates: [
          {
            route_block_id: 'rb1',
            donor_route_id: 'r2',
            donor_external_route_id: 'EXT-2',
            donor_driver_name: 'Juan',
            comuna_id: 'c1',
            comuna_name: 'Providencia',
            package_count: 4,
          },
        ],
      }),
    );

    const { result } = renderHook(() => useTopupCandidates('r1', 'op-1'), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockFetch).toHaveBeenCalledWith('/api/dispatch/routes/r1/topup');
    expect(result.current.data).toEqual({
      routeId: 'r1',
      eligible: true,
      reason: null,
      candidates: [
        {
          routeBlockId: 'rb1',
          donorRouteId: 'r2',
          donorExternalRouteId: 'EXT-2',
          donorDriverName: 'Juan',
          comunaId: 'c1',
          comunaName: 'Providencia',
          packageCount: 4,
        },
      ],
    });
  });

  it('does not fetch when disabled (e.g. role gate not passed)', () => {
    renderHook(() => useTopupCandidates('r1', 'op-1', false), { wrapper });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('does not fetch when routeId or operatorId is missing', () => {
    renderHook(() => useTopupCandidates(null, 'op-1'), { wrapper });
    renderHook(() => useTopupCandidates('r1', null), { wrapper });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('throws a TopupCandidatesError carrying the API code on failure', async () => {
    mockFetch.mockResolvedValue(jsonResponse({ code: 'FORBIDDEN', message: 'nope' }, false, 403));
    const { result } = renderHook(() => useTopupCandidates('r1', 'op-1'), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBeInstanceOf(TopupCandidatesError);
    expect((result.current.error as TopupCandidatesError).code).toBe('FORBIDDEN');
  });
});

describe('useAcceptTopup', () => {
  it('POSTs snake_case body and returns the accepted result', async () => {
    mockFetch.mockResolvedValue(jsonResponse({ route_block_id: 'rb-new' }));
    const { result } = renderHook(() => useAcceptTopup('r1', 'op-1'), { wrapper });

    result.current.mutate({ donorRouteId: 'r2', comunaId: 'c1', reason: 'relleno' });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockFetch).toHaveBeenCalledWith('/api/dispatch/routes/r1/topup/accept', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ donor_route_id: 'r2', comuna_id: 'c1', reason: 'relleno' }),
    });
  });

  it('throws a TopupAcceptError carrying the refusal code on failure', async () => {
    mockFetch.mockResolvedValue(jsonResponse({ code: 'AT_MAX_DROPS' }, false, 409));
    const { result } = renderHook(() => useAcceptTopup('r1', 'op-1'), { wrapper });

    result.current.mutate({ donorRouteId: 'r2', comunaId: 'c1', reason: 'relleno' });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBeInstanceOf(TopupAcceptError);
    expect((result.current.error as TopupAcceptError).code).toBe('AT_MAX_DROPS');
  });

  it('invalidates the candidates, blocks, packages and route queries on both success and failure', async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
    function localWrapper({ children }: { children: React.ReactNode }) {
      return React.createElement(QueryClientProvider, { client: queryClient }, children);
    }

    mockFetch.mockResolvedValueOnce(jsonResponse({}));
    const { result, rerender } = renderHook(() => useAcceptTopup('r1', 'op-1'), { wrapper: localWrapper });
    result.current.mutate({ donorRouteId: 'r2', comunaId: 'c1', reason: 'ok' });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['dispatch', 'topup-candidates', 'r1'] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['dispatch', 'route-blocks', 'r1'] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['dispatch', 'packages', 'r1'] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['dispatch', 'route', 'r1', 'op-1'] });

    invalidateSpy.mockClear();
    mockFetch.mockResolvedValueOnce(jsonResponse({ code: 'BLOCK_ALREADY_STAGED' }, false, 409));
    rerender();
    result.current.mutate({ donorRouteId: 'r2', comunaId: 'c1', reason: 'ok' });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['dispatch', 'topup-candidates', 'r1'] });
  });
  // Review addition (spec-73 phase 4b adversarial review): an accept moves a
  // whole block OFF the donor route. Only the receiving route's caches were
  // invalidated, so the donor's own RouteBuilder — block sequence and package
  // list alike — went on rendering the block it no longer owns. The borrowed
  // block then appears on BOTH routes until something else happens to evict
  // the donor's cache.
  it('invalidates the DONOR route caches too, not just the receiving route', async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
    function localWrapper({ children }: { children: React.ReactNode }) {
      return React.createElement(QueryClientProvider, { client: queryClient }, children);
    }

    mockFetch.mockResolvedValueOnce(jsonResponse({}));
    const { result } = renderHook(() => useAcceptTopup('r1', 'op-1'), { wrapper: localWrapper });
    result.current.mutate({ donorRouteId: 'donor-9', comunaId: 'c1', reason: 'ok' });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['dispatch', 'route-blocks', 'donor-9'] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['dispatch', 'packages', 'donor-9'] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['dispatch', 'route', 'donor-9', 'op-1'] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['dispatch', 'topup-candidates', 'donor-9'] });
  });
});
