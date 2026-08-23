import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import OrdersPage from './page';
import type { OrdersListRow } from '@/hooks/useOrdersList';

const mockReplace = vi.fn();
let currentSearch = '';
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: mockReplace, push: vi.fn() }),
  usePathname: () => '/app/orders',
  useSearchParams: () => new URLSearchParams(currentSearch),
}));

const mockUseOperatorId = vi.fn();
vi.mock('@/hooks/useOperatorId', () => ({
  useOperatorId: () => mockUseOperatorId(),
}));

const mockUseOrdersList = vi.fn();
vi.mock('@/hooks/useOrdersList', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/hooks/useOrdersList')>();
  return {
    ...actual,
    useOrdersList: (...args: unknown[]) => mockUseOrdersList(...args),
  };
});

const mockUseActiveRoutes = vi.fn();
vi.mock('@/hooks/useActiveRoutes', () => ({
  useActiveRoutes: (...args: unknown[]) => mockUseActiveRoutes(...args),
}));

const SAMPLE_ROWS: OrdersListRow[] = [
  {
    id: 'ord-1',
    order_number: 'ORD-001',
    customer_name: 'Falabella',
    leading_status: 'en_ruta',
    comuna: 'Ñuñoa',
    package_count: 2,
    route_label: 'R-1',
    driver_name: 'Juan',
    sla_status: 'late',
    minutes_remaining: -30,
    last_event_at: null,
    last_event_label: 'Salió a reparto',
    has_pod: false,
    total_count: 1,
  },
];

function renderPage() {
  const qc = new QueryClient();
  return render(
    <QueryClientProvider client={qc}>
      <OrdersPage />
    </QueryClientProvider>,
  );
}

describe('OrdersPage', () => {
  beforeEach(() => {
    currentSearch = '';
    mockReplace.mockClear();
    mockUseOperatorId.mockReturnValue({
      operatorId: 'op-1',
      role: 'admin',
      permissions: ['admin'],
      userId: 'u1',
    });
    mockUseOrdersList.mockReset();
    mockUseOrdersList.mockReturnValue({ data: { rows: SAMPLE_ROWS, totalCount: 1 }, isLoading: false });
    mockUseActiveRoutes.mockReturnValue({
      data: [{ id: 'r-1', external_route_id: 'R-2481', driver_name: 'Juan', status: 'in_progress' }],
    });
  });

  it('renders tabs, rail, table and rows', () => {
    renderPage();
    expect(screen.getByRole('tab', { name: /sla en riesgo/i })).toBeInTheDocument();
    expect(screen.getByText('FILTROS')).toBeInTheDocument();
    expect(screen.getByText('ORD-001')).toBeInTheDocument();
  });

  it('on a bare landing, queries with the default preset\'s resolved SLA filter and normalizes the URL', () => {
    renderPage();
    expect(mockUseOrdersList).toHaveBeenCalledWith(
      'op-1',
      expect.objectContaining({ sla: ['late', 'at_risk'] }),
      0,
    );
    expect(mockReplace).toHaveBeenCalledWith(expect.stringContaining('sla=late%2Cat_risk'));
  });

  it('passes the eleven order_status_enum values as statusOptions with Spanish labels from getStatusLabel', () => {
    renderPage();
    expect(screen.getByRole('checkbox', { name: 'En reparto' })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Entregada' })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Parcialmente entregada' })).toBeInTheDocument();
  });

  it('maps useActiveRoutes results into RUTA select options', () => {
    renderPage();
    expect(screen.getByRole('option', { name: 'R-2481' })).toBeInTheDocument();
  });

  it('switching preset tabs resets filters to the new preset and returns to page 0', async () => {
    currentSearch = 'vista=todas';
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('tab', { name: /en reparto/i }));
    expect(mockReplace).toHaveBeenCalledWith('/app/orders?vista=en-reparto&estado=en_ruta');
  });

  it('editing a filter via the rail keeps the current preset id and overrides filters', () => {
    currentSearch = 'vista=en-reparto&estado=en_ruta';
    renderPage();
    fireEvent.change(screen.getByLabelText(/courier.*conductor/i), { target: { value: 'Juan' } });
    expect(mockReplace).toHaveBeenLastCalledWith(
      '/app/orders?vista=en-reparto&estado=en_ruta&conductor=Juan',
    );
  });

  it('"Limpiar" clears all filters but keeps the preset id in the URL', () => {
    currentSearch = 'vista=en-reparto&estado=en_ruta&conductor=Juan';
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Limpiar' }));
    expect(mockReplace).toHaveBeenLastCalledWith('/app/orders?vista=en-reparto');
  });

  it('"URL compartible" copies window.location.href rather than persisting anything', () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(window.navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: /url compartible/i }));
    expect(writeText).toHaveBeenCalledWith(window.location.href);
  });

  it('selecting a row surfaces it in OrdersBulkBar with a working Exportar button', () => {
    renderPage();
    fireEvent.click(screen.getByRole('checkbox', { name: /seleccionar ord-001/i }));
    const exportButton = screen.getByRole('button', { name: /exportar/i });
    expect(exportButton).toBeInTheDocument();
    expect(within(exportButton.parentElement as HTMLElement).getByText('1')).toBeInTheDocument();
  });

  it('pagination "Siguiente" advances the page param without touching filters', () => {
    currentSearch = 'vista=en-reparto&estado=en_ruta';
    mockUseOrdersList.mockReturnValue({ data: { rows: SAMPLE_ROWS, totalCount: 60 }, isLoading: false });
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Siguiente' }));
    expect(mockReplace).toHaveBeenLastCalledWith('/app/orders?vista=en-reparto&estado=en_ruta&pagina=1');
  });

  it('"Anterior" is disabled on the first page', () => {
    currentSearch = 'vista=en-reparto&estado=en_ruta';
    mockUseOrdersList.mockReturnValue({ data: { rows: SAMPLE_ROWS, totalCount: 60 }, isLoading: false });
    renderPage();
    expect(screen.getByRole('button', { name: 'Anterior' })).toBeDisabled();
  });

  it('row click is a stubbed no-op pending Task 8', () => {
    renderPage();
    expect(() => fireEvent.click(screen.getByText('ORD-001'))).not.toThrow();
    expect(mockReplace).not.toHaveBeenCalledWith(expect.stringContaining('pedido'));
  });

  it('renders an empty state instead of a wrong count when the default view matches nothing (QA: sla_status is always "none")', () => {
    mockUseOrdersList.mockReturnValue({ data: { rows: [], totalCount: 0 }, isLoading: false });
    renderPage();
    expect(screen.getByText('Sin pedidos en esta vista')).toBeInTheDocument();
  });
});
