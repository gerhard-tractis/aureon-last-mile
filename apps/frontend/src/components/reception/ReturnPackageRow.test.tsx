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
