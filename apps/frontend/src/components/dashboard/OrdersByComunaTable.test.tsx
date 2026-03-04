import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import OrdersByComunaTable from './OrdersByComunaTable';

vi.mock('@/hooks/useLoadingMetrics', () => ({
  useOrdersByComuna: () => ({
    data: [
      { comuna: 'Las Condes', count: 25, pct: 35.7 },
      { comuna: 'Providencia', count: 20, pct: 28.6 },
    ],
    isLoading: false,
  }),
}));

vi.mock('@/lib/supabase/client', () => ({
  createSPAClient: () => ({
    from: () => ({
      select: () => ({
        gte: () => ({
          lt: () => ({
            is: () => ({
              not: () => Promise.resolve({
                data: [
                  { recipient_region: 'Región Metropolitana' },
                  { recipient_region: 'Valparaíso' },
                ],
                error: null,
              }),
            }),
          }),
        }),
      }),
    }),
  }),
}));

function renderWithProvider(ui: React.ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>,
  );
}

describe('OrdersByComunaTable', () => {
  it('renders title "Órdenes por Comuna"', () => {
    renderWithProvider(<OrdersByComunaTable operatorId="op1" startDate="2026-01-01" endDate="2026-01-31" />);
    expect(screen.getByText('Órdenes por Comuna')).toBeDefined();
  });

  it('renders comuna names (Las Condes, Providencia)', () => {
    renderWithProvider(<OrdersByComunaTable operatorId="op1" startDate="2026-01-01" endDate="2026-01-31" />);
    expect(screen.getByText('Las Condes')).toBeDefined();
    expect(screen.getByText('Providencia')).toBeDefined();
  });

  it('renders region dropdown', () => {
    renderWithProvider(<OrdersByComunaTable operatorId="op1" startDate="2026-01-01" endDate="2026-01-31" />);
    const select = screen.getByRole('combobox');
    expect(select).toBeDefined();
    expect(screen.getByText('Todas las regiones')).toBeDefined();
  });
});
