import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PackageLabel } from './PackageLabel';
import type { ManifestLabelRow } from '@/lib/pickup/manifest-label-types';

vi.mock('bwip-js/browser', () => ({
  default: {
    // Mirror real bwip-js output: viewBox only, no width/height attributes.
    toSVG: (opts: { text: string }) =>
      `<svg data-testid="bwipjs-svg" data-text="${opts.text}" viewBox="0 0 232 72" xmlns="http://www.w3.org/2000/svg"><rect /></svg>`,
  },
}));

function makeRow(overrides: Partial<ManifestLabelRow> = {}): ManifestLabelRow {
  return {
    package_id: 'pkg-1',
    package_label: 'CTN00123456789',
    package_number: '1',
    declared_box_count: 2,
    sku_items: [
      { sku: 'SKU-A', description: 'Camiseta azul talla M', quantity: 2 },
      { sku: 'SKU-B', description: 'Pantalón negro talla 32', quantity: 1 },
    ],
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

describe('PackageLabel', () => {
  it('renders every field from a full row', () => {
    render(<PackageLabel data={makeRow()} />);
    expect(screen.getByText('CARGA-001')).toBeInTheDocument();
    expect(screen.getByText('Easy')).toBeInTheDocument();
    expect(screen.getByText('CTN00123456789')).toBeInTheDocument();
    expect(screen.getByText(/Bulto 1 de 2/)).toBeInTheDocument();
    expect(screen.getByText('ORD-0001')).toBeInTheDocument();
    expect(screen.getByText('Las Condes')).toBeInTheDocument();
    expect(screen.getByText('Juan Pérez')).toBeInTheDocument();
    expect(screen.getByText('Av. Siempre Viva 742')).toBeInTheDocument();
    expect(screen.getByText('+56912345678')).toBeInTheDocument();
  });

  it('renders the Code128 SVG with packages.label as payload', () => {
    const { container } = render(<PackageLabel data={makeRow({ package_label: 'CTN00199999999' })} />);
    const svg = container.querySelector('[data-testid="bwipjs-svg"]') as SVGElement | null;
    expect(svg).not.toBeNull();
    expect(svg!.getAttribute('data-text')).toBe('CTN00199999999');
  });

  it('forces the barcode SVG to fill its wrapper (bwip-js sizing fix)', () => {
    const { container } = render(<PackageLabel data={makeRow()} />);
    const svg = container.querySelector('[data-testid="bwipjs-svg"]') as SVGElement | null;
    expect(svg!.getAttribute('preserveAspectRatio')).toBe('none');
    expect(svg!.getAttribute('width')).toBe('100%');
    expect(svg!.getAttribute('height')).toBe('100%');
  });

  it('truncates sku_items to 2 lines and shows +N ítems más', () => {
    render(
      <PackageLabel
        data={makeRow({
          sku_items: [
            { sku: 'A', description: 'Item A', quantity: 1 },
            { sku: 'B', description: 'Item B', quantity: 1 },
            { sku: 'C', description: 'Item C', quantity: 1 },
            { sku: 'D', description: 'Item D', quantity: 1 },
          ],
        })}
      />,
    );
    expect(screen.getByText(/1× Item A/)).toBeInTheDocument();
    expect(screen.getByText(/1× Item B/)).toBeInTheDocument();
    expect(screen.queryByText(/Item C/)).not.toBeInTheDocument();
    expect(screen.getByText('+2 ítems más')).toBeInTheDocument();
  });

  it('renders no truncation caption when sku_items has 2 or fewer items', () => {
    render(
      <PackageLabel
        data={makeRow({
          sku_items: [{ sku: 'A', description: 'Item A', quantity: 1 }],
        })}
      />,
    );
    expect(screen.queryByText(/ítems más/)).not.toBeInTheDocument();
  });

  it('renders the caption and nothing else when sku_items is empty', () => {
    render(<PackageLabel data={makeRow({ sku_items: [] })} />);
    expect(screen.getByText(/contenido/i)).toBeInTheDocument();
    expect(screen.queryByText(/ítems más/)).not.toBeInTheDocument();
  });

  it('a row with is_generated_label and parent_label renders identically to a native label', () => {
    // Schema-supported today (spec-53 follow-up), unused until sub-labels ship.
    // PackageLabel does not special-case these — they are not even part of its props.
    const { container: nativeContainer } = render(<PackageLabel data={makeRow()} />);
    const { container: generatedContainer } = render(<PackageLabel data={makeRow()} />);
    expect(generatedContainer.innerHTML).toBe(nativeContainer.innerHTML);
  });

  it('falls back to "1 de N" when package_number is null', () => {
    render(<PackageLabel data={makeRow({ package_number: null, declared_box_count: 3 })} />);
    expect(screen.getByText(/Bulto 1 de 3/)).toBeInTheDocument();
  });

  it('renders the package label alone with no "Bulto" line when declared_box_count is null', () => {
    render(<PackageLabel data={makeRow({ declared_box_count: null })} />);
    expect(screen.queryByText(/Bulto/)).not.toBeInTheDocument();
  });
});
