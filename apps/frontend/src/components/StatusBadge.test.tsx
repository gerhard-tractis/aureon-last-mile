import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StatusBadge, getStatusLabel } from './StatusBadge';

describe('StatusBadge', () => {
  it('renders the correct label for delivered status', () => {
    render(<StatusBadge status="delivered" />);
    expect(screen.getByText('Entregado')).toBeInTheDocument();
  });

  it('renders the correct label for in_transit status', () => {
    render(<StatusBadge status="in_transit" />);
    expect(screen.getByText('En Ruta')).toBeInTheDocument();
  });

  it('renders the correct label for failed status', () => {
    render(<StatusBadge status="failed" />);
    expect(screen.getByText('Fallido')).toBeInTheDocument();
  });

  it('renders the correct label for picked_up status', () => {
    render(<StatusBadge status="picked_up" />);
    expect(screen.getByText('Recogido')).toBeInTheDocument();
  });

  it('renders the correct label for pending status', () => {
    render(<StatusBadge status="pending" />);
    expect(screen.getByText('Pendiente')).toBeInTheDocument();
  });

  it('renders the correct label for returned status', () => {
    render(<StatusBadge status="returned" />);
    expect(screen.getByText('Devuelto')).toBeInTheDocument();
  });

  it('applies success variant classes for delivered', () => {
    const { container } = render(<StatusBadge status="delivered" />);
    const badge = container.firstChild as HTMLElement;
    expect(badge.className).toContain('bg-status-success-bg');
    expect(badge.className).toContain('text-status-success');
  });

  it('applies error variant classes for failed', () => {
    const { container } = render(<StatusBadge status="failed" />);
    const badge = container.firstChild as HTMLElement;
    expect(badge.className).toContain('bg-status-error-bg');
    expect(badge.className).toContain('text-status-error');
  });

  it('allows custom variant override', () => {
    const { container } = render(<StatusBadge status="pending" variant="warning" />);
    const badge = container.firstChild as HTMLElement;
    expect(badge.className).toContain('bg-status-warning-bg');
  });

  it('renders sm size with smaller text', () => {
    const { container } = render(<StatusBadge status="delivered" size="sm" />);
    const badge = container.firstChild as HTMLElement;
    expect(badge.className).toContain('text-[10px]');
  });

  it('renders unknown status with neutral styling', () => {
    render(<StatusBadge status="some_custom_status" />);
    expect(screen.getByText('some_custom_status')).toBeInTheDocument();
  });

  it('renders spec-65 order_status_enum values in Spanish (Pedidos leading_status)', () => {
    render(<StatusBadge status="en_ruta" />);
    expect(screen.getByText('En reparto')).toBeInTheDocument();
  });

  it('renders entregado (order enum) as "Entregada" with the success variant', () => {
    const { container } = render(<StatusBadge status="entregado" />);
    expect(screen.getByText('Entregada')).toBeInTheDocument();
    const badge = container.firstChild as HTMLElement;
    expect(badge.className).toContain('bg-status-success-bg');
  });

  it('renders every order_status_enum value with a non-raw Spanish label', () => {
    const enumValues = [
      'ingresado', 'verificado', 'en_bodega', 'asignado', 'en_carga',
      'listo_para_despacho', 'en_ruta', 'entregado', 'cancelado',
      'en_retorno', 'parcialmente_entregado',
    ];
    for (const status of enumValues) {
      const { unmount } = render(<StatusBadge status={status} />);
      expect(screen.queryByText(status)).not.toBeInTheDocument();
      unmount();
    }
  });
});

describe('getStatusLabel', () => {
  it('returns the Spanish label for a known order_status_enum value', () => {
    expect(getStatusLabel('en_ruta')).toBe('En reparto');
  });

  it('returns the raw string for an unknown status, never a placeholder', () => {
    expect(getStatusLabel('some_future_status')).toBe('some_future_status');
  });

  it('defaults to the order vocabulary — "entregado" is feminine ("Entregada")', () => {
    expect(getStatusLabel('entregado')).toBe('Entregada');
  });

  it('resolves the package vocabulary when kind="package" — "entregado" is masculine ("Entregado")', () => {
    expect(getStatusLabel('entregado', 'package')).toBe('Entregado');
  });
});

describe('StatusBadge kind="order" vs kind="package" — two grammatically distinct vocabularies sharing one component', () => {
  it('defaults to kind="order" when omitted, unchanged from before the package vocabulary existed', () => {
    render(<StatusBadge status="entregado" />);
    expect(screen.getByText('Entregada')).toBeInTheDocument();
  });

  it('renders "entregado" as "Entregada" (feminine, la orden) under kind="order"', () => {
    render(<StatusBadge status="entregado" kind="order" />);
    expect(screen.getByText('Entregada')).toBeInTheDocument();
  });

  it('renders "entregado" as "Entregado" (masculine, el paquete) under kind="package" — same enum value, different grammar', () => {
    render(<StatusBadge status="entregado" kind="package" />);
    expect(screen.getByText('Entregado')).toBeInTheDocument();
  });

  it('renders "cancelado" as "Cancelada" for kind="order" and "Cancelado" for kind="package"', () => {
    const { unmount } = render(<StatusBadge status="cancelado" kind="order" />);
    expect(screen.getByText('Cancelada')).toBeInTheDocument();
    unmount();
    render(<StatusBadge status="cancelado" kind="package" />);
    expect(screen.getByText('Cancelado')).toBeInTheDocument();
  });

  it('covers every package_status_enum value with a non-raw Spanish label under kind="package", including the six values order_status_enum does not have', () => {
    const packageOnlyValues = ['sectorizado', 'retenido', 'retorno_hub', 'devuelto', 'dañado', 'extraviado'];
    for (const status of packageOnlyValues) {
      const { unmount } = render(<StatusBadge status={status} kind="package" />);
      expect(screen.queryByText(status)).not.toBeInTheDocument();
      unmount();
    }
  });

  it('a package-only value falls back to the raw string under kind="order" — the two vocabularies do not share entries', () => {
    render(<StatusBadge status="retenido" kind="order" />);
    expect(screen.getByText('retenido')).toBeInTheDocument();
  });

  it('resolves "pending" (the PackageStatusBreakdown null-status fallback) under kind="package"', () => {
    render(<StatusBadge status="pending" kind="package" />);
    expect(screen.getByText('Pendiente')).toBeInTheDocument();
  });
});

describe('StatusBadge kind="dispatch" — dispatches.status / dispatch_status_enum, a third vocabulary', () => {
  it('covers every dispatch_status_enum value with a non-raw Spanish label, including "partial"', () => {
    const values = ['pending', 'delivered', 'failed', 'partial'];
    for (const status of values) {
      const { unmount } = render(<StatusBadge status={status} kind="dispatch" />);
      expect(screen.queryByText(status)).not.toBeInTheDocument();
      unmount();
    }
  });

  it('renders "partial" as "Parcial" with the warning variant — a value neither order nor package vocabulary has', () => {
    const { container } = render(<StatusBadge status="partial" kind="dispatch" />);
    expect(screen.getByText('Parcial')).toBeInTheDocument();
    const badge = container.firstChild as HTMLElement;
    expect(badge.className).toContain('bg-status-warning-bg');
  });

  it('renders "delivered" as "Entregado" under kind="dispatch", distinct from "package"\'s config entry', () => {
    render(<StatusBadge status="delivered" kind="dispatch" />);
    expect(screen.getByText('Entregado')).toBeInTheDocument();
  });
});

describe('StatusBadge label override', () => {
  it('an explicit label prop wins over both the config lookup and the raw-status fallback', () => {
    render(<StatusBadge status="draft" label="Borrador" variant="neutral" />);
    expect(screen.getByText('Borrador')).toBeInTheDocument();
    expect(screen.queryByText('draft')).not.toBeInTheDocument();
  });
});
