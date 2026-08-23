import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
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

  it('header shows the real current-query total_count and a "Solo rutas activas" caption under RUTA', () => {
    renderPage();
    expect(screen.getByRole('heading', { name: 'Pedidos' })).toBeInTheDocument();
    expect(screen.getByText(/1 pedidos/)).toBeInTheDocument();
    expect(screen.getByText('Solo rutas activas')).toBeInTheDocument();
  });

  it('header never shows "0 pedidos" while the query is still loading (data undefined)', () => {
    mockUseOrdersList.mockReturnValue({ data: undefined, isLoading: true });
    renderPage();
    expect(screen.queryByText(/0 pedidos/)).not.toBeInTheDocument();
  });

  it('the header Exportar pagina exports every loaded row, not just the selection', async () => {
    // Two rows, only one selected — if the handler were wired to
    // selectedRows instead of the full loaded page, the CSV would be
    // missing ORD-002 entirely. Capturing the real Blob content (not just
    // "a click fired") is what actually catches that mistake.
    const secondRow: OrdersListRow = {
      ...SAMPLE_ROWS[0],
      id: 'ord-2',
      order_number: 'ORD-002',
      customer_name: 'Ripley',
    };
    mockUseOrdersList.mockReturnValue({
      data: { rows: [...SAMPLE_ROWS, secondRow], totalCount: 2 },
      isLoading: false,
    });
    if (!URL.createObjectURL) URL.createObjectURL = vi.fn(() => 'blob:mock-url');
    if (!URL.revokeObjectURL) URL.revokeObjectURL = vi.fn();
    const createObjectURLSpy = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock-url');
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    renderPage();
    // Select only ORD-001 — "independent of selection" is only actually
    // exercised once a selection exists that is NOT the full row set.
    fireEvent.click(screen.getByRole('checkbox', { name: /seleccionar ord-001/i }));
    fireEvent.click(screen.getByRole('button', { name: /exportar página/i }));

    expect(createObjectURLSpy).toHaveBeenCalledTimes(1);
    const blobArg = createObjectURLSpy.mock.calls[0][0] as Blob;
    const buffer = await blobArg.arrayBuffer();
    const text = new TextDecoder('utf-8').decode(buffer);
    expect(text).toContain('ORD-001');
    expect(text).toContain('ORD-002'); // not selected — proves the export isn't limited to the selection
    expect(clickSpy).toHaveBeenCalledTimes(1);

    createObjectURLSpy.mockRestore();
    clickSpy.mockRestore();
  });

  it('the header Guardar vista also copies window.location.href (same behaviour as the chips bar copy)', () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(window.navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: /guardar vista/i }));
    expect(writeText).toHaveBeenCalledWith(window.location.href);
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

  it('"Limpiar" clears all filters, keeps the preset id, and marks the clear explicit (filtros=0) so it survives being shared', () => {
    currentSearch = 'vista=en-reparto&estado=en_ruta&conductor=Juan';
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Limpiar' }));
    expect(mockReplace).toHaveBeenLastCalledWith('/app/orders?vista=en-reparto&filtros=0');
  });

  it('a shared cleared-view URL (filtros=0) does not silently re-apply the preset own implied filters', () => {
    // This is the exact bug the filtros=0 marker exists to prevent: without
    // it, a bare `?vista=en-reparto` and a deliberately-cleared
    // `?vista=en-reparto` are byte-identical, and the recipient of a shared
    // "cleared" link would see the preset's filters silently reapplied.
    currentSearch = 'vista=en-reparto&filtros=0';
    renderPage();
    expect(mockUseOrdersList).toHaveBeenCalledWith(
      'op-1',
      expect.objectContaining({ statuses: null }),
      0,
    );
    // Nothing should get rewritten either — the URL is already canonical.
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('removing a chip via ActiveFilterChips keeps the preset id and drops only that filter (page-level wiring, not just the rail)', () => {
    currentSearch = 'vista=en-reparto&estado=en_ruta&conductor=Juan';
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Quitar estado' }));
    expect(mockReplace).toHaveBeenLastCalledWith('/app/orders?vista=en-reparto&conductor=Juan');
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

  it('selecting a row surfaces it in OrdersBulkBar with a working, self-describing Exportar button', () => {
    renderPage();
    fireEvent.click(screen.getByRole('checkbox', { name: /seleccionar ord-001/i }));
    // Exact name — the bulk bar's own label now names its scope and count too,
    // and the header's "Exportar página (N)" also matches a loose /exportar/i.
    const exportButton = screen.getByRole('button', { name: 'Exportar seleccionados (1)' });
    expect(exportButton).toBeInTheDocument();
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

  it('clamps an out-of-range pagina (a stale shared link) to the last valid page once totalCount is known', () => {
    // Only 1 result exists, so pagina=999 is unreachable — the RPC returns
    // zero rows for that offset while still reporting the real totalCount.
    currentSearch = 'vista=en-reparto&estado=en_ruta&pagina=999';
    mockUseOrdersList.mockReturnValue({ data: { rows: [], totalCount: 1 }, isLoading: false });
    renderPage();
    expect(mockReplace).toHaveBeenCalledWith('/app/orders?vista=en-reparto&estado=en_ruta');
  });

  it('does not touch the URL when pagina is already within range', () => {
    currentSearch = 'vista=en-reparto&estado=en_ruta&pagina=1';
    mockUseOrdersList.mockReturnValue({ data: { rows: SAMPLE_ROWS, totalCount: 60 }, isLoading: false });
    renderPage();
    expect(mockReplace).not.toHaveBeenCalled();
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
