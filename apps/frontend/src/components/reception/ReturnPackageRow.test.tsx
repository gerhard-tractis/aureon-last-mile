import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ReturnPackageRow } from './ReturnPackageRow';

const BASE = {
  label: 'PKG-001',
  orderNumber: 'ORD-001',
  returnReason: 'Cliente ausente',
  comuna: 'Ñuñoa',
};

describe('ReturnPackageRow', () => {
  it('received package shows the check icon and success styling', () => {
    render(<ReturnPackageRow {...BASE} received />);
    expect(screen.getByTestId('pkg-received')).toBeInTheDocument();
    expect(screen.queryByTestId('pkg-pending')).toBeNull();
  });

  it('paints the received chip with the spec-63 -chip token, not white on solid', () => {
    // White on --color-status-success measured 2.54:1 in light theme and
    // 1.74:1 in dark, under the 3:1 WCAG 1.4.11 needs for the glyph. The
    // check IS the second channel spec-54 encodes state with, so a washed-out
    // glyph collapses the pair back to colour alone.
    render(<ReturnPackageRow {...BASE} received />);
    const chip = screen.getByTestId('pkg-received');
    expect(chip.className).toContain('bg-status-success-chip');
    expect(chip.className).toContain('text-status-success-chip-fg');
    expect(chip.className).not.toContain('text-white');
  });

  it('pending package shows an empty box', () => {
    render(<ReturnPackageRow {...BASE} received={false} />);
    expect(screen.getByTestId('pkg-pending')).toBeInTheDocument();
  });

  it('renders label, order number, return reason and comuna', () => {
    render(<ReturnPackageRow {...BASE} received={false} />);
    expect(screen.getByText('PKG-001')).toBeInTheDocument();
    expect(screen.getByText('ORD-001')).toBeInTheDocument();
    expect(screen.getByText(/Cliente ausente/)).toBeInTheDocument();
    expect(screen.getByText(/Ñuñoa/)).toBeInTheDocument();
  });

  it('renders a fallback when order number is missing', () => {
    render(<ReturnPackageRow {...BASE} orderNumber={null} received={false} />);
    expect(screen.getByText('(orden desconocida)')).toBeInTheDocument();
  });

  it('renders a fallback when return reason is missing', () => {
    render(<ReturnPackageRow {...BASE} returnReason={null} received={false} />);
    expect(screen.getByText(/motivo no registrado/i)).toBeInTheDocument();
  });

  it('omits comuna entirely when the order has none, instead of a trailing separator', () => {
    render(<ReturnPackageRow {...BASE} comuna={null} received={false} />);
    const reasonLine = screen.getByTestId('pkg-reason-line');
    expect(reasonLine).toHaveTextContent('Cliente ausente');
    expect(reasonLine.textContent).not.toContain('·');
  });
});
