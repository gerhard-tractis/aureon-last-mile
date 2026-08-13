import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PrintPackageLabels } from './PrintPackageLabels';
import type { ManifestLabelRow } from '@/lib/pickup/manifest-label-types';

vi.mock('bwip-js/browser', () => ({
  default: {
    toSVG: () => '<svg data-testid="bwipjs-svg"></svg>',
  },
}));

const markPrintedMock = vi.fn().mockResolvedValue(undefined);
vi.mock('@/hooks/pickup/useMarkManifestLabelsPrinted', () => ({
  useMarkManifestLabelsPrinted: () => ({ mutateAsync: markPrintedMock }),
}));

function makeRow(overrides: Partial<ManifestLabelRow> = {}): ManifestLabelRow {
  return {
    package_id: 'pkg-1',
    package_label: 'CTN001',
    package_number: '1',
    declared_box_count: 1,
    sku_items: [],
    order_number: 'ORD-0001',
    customer_name: 'Juan Pérez',
    delivery_address: 'Av. Siempre Viva 742',
    comuna: 'Las Condes',
    customer_phone: '+56912345678',
    external_load_id: 'CARGA-001',
    retailer_name: 'Easy',
    ...overrides,
  };
}

describe('PrintPackageLabels', () => {
  let printSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    markPrintedMock.mockClear();
    printSpy = vi.fn();
    Object.defineProperty(window, 'print', { configurable: true, writable: true, value: printSpy });
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function flushFrames() {
    vi.advanceTimersByTime(120);
  }

  it('renders one label per package in the order received', () => {
    const rows = [
      makeRow({ package_id: 'pkg-1', package_label: 'CTN001' }),
      makeRow({ package_id: 'pkg-2', package_label: 'CTN002' }),
    ];
    const { container } = render(<PrintPackageLabels manifestId="m-1" labels={rows} />);
    const root = container.querySelector('.package-label-print-root');
    expect(root).not.toBeNull();
    expect(root!.querySelectorAll('.package-label')).toHaveLength(2);
    expect(screen.getByText('CTN001')).toBeInTheDocument();
    expect(screen.getByText('CTN002')).toBeInTheDocument();
  });

  it('calls window.print() exactly once', async () => {
    render(<PrintPackageLabels manifestId="m-1" labels={[makeRow()]} />);
    await flushFrames();
    expect(printSpy).toHaveBeenCalledTimes(1);
  });

  it('calls mark_manifest_labels_printed after dispatching print', async () => {
    render(<PrintPackageLabels manifestId="m-1" labels={[makeRow()]} />);
    await flushFrames();
    expect(markPrintedMock).toHaveBeenCalledWith({ manifestId: 'm-1' });
  });

  it('shows an empty state and skips printing + RPC when labels is empty', async () => {
    render(<PrintPackageLabels manifestId="m-1" labels={[]} />);
    await flushFrames();
    expect(screen.getByText(/no hay etiquetas para imprimir/i)).toBeInTheDocument();
    expect(printSpy).not.toHaveBeenCalled();
    expect(markPrintedMock).not.toHaveBeenCalled();
  });
});
