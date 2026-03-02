import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import CustomerPerformanceTable from './CustomerPerformanceTable';
import type { CustomerPerformanceRow } from '@/hooks/useDashboardMetrics';

// Mock dialog portal
vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({ children, open }: { children: React.ReactNode; open: boolean }) =>
    open ? React.createElement('div', { 'data-testid': 'dialog' }, children) : null,
  DialogContent: ({ children }: { children: React.ReactNode }) =>
    React.createElement('div', { 'data-testid': 'dialog-content' }, children),
  DialogHeader: ({ children }: { children: React.ReactNode }) =>
    React.createElement('div', null, children),
  DialogTitle: ({ children }: { children: React.ReactNode }) =>
    React.createElement('h2', null, children),
  DialogDescription: ({ children }: { children: React.ReactNode }) =>
    React.createElement('p', null, children),
}));

const MOCK_DATA: CustomerPerformanceRow[] = [
  { retailer_name: 'Falabella', total_orders: 847, delivered_orders: 814, first_attempt_deliveries: 797, failed_deliveries: 32, sla_pct: 96.2, fadr_pct: 94.1 },
  { retailer_name: 'Paris', total_orders: 623, delivered_orders: 584, first_attempt_deliveries: 568, failed_deliveries: 54, sla_pct: 93.8, fadr_pct: 91.2 },
  { retailer_name: 'Ripley', total_orders: 512, delivered_orders: 456, first_attempt_deliveries: 447, failed_deliveries: 65, sla_pct: 89.1, fadr_pct: 87.3 },
  { retailer_name: 'Lider', total_orders: 294, delivered_orders: 285, first_attempt_deliveries: 284, failed_deliveries: 9, sla_pct: 97.1, fadr_pct: 96.8 },
];

const mockCustomerQuery = {
  data: MOCK_DATA,
  isLoading: false,
  isError: false,
  isStale: false,
  refetch: vi.fn(),
};

vi.mock('@/hooks/useDashboardMetrics', () => ({
  useCustomerPerformance: () => mockCustomerQuery,
}));

vi.mock('@/lib/supabase/client', () => ({
  createSPAClient: () => ({
    from: () => ({
      insert: vi.fn().mockResolvedValue({ data: null, error: null }),
    }),
  }),
}));

// Mock URL.createObjectURL / revokeObjectURL
global.URL.createObjectURL = vi.fn(() => 'blob:mock');
global.URL.revokeObjectURL = vi.fn();

function renderWithProvider(ui: React.ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>
  );
}

beforeEach(() => {
  mockCustomerQuery.data = MOCK_DATA;
  mockCustomerQuery.isLoading = false;
  mockCustomerQuery.isError = false;
});

describe('CustomerPerformanceTable', () => {
  // --- Sort logic tests (AC2, Task 4) ---
  describe('sort logic', () => {
    it('defaults to Pedidos descending (largest first)', () => {
      renderWithProvider(<CustomerPerformanceTable operatorId="op1" />);
      const rows = screen.getAllByRole('row').slice(1); // skip header
      expect(within(rows[0]).getByText('Falabella')).toBeDefined();
      expect(within(rows[1]).getByText('Paris')).toBeDefined();
    });

    it('toggles sort direction on same column click', async () => {
      const user = userEvent.setup();
      renderWithProvider(<CustomerPerformanceTable operatorId="op1" />);
      const pedidosHeader = screen.getByText('Pedidos');
      await user.click(pedidosHeader); // flip to asc
      const rows = screen.getAllByRole('row').slice(1);
      expect(within(rows[0]).getByText('Lider')).toBeDefined();
    });

    it('sorts by different column in desc on click', async () => {
      const user = userEvent.setup();
      renderWithProvider(<CustomerPerformanceTable operatorId="op1" />);
      await user.click(screen.getByText('SLA %'));
      const rows = screen.getAllByRole('row').slice(1);
      // desc SLA: Lider 97.1 > Falabella 96.2 > Paris 93.8 > Ripley 89.1
      expect(within(rows[0]).getByText('Lider')).toBeDefined();
    });

    it('sorts by Cliente column alphabetically', async () => {
      const user = userEvent.setup();
      renderWithProvider(<CustomerPerformanceTable operatorId="op1" />);
      await user.click(screen.getByText('Cliente'));
      // desc alphabetical: Ripley, Paris, Lider, Falabella
      const rows = screen.getAllByRole('row').slice(1);
      expect(within(rows[0]).getByText('Ripley')).toBeDefined();
    });

    it('sort headers are keyboard accessible', async () => {
      const user = userEvent.setup();
      renderWithProvider(<CustomerPerformanceTable operatorId="op1" />);
      const header = screen.getByText('Pedidos');
      header.focus();
      await user.keyboard('{Enter}');
      const rows = screen.getAllByRole('row').slice(1);
      expect(within(rows[0]).getByText('Lider')).toBeDefined();
    });
  });

  // --- Color-coding tests (AC3, Task 2) ---
  describe('color-coding', () => {
    it('applies green background for SLA >= 95%', () => {
      renderWithProvider(<CustomerPerformanceTable operatorId="op1" />);
      const cell = screen.getByText('96.2%');
      expect(cell.className).toContain('bg-[#10b981]/10');
    });

    it('applies yellow background for SLA 90-94.9%', () => {
      renderWithProvider(<CustomerPerformanceTable operatorId="op1" />);
      const cell = screen.getByText('93.8%');
      expect(cell.className).toContain('bg-[#f59e0b]/10');
    });

    it('applies red background for SLA < 90%', () => {
      renderWithProvider(<CustomerPerformanceTable operatorId="op1" />);
      const cell = screen.getByText('89.1%');
      expect(cell.className).toContain('bg-[#ef4444]/10');
    });

    it('applies green for FADR >= 90%', () => {
      renderWithProvider(<CustomerPerformanceTable operatorId="op1" />);
      const cell = screen.getByText('94.1%');
      expect(cell.className).toContain('bg-[#10b981]/10');
    });

    it('applies yellow for FADR 80-89.9%', () => {
      renderWithProvider(<CustomerPerformanceTable operatorId="op1" />);
      const cell = screen.getByText('87.3%');
      expect(cell.className).toContain('bg-[#f59e0b]/10');
    });

    it('shows warning styling for Fallos > 8% of total orders', () => {
      renderWithProvider(<CustomerPerformanceTable operatorId="op1" />);
      // Ripley: 65/512 = 12.7% > 8%
      // Find the Ripley row by finding "Ripley" text and then its row
      const ripleyRow = screen.getByText('Ripley').closest('tr')!;
      // The Fallos cell for Ripley (65) should have amber styling
      const fallosCell = within(ripleyRow).getByText('65');
      expect(fallosCell.className).toContain('text-amber-600');
    });
  });

  // --- Search filter tests (AC5, Task 5) ---
  describe('search filter', () => {
    it('filters by retailer name case-insensitively', async () => {
      const user = userEvent.setup();
      renderWithProvider(<CustomerPerformanceTable operatorId="op1" />);
      await user.type(screen.getByPlaceholderText('Buscar cliente...'), 'fala');
      expect(screen.getByText('Falabella')).toBeDefined();
      expect(screen.queryByText('Paris')).toBeNull();
    });

    it('matches partial strings', async () => {
      const user = userEvent.setup();
      renderWithProvider(<CustomerPerformanceTable operatorId="op1" />);
      await user.type(screen.getByPlaceholderText('Buscar cliente...'), 'ri');
      expect(screen.getByText('Ripley')).toBeDefined();
      expect(screen.getByText('Paris')).toBeDefined();
      expect(screen.queryByText('Falabella')).toBeNull();
      expect(screen.queryByText('Lider')).toBeNull();
    });

    it('shows all retailers when search is empty', async () => {
      const user = userEvent.setup();
      renderWithProvider(<CustomerPerformanceTable operatorId="op1" />);
      const input = screen.getByPlaceholderText('Buscar cliente...');
      await user.type(input, 'xyz');
      expect(screen.queryByText('Falabella')).toBeNull();
      await user.clear(input);
      expect(screen.getByText('Falabella')).toBeDefined();
    });
  });

  // --- Pagination tests (AC6, Task 6) ---
  describe('pagination', () => {
    it('shows count display', () => {
      renderWithProvider(<CustomerPerformanceTable operatorId="op1" />);
      expect(screen.getByText('Mostrando 4 de 4 clientes')).toBeDefined();
    });

    it('shows Load More button when more than 10 items', () => {
      // Generate 15 rows
      mockCustomerQuery.data = Array.from({ length: 15 }, (_, i) => ({
        retailer_name: `Retailer ${i}`,
        total_orders: 100 - i,
        delivered_orders: 90 - i,
        first_attempt_deliveries: 85 - i,
        failed_deliveries: 5,
        sla_pct: 95,
        fadr_pct: 90,
      }));
      renderWithProvider(<CustomerPerformanceTable operatorId="op1" />);
      expect(screen.getByText('Cargar más')).toBeDefined();
      expect(screen.getByText('Mostrando 10 de 15 clientes')).toBeDefined();
    });

    it('loads more rows on click', async () => {
      const user = userEvent.setup();
      mockCustomerQuery.data = Array.from({ length: 15 }, (_, i) => ({
        retailer_name: `Retailer ${i}`,
        total_orders: 100 - i,
        delivered_orders: 90 - i,
        first_attempt_deliveries: 85 - i,
        failed_deliveries: 5,
        sla_pct: 95,
        fadr_pct: 90,
      }));
      renderWithProvider(<CustomerPerformanceTable operatorId="op1" />);
      await user.click(screen.getByText('Cargar más'));
      expect(screen.getByText('Mostrando 15 de 15 clientes')).toBeDefined();
    });
  });

  // --- CSV export tests (AC7, Task 8) ---
  describe('CSV export', () => {
    it('creates downloadable CSV with correct filename', async () => {
      const user = userEvent.setup();
      const clickSpy = vi.fn();
      const originalCreateElement = document.createElement.bind(document);
      vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
        const el = originalCreateElement(tag);
        if (tag === 'a') {
          Object.defineProperty(el, 'click', { value: clickSpy });
        }
        return el;
      });

      renderWithProvider(<CustomerPerformanceTable operatorId="op1" />);
      await user.click(screen.getByText('Exportar CSV ↓'));
      expect(clickSpy).toHaveBeenCalled();
      vi.restoreAllMocks();
    });
  });

  // --- Accessibility tests (AC9) ---
  describe('accessibility', () => {
    it('uses semantic table elements', () => {
      const { container } = renderWithProvider(<CustomerPerformanceTable operatorId="op1" />);
      expect(container.querySelector('table')).toBeDefined();
      expect(container.querySelector('thead')).toBeDefined();
      expect(container.querySelector('tbody')).toBeDefined();
      expect(container.querySelectorAll('th[scope="col"]').length).toBeGreaterThan(0);
    });

    it('has aria-sort only on active sort column', () => {
      const { container } = renderWithProvider(<CustomerPerformanceTable operatorId="op1" />);
      const headersWithSort = container.querySelectorAll('th[aria-sort]');
      expect(headersWithSort.length).toBe(1);
      expect(headersWithSort[0].textContent).toContain('Pedidos');
      expect(headersWithSort[0].getAttribute('aria-sort')).toBe('descending');
    });

    it('Ver detalles buttons have descriptive aria-label', () => {
      renderWithProvider(<CustomerPerformanceTable operatorId="op1" />);
      expect(screen.getByLabelText('Ver detalles de Falabella')).toBeDefined();
      expect(screen.getByLabelText('Ver detalles de Paris')).toBeDefined();
    });

    it('sort headers have tabIndex for keyboard access', () => {
      const { container } = renderWithProvider(<CustomerPerformanceTable operatorId="op1" />);
      const sortableHeaders = container.querySelectorAll('th[tabindex="0"]');
      expect(sortableHeaders.length).toBe(5);
    });
  });

  // --- Edge cases (AC8) ---
  describe('edge cases', () => {
    it('shows empty state when no data', () => {
      mockCustomerQuery.data = [];
      renderWithProvider(<CustomerPerformanceTable operatorId="op1" />);
      expect(screen.getByText('No hay datos de clientes para este periodo')).toBeDefined();
    });

    it('shows skeleton when loading', () => {
      mockCustomerQuery.isLoading = true;
      const { container } = renderWithProvider(<CustomerPerformanceTable operatorId="op1" />);
      expect(container.querySelectorAll('.animate-pulse').length).toBeGreaterThan(0);
    });

    it('shows error banner with retry on API error', () => {
      mockCustomerQuery.isError = true;
      mockCustomerQuery.data = [];
      renderWithProvider(<CustomerPerformanceTable operatorId="op1" />);
      expect(screen.getByText('Error al cargar datos.')).toBeDefined();
      expect(screen.getByText('Reintentar')).toBeDefined();
    });

    it('handles single retailer', () => {
      mockCustomerQuery.data = [MOCK_DATA[0]];
      renderWithProvider(<CustomerPerformanceTable operatorId="op1" />);
      expect(screen.getByText('Falabella')).toBeDefined();
      expect(screen.getByText('Mostrando 1 de 1 clientes')).toBeDefined();
    });

    it('truncates long retailer names with title attribute', () => {
      mockCustomerQuery.data = [{
        retailer_name: 'Supermercado Internacional de Santiago de Chile LTDA',
        total_orders: 100, delivered_orders: 90, first_attempt_deliveries: 85,
        failed_deliveries: 5, sla_pct: 90.0, fadr_pct: 85.0,
      }];
      renderWithProvider(<CustomerPerformanceTable operatorId="op1" />);
      const cell = screen.getByText('Supermercado Internacional de Santiago de Chile LTDA');
      expect(cell.getAttribute('title')).toBe('Supermercado Internacional de Santiago de Chile LTDA');
      expect(cell.className).toContain('truncate');
    });
  });

  // --- Drill-down dialog (AC1, AC9, Task 3) ---
  describe('drill-down dialog', () => {
    it('opens dialog on Ver detalles click', async () => {
      const user = userEvent.setup();
      renderWithProvider(<CustomerPerformanceTable operatorId="op1" />);
      await user.click(screen.getByLabelText('Ver detalles de Falabella'));
      expect(screen.getByTestId('dialog')).toBeDefined();
      expect(screen.getByText('Detalle de rendimiento para Falabella')).toBeDefined();
    });
  });

  // --- Hook tests (Task 11.6) ---
  describe('useCustomerPerformance hook integration', () => {
    it('passes operatorId to hook and renders data', () => {
      renderWithProvider(<CustomerPerformanceTable operatorId="test-op" />);
      expect(screen.getByText('Falabella')).toBeDefined();
    });
  });

  // --- Date range tests (AC4, M1) ---
  describe('date range', () => {
    it('renders date range dropdown with default option', () => {
      renderWithProvider(<CustomerPerformanceTable operatorId="op1" />);
      const select = screen.getByDisplayValue('Últimos 7 días');
      expect(select).toBeDefined();
    });

    it('shows custom date inputs when custom range selected', async () => {
      const user = userEvent.setup();
      renderWithProvider(<CustomerPerformanceTable operatorId="op1" />);
      await user.selectOptions(screen.getByDisplayValue('Últimos 7 días'), 'custom');
      expect(screen.getAllByDisplayValue('').length).toBeGreaterThanOrEqual(2); // two date inputs
    });
  });

  // --- CSV content validation (M3) ---
  describe('CSV content', () => {
    it('generates CSV with correct headers and escaped fields', async () => {
      const user = userEvent.setup();
      let blobContent = '';
      const OrigBlob = global.Blob;
      global.Blob = class MockBlob extends OrigBlob {
        constructor(parts?: BlobPart[], options?: BlobPropertyBag) {
          super(parts, options);
          blobContent = parts?.join('') ?? '';
        }
      } as typeof Blob;

      renderWithProvider(<CustomerPerformanceTable operatorId="op1" />);
      await user.click(screen.getByText('Exportar CSV ↓'));

      expect(blobContent).toContain('Cliente,Pedidos,SLA %,FADR %,Fallos');
      expect(blobContent).toContain('Falabella');
      expect(blobContent).toContain('96.2');
      global.Blob = OrigBlob;
    });

    it('escapes fields with commas and formula characters', async () => {
      const user = userEvent.setup();
      mockCustomerQuery.data = [{
        retailer_name: '=evil,name"test',
        total_orders: 10, delivered_orders: 9, first_attempt_deliveries: 8,
        failed_deliveries: 1, sla_pct: 90.0, fadr_pct: 80.0,
      }];
      let blobContent = '';
      const OrigBlob = global.Blob;
      global.Blob = class MockBlob extends OrigBlob {
        constructor(parts?: BlobPart[], options?: BlobPropertyBag) {
          super(parts, options);
          blobContent = parts?.join('') ?? '';
        }
      } as typeof Blob;

      renderWithProvider(<CustomerPerformanceTable operatorId="op1" />);
      await user.click(screen.getByText('Exportar CSV ↓'));

      // Field should be quoted and inner quotes doubled
      expect(blobContent).toContain('"=evil,name""test"');
      global.Blob = OrigBlob;
    });
  });

  // --- FADR red threshold (L2) ---
  describe('FADR red threshold', () => {
    it('applies red for FADR < 80%', () => {
      mockCustomerQuery.data = [{
        retailer_name: 'LowFADR', total_orders: 100, delivered_orders: 90,
        first_attempt_deliveries: 70, failed_deliveries: 10, sla_pct: 90.0, fadr_pct: 70.0,
      }];
      renderWithProvider(<CustomerPerformanceTable operatorId="op1" />);
      const cell = screen.getByText('70.0%');
      expect(cell.className).toContain('bg-[#ef4444]/10');
    });
  });

  // --- Error state without empty message (H3) ---
  describe('error state', () => {
    it('does not show empty state message when error occurs', () => {
      mockCustomerQuery.isError = true;
      mockCustomerQuery.data = [];
      renderWithProvider(<CustomerPerformanceTable operatorId="op1" />);
      expect(screen.getByText('Error al cargar datos.')).toBeDefined();
      expect(screen.queryByText('No hay datos de clientes para este periodo')).toBeNull();
    });
  });
});
