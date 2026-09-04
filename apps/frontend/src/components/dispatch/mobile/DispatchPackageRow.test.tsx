import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DispatchPackageRow } from './DispatchPackageRow';
import type { StopPackageRow } from '@/lib/dispatch/mobile/route-packages-by-stop';

const pkg: StopPackageRow = {
  packageId: 'p1',
  dispatchId: 'd1',
  orderId: 'o1',
  orderNumber: 'ORD-1',
  barcode: 'CL8841881',
  packageNumber: '1 de 2',
  clientName: 'Javiera Muñoz',
  loaded: true,
  loadedAtIso: '2026-09-03T14:00:00Z',
  notEmbarked: false,
};

describe('DispatchPackageRow', () => {
  it('spec-76 2h — renders barcode, order, package number and client', () => {
    render(<DispatchPackageRow pkg={pkg} onRemove={vi.fn()} />);
    expect(screen.getByText('CL8841881')).toBeInTheDocument();
    expect(screen.getByText(/ORD-1/)).toBeInTheDocument();
    expect(screen.getByText(/1 de 2/)).toBeInTheDocument();
    expect(screen.getByText(/Javiera Muñoz/)).toBeInTheDocument();
  });

  it('marks a retenido package NO EMBARCADO', () => {
    render(<DispatchPackageRow pkg={{ ...pkg, notEmbarked: true, loaded: false }} onRemove={vi.fn()} />);
    expect(screen.getByText('NO EMBARCADO')).toBeInTheDocument();
  });

  it('does not render NO EMBARCADO for a loaded package', () => {
    render(<DispatchPackageRow pkg={pkg} onRemove={vi.fn()} />);
    expect(screen.queryByText('NO EMBARCADO')).not.toBeInTheDocument();
  });

  it('spec-76 Lecciones aplicadas #4/#6 — Quitar is a native button, the row is not exposed as interactive itself', () => {
    render(<DispatchPackageRow pkg={pkg} onRemove={vi.fn()} />);
    const row = screen.getByTestId('dispatch-package-row-p1');
    expect(row.tagName).toBe('DIV');
    expect(row).not.toHaveAttribute('role');
    expect(row).not.toHaveAttribute('onclick');
    expect(screen.getByRole('button', { name: /quitar/i })).toBeInTheDocument();
  });

  it('spec-76 Lecciones aplicadas #6 — clicking Quitar calls onRemove exactly once', async () => {
    const user = userEvent.setup();
    const onRemove = vi.fn();
    render(<DispatchPackageRow pkg={pkg} onRemove={onRemove} />);
    await user.click(screen.getByRole('button', { name: /quitar/i }));
    expect(onRemove).toHaveBeenCalledTimes(1);
    expect(onRemove).toHaveBeenCalledWith(pkg);
  });

  it('omits a null package_number rather than rendering "· null"', () => {
    render(<DispatchPackageRow pkg={{ ...pkg, packageNumber: null }} onRemove={vi.fn()} />);
    expect(screen.queryByText(/null/)).not.toBeInTheDocument();
  });
});
