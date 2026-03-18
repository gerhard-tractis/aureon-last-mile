import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ReceptionDetailList } from './ReceptionDetailList';

describe('ReceptionDetailList', () => {
  const mockPackages = [
    { id: 'pkg-1', label: 'CTN001', orderNumber: 'ORD-100', received: true },
    { id: 'pkg-2', label: 'CTN002', orderNumber: 'ORD-101', received: false },
    { id: 'pkg-3', label: 'CTN003', orderNumber: 'ORD-102', received: true },
  ];

  it('renders all packages', () => {
    render(<ReceptionDetailList packages={mockPackages} />);
    expect(screen.getByText('CTN001')).toBeInTheDocument();
    expect(screen.getByText('CTN002')).toBeInTheDocument();
    expect(screen.getByText('CTN003')).toBeInTheDocument();
  });

  it('shows order numbers', () => {
    render(<ReceptionDetailList packages={mockPackages} />);
    expect(screen.getByText('ORD-100')).toBeInTheDocument();
    expect(screen.getByText('ORD-101')).toBeInTheDocument();
  });

  it('shows "Recibido" for received packages', () => {
    render(<ReceptionDetailList packages={mockPackages} />);
    const received = screen.getAllByText('Recibido');
    expect(received).toHaveLength(2);
  });

  it('shows "Pendiente" for pending packages', () => {
    render(<ReceptionDetailList packages={mockPackages} />);
    const pending = screen.getAllByText('Pendiente');
    expect(pending).toHaveLength(1);
  });

  it('shows empty message when no packages', () => {
    render(<ReceptionDetailList packages={[]} />);
    expect(screen.getByText('No hay paquetes en esta carga')).toBeInTheDocument();
  });

  it('sorts received items to the top', () => {
    const items = [
      { id: 'pkg-a', label: 'AAA', orderNumber: 'ORD-1', received: false },
      { id: 'pkg-b', label: 'BBB', orderNumber: 'ORD-2', received: true },
    ];
    render(<ReceptionDetailList packages={items} />);
    const labels = screen.getAllByTestId('package-label');
    // Received first
    expect(labels[0].textContent).toBe('BBB');
    expect(labels[1].textContent).toBe('AAA');
  });
});
