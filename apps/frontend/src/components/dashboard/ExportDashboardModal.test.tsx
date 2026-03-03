import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import ExportDashboardModal from './ExportDashboardModal';
import * as exportUtils from '@/lib/utils/exportDashboard';

// Mock sonner
const mockToastSuccess = vi.fn();
const mockToastError = vi.fn();
vi.mock('sonner', () => ({
  toast: {
    success: (...args: unknown[]) => mockToastSuccess(...args),
    error: (...args: unknown[]) => mockToastError(...args),
  },
}));

// Mock supabase client
const mockInsert = vi.fn().mockResolvedValue({});
vi.mock('@/lib/supabase/client', () => ({
  createSPAClient: () => ({
    from: () => ({ insert: mockInsert }),
    rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
    auth: {
      getSession: vi.fn().mockResolvedValue({
        data: { session: { user: { app_metadata: { claims: { operator_id: 'op1', role: 'admin' } } } } },
      }),
    },
  }),
}));

// Mock the hooks module to control export data
const mockExportData = {
  sla: { value: 95.5, prevValue: 93.0, totalOrders: 100, deliveredOrders: 95 },
  primary: {
    fadrValue: 88.5,
    fadrPrev: 85.0,
    fadrFirstAttempt: 88,
    fadrTotal: 100,
    claimsCount: 5,
    claimsAmount: 50000,
    claimsPrevCount: 8,
    claimsPrevAmount: 75000,
    avgDeliveryTime: 45.2,
    prevAvgDeliveryTime: 48.1,
  },
  customers: [
    {
      retailer_name: 'Acme Corp',
      total_orders: 50,
      delivered_orders: 48,
      first_attempt_deliveries: 45,
      failed_deliveries: 2,
      sla_pct: 96.0,
      fadr_pct: 90.0,
    },
  ],
  failures: [{ reason: 'Dirección incorrecta', count: 10, percentage: 40.0 }],
  secondary: {
    capacityPct: 15.5,
    capacityTarget: 1000,
    ordersPerHour: 10.2,
    totalOrders: 100,
    totalDelivered: 95,
    daysInPeriod: 7,
    operationalHours: 10,
  },
  prevSecondary: null,
};

vi.mock('@/hooks/useDashboardMetrics', () => ({
  useExportData: () => ({
    data: mockExportData,
    isLoading: false,
    isError: false,
  }),
}));

function createWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

describe('ExportDashboardModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  it('renders modal with all form controls when open', () => {
    render(
      <ExportDashboardModal open={true} onOpenChange={vi.fn()} operatorId="op1" />,
      { wrapper: createWrapper() }
    );

    expect(screen.getByText('Exportar Dashboard')).toBeInTheDocument();
    expect(screen.getByText('Formato')).toBeInTheDocument();
    expect(screen.getByDisplayValue('csv')).toBeInTheDocument();
    expect(screen.getByDisplayValue('pdf')).toBeInTheDocument();
    expect(screen.getByText('Rango de Fechas')).toBeInTheDocument();
    expect(screen.getByText('Resumen SLA')).toBeInTheDocument();
    expect(screen.getByText('Métricas Primarias')).toBeInTheDocument();
    expect(screen.getByText('Tabla de Clientes')).toBeInTheDocument();
    expect(screen.getByText('Análisis de Fallos')).toBeInTheDocument();
    expect(screen.getByText('Métricas Secundarias')).toBeInTheDocument();
    expect(screen.getByText('Nombre del archivo')).toBeInTheDocument();
    expect(screen.getByText('Exportar')).toBeInTheDocument();
    expect(screen.getByText('Cancelar')).toBeInTheDocument();
  });

  it('does not render when closed', () => {
    render(
      <ExportDashboardModal open={false} onOpenChange={vi.fn()} operatorId="op1" />,
      { wrapper: createWrapper() }
    );
    expect(screen.queryByText('Exportar Dashboard')).not.toBeInTheDocument();
  });

  it('CSV radio is selected by default', () => {
    render(
      <ExportDashboardModal open={true} onOpenChange={vi.fn()} operatorId="op1" />,
      { wrapper: createWrapper() }
    );
    const csvRadio = screen.getByDisplayValue('csv') as HTMLInputElement;
    expect(csvRadio.checked).toBe(true);
  });

  it('all section checkboxes checked by default', () => {
    render(
      <ExportDashboardModal open={true} onOpenChange={vi.fn()} operatorId="op1" />,
      { wrapper: createWrapper() }
    );
    const checkboxes = screen.getAllByRole('checkbox');
    expect(checkboxes).toHaveLength(5);
    checkboxes.forEach(cb => expect(cb).toBeChecked());
  });

  it('can toggle section checkboxes', () => {
    render(
      <ExportDashboardModal open={true} onOpenChange={vi.fn()} operatorId="op1" />,
      { wrapper: createWrapper() }
    );
    const slaCheckbox = screen.getAllByRole('checkbox')[0];
    fireEvent.click(slaCheckbox);
    expect(slaCheckbox).not.toBeChecked();
    fireEvent.click(slaCheckbox);
    expect(slaCheckbox).toBeChecked();
  });

  it('triggers CSV export and shows success toast', async () => {
    const downloadSpy = vi.spyOn(exportUtils, 'downloadCSV').mockImplementation(() => {});
    const generateCSVSpy = vi.spyOn(exportUtils, 'generateCSV').mockReturnValue('csv content');
    const onOpenChange = vi.fn();

    render(
      <ExportDashboardModal open={true} onOpenChange={onOpenChange} operatorId="op1" />,
      { wrapper: createWrapper() }
    );

    fireEvent.click(screen.getByText('Exportar'));

    await waitFor(() => {
      expect(generateCSVSpy).toHaveBeenCalled();
      expect(downloadSpy).toHaveBeenCalled();
      expect(mockToastSuccess).toHaveBeenCalledWith(expect.stringContaining('Reporte descargado'));
    });

    downloadSpy.mockRestore();
    generateCSVSpy.mockRestore();
  });

  it('triggers PDF export and calls generatePDF', async () => {
    const pdfSpy = vi.spyOn(exportUtils, 'generatePDF').mockImplementation(() => {});
    const onOpenChange = vi.fn();

    render(
      <ExportDashboardModal open={true} onOpenChange={onOpenChange} operatorId="op1" />,
      { wrapper: createWrapper() }
    );

    // Switch to PDF
    fireEvent.click(screen.getByDisplayValue('pdf'));
    fireEvent.click(screen.getByText('Exportar'));

    await waitFor(() => {
      expect(pdfSpy).toHaveBeenCalled();
      expect(mockToastSuccess).toHaveBeenCalled();
    });

    pdfSpy.mockRestore();
  });

  it('falls back to CSV when PDF generation fails', async () => {
    const pdfSpy = vi.spyOn(exportUtils, 'generatePDF').mockImplementation(() => {
      throw new Error('PDF error');
    });
    const downloadSpy = vi.spyOn(exportUtils, 'downloadCSV').mockImplementation(() => {});
    const generateCSVSpy = vi.spyOn(exportUtils, 'generateCSV').mockReturnValue('csv fallback');

    render(
      <ExportDashboardModal open={true} onOpenChange={vi.fn()} operatorId="op1" />,
      { wrapper: createWrapper() }
    );

    fireEvent.click(screen.getByDisplayValue('pdf'));
    fireEvent.click(screen.getByText('Exportar'));

    await waitFor(() => {
      expect(mockToastError).toHaveBeenCalledWith('Error generando PDF. Descargando CSV.');
      expect(downloadSpy).toHaveBeenCalled();
    });

    pdfSpy.mockRestore();
    downloadSpy.mockRestore();
    generateCSVSpy.mockRestore();
  });

  it('fires audit log on successful export', async () => {
    vi.spyOn(exportUtils, 'downloadCSV').mockImplementation(() => {});
    vi.spyOn(exportUtils, 'generateCSV').mockReturnValue('csv');

    render(
      <ExportDashboardModal open={true} onOpenChange={vi.fn()} operatorId="op1" />,
      { wrapper: createWrapper() }
    );

    fireEvent.click(screen.getByText('Exportar'));

    await waitFor(() => {
      expect(mockInsert).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'EXPORT_DASHBOARD',
          resource_type: 'report',
        })
      );
    });
  });

  it('cancel button closes modal', () => {
    const onOpenChange = vi.fn();
    render(
      <ExportDashboardModal open={true} onOpenChange={onOpenChange} operatorId="op1" />,
      { wrapper: createWrapper() }
    );

    fireEvent.click(screen.getByText('Cancelar'));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});

// CSV generation tests
describe('generateCSV', () => {
  const sampleData: exportUtils.DashboardExportPayload = {
    sla: { value: 95.5, prevValue: 93.0, totalOrders: 100, deliveredOrders: 95 },
    primary: {
      fadrValue: 88.5,
      fadrPrev: 85.0,
      fadrFirstAttempt: 88,
      fadrTotal: 100,
      claimsCount: 5,
      claimsAmount: 50000,
      claimsPrevCount: 8,
      claimsPrevAmount: 75000,
      avgDeliveryTime: 45.2,
      prevAvgDeliveryTime: 48.1,
    },
    customers: [
      {
        retailer_name: 'Acme, Inc.',
        total_orders: 50,
        delivered_orders: 48,
        first_attempt_deliveries: 45,
        failed_deliveries: 2,
        sla_pct: 96.0,
        fadr_pct: 90.0,
      },
    ],
    failures: [{ reason: 'Dirección incorrecta', count: 10, percentage: 40.0 }],
    secondary: {
      capacityPct: 15.5,
      capacityTarget: 1000,
      ordersPerHour: 10.2,
      totalOrders: 100,
      totalDelivered: 95,
      daysInPeriod: 7,
      operationalHours: 10,
    },
    prevSecondary: null,
  };

  const allSections: exportUtils.ExportSections = {
    sla: true,
    primary: true,
    customers: true,
    failures: true,
    secondary: true,
  };

  it('generates CSV with all sections', () => {
    const csv = exportUtils.generateCSV(sampleData, allSections, 'Últimos 30 días');
    expect(csv).toContain('Resumen SLA');
    expect(csv).toContain('Métricas Primarias');
    expect(csv).toContain('Tabla de Clientes');
    expect(csv).toContain('Análisis de Fallos');
    expect(csv).toContain('Métricas Secundarias');
  });

  it('escapes fields with commas', () => {
    const csv = exportUtils.generateCSV(sampleData, allSections, 'test');
    // "Acme, Inc." should be escaped
    expect(csv).toContain('"Acme, Inc."');
  });

  it('respects section toggles', () => {
    const csv = exportUtils.generateCSV(
      sampleData,
      { sla: true, primary: false, customers: false, failures: false, secondary: false },
      'test'
    );
    expect(csv).toContain('Resumen SLA');
    expect(csv).not.toContain('Métricas Primarias');
    expect(csv).not.toContain('Tabla de Clientes');
  });

  it('shows empty message when no customers', () => {
    const emptyData = { ...sampleData, customers: [] };
    const csv = exportUtils.generateCSV(
      emptyData,
      { sla: false, primary: false, customers: true, failures: false, secondary: false },
      'test'
    );
    expect(csv).toContain('Sin datos para este período');
  });

  it('shows empty message when no failures', () => {
    const emptyData = { ...sampleData, failures: [] };
    const csv = exportUtils.generateCSV(
      emptyData,
      { sla: false, primary: false, customers: false, failures: true, secondary: false },
      'test'
    );
    expect(csv).toContain('Sin datos para este período');
  });

  it('shows empty message when no secondary data', () => {
    const emptyData = { ...sampleData, secondary: null };
    const csv = exportUtils.generateCSV(
      emptyData,
      { sla: false, primary: false, customers: false, failures: false, secondary: true },
      'test'
    );
    expect(csv).toContain('Sin datos para este período');
  });
});

// PDF generation tests
describe('generatePDF', () => {
  it('does not throw when generating PDF with all sections', () => {
    const data: exportUtils.DashboardExportPayload = {
      sla: { value: 95.0, prevValue: 93.0, totalOrders: 100, deliveredOrders: 95 },
      primary: {
        fadrValue: 88.0, fadrPrev: 85.0, fadrFirstAttempt: 88, fadrTotal: 100,
        claimsCount: 5, claimsAmount: 50000, claimsPrevCount: 8, claimsPrevAmount: 75000,
        avgDeliveryTime: 45.0, prevAvgDeliveryTime: 48.0,
      },
      customers: [
        {
          retailer_name: 'Test Corp',
          total_orders: 50,
          delivered_orders: 48,
          first_attempt_deliveries: 45,
          failed_deliveries: 2,
          sla_pct: 96.0,
          fadr_pct: 90.0,
        },
      ],
      failures: [{ reason: 'Test reason', count: 5, percentage: 25.0 }],
      secondary: {
        capacityPct: 15.5,
        capacityTarget: 1000,
        ordersPerHour: 10.2,
        totalOrders: 100,
        totalDelivered: 95,
        daysInPeriod: 7,
        operationalHours: 10,
      },
      prevSecondary: null,
    };

    // generatePDF calls doc.save() which triggers a download in real browser.
    // In jsdom it won't actually download, but it should not throw.
    expect(() => {
      exportUtils.generatePDF(
        data,
        { sla: true, primary: true, customers: true, failures: true, secondary: true },
        'Últimos 30 días',
        'test-report'
      );
    }).not.toThrow();
  });

  it('handles empty data sections without throwing', () => {
    const data: exportUtils.DashboardExportPayload = {
      sla: { value: null, prevValue: null, totalOrders: 0, deliveredOrders: 0 },
      primary: {
        fadrValue: null, fadrPrev: null, fadrFirstAttempt: 0, fadrTotal: 0,
        claimsCount: 0, claimsAmount: 0, claimsPrevCount: 0, claimsPrevAmount: 0,
        avgDeliveryTime: null, prevAvgDeliveryTime: null,
      },
      customers: [],
      failures: [],
      secondary: null,
      prevSecondary: null,
    };

    expect(() => {
      exportUtils.generatePDF(
        data,
        { sla: true, primary: true, customers: true, failures: true, secondary: true },
        'Últimos 7 días',
        'empty-report'
      );
    }).not.toThrow();
  });
});
