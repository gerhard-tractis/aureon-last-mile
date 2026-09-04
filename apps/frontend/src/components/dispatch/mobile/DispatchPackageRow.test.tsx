import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
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
    render(<DispatchPackageRow pkg={pkg} />);
    expect(screen.getByText('CL8841881')).toBeInTheDocument();
    expect(screen.getByText(/ORD-1/)).toBeInTheDocument();
    expect(screen.getByText(/1 de 2/)).toBeInTheDocument();
    expect(screen.getByText(/Javiera Muñoz/)).toBeInTheDocument();
  });

  it('marks a retenido package NO EMBARCADO', () => {
    render(<DispatchPackageRow pkg={{ ...pkg, notEmbarked: true, loaded: false }} />);
    expect(screen.getByText('NO EMBARCADO')).toBeInTheDocument();
  });

  it('does not render NO EMBARCADO for a loaded package', () => {
    render(<DispatchPackageRow pkg={pkg} />);
    expect(screen.queryByText('NO EMBARCADO')).not.toBeInTheDocument();
  });

  it('spec-76 review — no remove control on the crew path (removal is a manager-only planning action, see RouteBuilder)', () => {
    render(<DispatchPackageRow pkg={pkg} />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('omits a null package_number rather than rendering "· null"', () => {
    render(<DispatchPackageRow pkg={{ ...pkg, packageNumber: null }} />);
    expect(screen.queryByText(/null/)).not.toBeInTheDocument();
  });
});
