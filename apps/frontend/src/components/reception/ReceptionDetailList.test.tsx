import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ReceptionDetailList } from './ReceptionDetailList';

describe('ReceptionDetailList', () => {
  const mockPackages = [
    { id: 'pkg-1', label: 'CTN001', orderNumber: 'ORD-100', received: true },
    { id: 'pkg-2', label: 'CTN002', orderNumber: 'ORD-101', received: false },
    { id: 'pkg-3', label: 'CTN003', orderNumber: 'ORD-102', received: true },
  ];

  it('renders all packages', () => {
    render(<ReceptionDetailList packages={mockPackages} onManualReceive={vi.fn()} />);
    expect(screen.getByText('CTN001')).toBeInTheDocument();
    expect(screen.getByText('CTN002')).toBeInTheDocument();
    expect(screen.getByText('CTN003')).toBeInTheDocument();
  });

  it('shows order numbers', () => {
    render(<ReceptionDetailList packages={mockPackages} onManualReceive={vi.fn()} />);
    expect(screen.getByText('ORD-100')).toBeInTheDocument();
    expect(screen.getByText('ORD-101')).toBeInTheDocument();
  });

  it('shows check icon for received packages', () => {
    render(<ReceptionDetailList packages={mockPackages} onManualReceive={vi.fn()} />);
    const icons = screen.getAllByTestId('received-icon');
    expect(icons).toHaveLength(2);
  });

  it('shows "Marcar Recibido" button for pending packages', () => {
    render(<ReceptionDetailList packages={mockPackages} onManualReceive={vi.fn()} />);
    const buttons = screen.getAllByRole('button', { name: /marcar recibido/i });
    expect(buttons).toHaveLength(1);
  });

  it('calls onManualReceive with package label when button clicked', async () => {
    const user = userEvent.setup();
    const onManualReceive = vi.fn();
    render(<ReceptionDetailList packages={mockPackages} onManualReceive={onManualReceive} />);
    const btn = screen.getByRole('button', { name: /marcar recibido/i });
    await user.click(btn);
    expect(onManualReceive).toHaveBeenCalledWith('CTN002');
  });

  it('shows empty message when no packages', () => {
    render(<ReceptionDetailList packages={[]} onManualReceive={vi.fn()} />);
    expect(screen.getByText('No hay paquetes en esta carga')).toBeInTheDocument();
  });

  it('sorts received items to the top', () => {
    const items = [
      { id: 'pkg-a', label: 'AAA', orderNumber: 'ORD-1', received: false },
      { id: 'pkg-b', label: 'BBB', orderNumber: 'ORD-2', received: true },
    ];
    render(<ReceptionDetailList packages={items} onManualReceive={vi.fn()} />);
    const labels = screen.getAllByTestId('package-label');
    // Received first
    expect(labels[0].textContent).toBe('BBB');
    expect(labels[1].textContent).toBe('AAA');
  });
});
