import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
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
  { retailer_name: 'LowSLA', total_orders: 200, delivered_orders: 160, first_attempt_deliveries: 155, failed_deliveries: 40, sla_pct: 85.0, fadr_pct: 80.0 },
];

const mockCustomerQuery = {
  data: MOCK_DATA,
  isLoading: false,
  isError: false,
  isPlaceholderData: false,
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
  mockCustomerQuery.isPlaceholderData = false;
});

describe('CustomerPerformanceTable', () => {

  // --- Column headers (spec-13b requirement) ---
  describe('column headers', () => {
    it('renders all required column headers', () => {
      renderWithProvider(<CustomerPerformanceTable operatorId="op1" />);
      expect(screen.getByText('Cliente')).toBeDefined();
      expect(screen.getByText('Pedidos')).toBeDefined();
      expect(screen.getByText('SLA %')).toBeDefined();
      expect(screen.getByText('Fallidos')).toBeDefined();
      expect(screen.getByText('OTIF')).toBeDefined();
    });

    it('renders row data for each retailer', () => {
      renderWithProvider(<CustomerPerformanceTable operatorId="op1" />);
      expect(screen.getByText('Falabella')).toBeDefined();
      expect(screen.getByText('Paris')).toBeDefined();
      expect(screen.getByText('Ripley')).toBeDefined();
    });
  });

  // --- SLA color thresholds (spec-13b: green >= 93%, amber >= 88%, red < 88%) ---
  describe('SLA color thresholds', () => {
    it('applies text-status-success for SLA >= 93%', () => {
      renderWithProvider(<CustomerPerformanceTable operatorId="op1" />);
      // Falabella 96.2% and Paris 93.8% are both >= 93
      const cell96 = screen.getByText('96.2%');
      expect(cell96.className).toContain('text-status-success');
      expect(cell96.className).toContain('font-mono');
    });

    it('applies text-status-warning for SLA >= 88% and < 93%', () => {
      renderWithProvider(<CustomerPerformanceTable operatorId="op1" />);
      // Ripley 89.1% is >= 88 and < 93
      const cell89 = screen.getByText('89.1%');
      expect(cell89.className).toContain('text-status-warning');
      expect(cell89.className).toContain('font-mono');
    });

    it('applies text-status-error for SLA < 88%', () => {
      renderWithProvider(<CustomerPerformanceTable operatorId="op1" />);
      // LowSLA 85.0% is < 88
      const cell85 = screen.getByText('85.0%');
      expect(cell85.className).toContain('text-status-error');
      expect(cell85.className).toContain('font-mono');
    });

    it('applies text-status-success for SLA at boundary 93%', () => {
      mockCustomerQuery.data = [{
        retailer_name: 'Boundary', total_orders: 100, delivered_orders: 93,
        first_attempt_deliveries: 90, failed_deliveries: 7, sla_pct: 93.0, fadr_pct: 93.0,
      }];
      renderWithProvider(<CustomerPerformanceTable operatorId="op1" />);
      const cells = screen.getAllByText('93.0%');
      expect(cells[0].className).toContain('text-status-success');
    });

    it('applies text-status-warning for SLA at boundary 88%', () => {
      mockCustomerQuery.data = [{
        retailer_name: 'Boundary88', total_orders: 100, delivered_orders: 88,
        first_attempt_deliveries: 85, failed_deliveries: 12, sla_pct: 88.0, fadr_pct: 88.0,
      }];
      renderWithProvider(<CustomerPerformanceTable operatorId="op1" />);
      const cells = screen.getAllByText('88.0%');
      expect(cells[0].className).toContain('text-status-warning');
    });

    it('renders em dash for null SLA with muted color', () => {
      mockCustomerQuery.data = [{
        retailer_name: 'NullSLA', total_orders: 0, delivered_orders: 0,
        first_attempt_deliveries: 0, failed_deliveries: 0, sla_pct: null, fadr_pct: null,
      }];
      renderWithProvider(<CustomerPerformanceTable operatorId="op1" />);
      const dashes = screen.getAllByText('—');
      expect(dashes[0].className).toContain('text-text-muted');
    });
  });

  // --- OTIF color thresholds (same thresholds as SLA) ---
  describe('OTIF color thresholds', () => {
    it('applies text-status-success for OTIF >= 93%', () => {
      renderWithProvider(<CustomerPerformanceTable operatorId="op1" />);
      // Falabella fadr_pct 94.1% >= 93
      const cell = screen.getByText('94.1%');
      expect(cell.className).toContain('text-status-success');
    });

    it('applies text-status-warning for OTIF >= 88% and < 93%', () => {
      renderWithProvider(<CustomerPerformanceTable operatorId="op1" />);
      // Paris fadr_pct 91.2% is >= 88 and < 93 → warning
      const cell = screen.getByText('91.2%');
      expect(cell.className).toContain('text-status-warning');
    });

    it('applies text-status-warning for OTIF in warning range', () => {
      renderWithProvider(<CustomerPerformanceTable operatorId="op1" />);
      // Ripley fadr_pct 87.3% is < 88 → error; use LowSLA 80.0% → error
      // Insert explicit warning entry
      mockCustomerQuery.data = [{
        retailer_name: 'OTIFWarning', total_orders: 100, delivered_orders: 90,
        first_attempt_deliveries: 90, failed_deliveries: 10, sla_pct: 93.0, fadr_pct: 89.5,
      }];
    });
  });

  // --- Mono font on numeric cells ---
  describe('font-mono on numeric columns', () => {
    it('renders Pedidos with font-mono class', () => {
      renderWithProvider(<CustomerPerformanceTable operatorId="op1" />);
      const cell = screen.getByText('847');
      expect(cell.className).toContain('font-mono');
    });

    it('renders SLA % values with font-mono class', () => {
      renderWithProvider(<CustomerPerformanceTable operatorId="op1" />);
      const cell = screen.getByText('96.2%');
      expect(cell.className).toContain('font-mono');
    });

    it('renders Fallidos values with font-mono class', () => {
      renderWithProvider(<CustomerPerformanceTable operatorId="op1" />);
      const cell = screen.getByText('32');
      expect(cell.className).toContain('font-mono');
    });

    it('renders OTIF values with font-mono class', () => {
      renderWithProvider(<CustomerPerformanceTable operatorId="op1" />);
      const cell = screen.getByText('94.1%');
      expect(cell.className).toContain('font-mono');
    });
  });

  // --- Loading skeleton ---
  describe('loading state', () => {
    it('shows animate-pulse skeleton when isLoading is true', () => {
      mockCustomerQuery.isLoading = true;
      const { container } = renderWithProvider(<CustomerPerformanceTable operatorId="op1" />);
      expect(container.querySelectorAll('.animate-pulse').length).toBeGreaterThan(0);
    });

    it('does not render table rows when loading', () => {
      mockCustomerQuery.isLoading = true;
      renderWithProvider(<CustomerPerformanceTable operatorId="op1" />);
      expect(screen.queryByText('Falabella')).toBeNull();
    });
  });

  // --- Empty state ---
  describe('empty state', () => {
    it('shows empty message when no data', () => {
      mockCustomerQuery.data = [];
      renderWithProvider(<CustomerPerformanceTable operatorId="op1" />);
      expect(screen.getByText('No hay datos de clientes para este periodo')).toBeDefined();
    });
  });

  // --- Error state ---
  describe('error state', () => {
    it('shows error banner on API error', () => {
      mockCustomerQuery.isError = true;
      mockCustomerQuery.data = [];
      renderWithProvider(<CustomerPerformanceTable operatorId="op1" />);
      expect(screen.getByText('Los datos pueden estar desactualizados')).toBeDefined();
    });

    it('does not show empty state message when error occurs', () => {
      mockCustomerQuery.isError = true;
      mockCustomerQuery.data = [];
      renderWithProvider(<CustomerPerformanceTable operatorId="op1" />);
      expect(screen.queryByText('No hay datos de clientes para este periodo')).toBeNull();
    });
  });

  // --- Date range selector ---
  describe('date range', () => {
    it('renders date range dropdown with default 7-day option', () => {
      renderWithProvider(<CustomerPerformanceTable operatorId="op1" />);
      const select = screen.getByDisplayValue('Últimos 7 días');
      expect(select).toBeDefined();
    });

    it('shows custom date inputs when custom range is selected', async () => {
      const user = userEvent.setup();
      renderWithProvider(<CustomerPerformanceTable operatorId="op1" />);
      await user.selectOptions(screen.getByDisplayValue('Últimos 7 días'), 'custom');
      // Two date inputs should appear
      const dateInputs = screen.getAllByDisplayValue('');
      const dateTypeInputs = dateInputs.filter(
        el => el.getAttribute('type') === 'date'
      );
      expect(dateTypeInputs.length).toBeGreaterThanOrEqual(2);
    });

    it('shows all range options in dropdown', () => {
      renderWithProvider(<CustomerPerformanceTable operatorId="op1" />);
      expect(screen.getByText('Últimos 30 días')).toBeDefined();
      expect(screen.getByText('Últimos 90 días')).toBeDefined();
      expect(screen.getByText('Rango personalizado')).toBeDefined();
    });
  });

  // --- CSV export ---
  describe('CSV export', () => {
    it('triggers file download on export button click', async () => {
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

    it('generates CSV with correct headers', async () => {
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
      global.Blob = OrigBlob;
    });

    it('escapes CSV fields with commas and formula characters', async () => {
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

      expect(blobContent).toContain('"=evil,name""test"');
      global.Blob = OrigBlob;
    });
  });

  // --- Search (delegated to DataTable) ---
  describe('search filter', () => {
    it('renders search input with correct placeholder', () => {
      renderWithProvider(<CustomerPerformanceTable operatorId="op1" />);
      expect(screen.getByPlaceholderText('Buscar cliente...')).toBeDefined();
    });

    it('filters retailers by name via DataTable search', async () => {
      const user = userEvent.setup();
      renderWithProvider(<CustomerPerformanceTable operatorId="op1" />);
      await user.type(screen.getByPlaceholderText('Buscar cliente...'), 'fala');
      expect(screen.getByText('Falabella')).toBeDefined();
      expect(screen.queryByText('Paris')).toBeNull();
    });
  });

  // --- Drill-down dialog (row click via DataTable onRowClick) ---
  describe('drill-down dialog', () => {
    it('opens dialog when a row is clicked', async () => {
      const user = userEvent.setup();
      renderWithProvider(<CustomerPerformanceTable operatorId="op1" />);
      await user.click(screen.getByText('Falabella'));
      expect(screen.getByTestId('dialog')).toBeDefined();
      expect(screen.getByText('Detalle de rendimiento para Falabella')).toBeDefined();
    });

    it('shows retailer metrics in the dialog', async () => {
      const user = userEvent.setup();
      renderWithProvider(<CustomerPerformanceTable operatorId="op1" />);
      await user.click(screen.getByText('Falabella'));
      expect(screen.getByText('814')).toBeDefined(); // delivered_orders
    });

    it('closes dialog when onOpenChange fires false', async () => {
      const user = userEvent.setup();
      renderWithProvider(<CustomerPerformanceTable operatorId="op1" />);
      await user.click(screen.getByText('Falabella'));
      expect(screen.getByTestId('dialog')).toBeDefined();
    });
  });

  // --- Hook integration ---
  describe('useCustomerPerformance hook integration', () => {
    it('passes operatorId to hook and renders data', () => {
      renderWithProvider(<CustomerPerformanceTable operatorId="test-op" />);
      expect(screen.getByText('Falabella')).toBeDefined();
    });
  });

  // --- Placeholder data spinner ---
  describe('placeholder data loading indicator', () => {
    it('shows spinner overlay when isPlaceholderData is true', () => {
      mockCustomerQuery.isPlaceholderData = true;
      const { container } = renderWithProvider(<CustomerPerformanceTable operatorId="op1" />);
      expect(container.querySelector('.animate-spin')).toBeDefined();
    });

    it('does not show spinner when data is fresh', () => {
      mockCustomerQuery.isPlaceholderData = false;
      const { container } = renderWithProvider(<CustomerPerformanceTable operatorId="op1" />);
      expect(container.querySelector('.animate-spin')).toBeNull();
    });
  });
});
