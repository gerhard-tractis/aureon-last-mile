import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ReceptionCard } from './ReceptionCard';

describe('ReceptionCard', () => {
  const defaultProps = {
    retailerName: 'Easy',
    packageCount: 25,
    completedAt: '2026-03-18T10:00:00Z',
    receptionStatus: 'awaiting_reception' as const,
    onClick: vi.fn(),
  };

  it('renders retailer name', () => {
    render(<ReceptionCard {...defaultProps} />);
    expect(screen.getByText('Easy')).toBeInTheDocument();
  });

  it('renders package count', () => {
    render(<ReceptionCard {...defaultProps} />);
    expect(screen.getByText(/25/)).toBeInTheDocument();
  });

  it('shows "Retailer desconocido" when retailerName is null', () => {
    render(<ReceptionCard {...defaultProps} retailerName={null} />);
    expect(screen.getByText('Retailer desconocido')).toBeInTheDocument();
  });

  it('calls onClick when clicked', () => {
    const onClick = vi.fn();
    render(<ReceptionCard {...defaultProps} onClick={onClick} />);
    fireEvent.click(screen.getByRole('button'));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('calls onClick on Enter key', () => {
    const onClick = vi.fn();
    render(<ReceptionCard {...defaultProps} onClick={onClick} />);
    fireEvent.keyDown(screen.getByRole('button'), { key: 'Enter' });
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('shows progress for in-progress receptions', () => {
    render(
      <ReceptionCard
        {...defaultProps}
        receptionStatus="reception_in_progress"
        receivedCount={15}
        expectedCount={25}
      />
    );
    expect(screen.getByText('15 / 25 recibidos')).toBeInTheDocument();
  });

  it('shows "Pendiente" badge for awaiting reception', () => {
    render(<ReceptionCard {...defaultProps} />);
    expect(screen.getByText('Pendiente')).toBeInTheDocument();
  });

  it('shows "En curso" badge for in-progress reception', () => {
    render(
      <ReceptionCard
        {...defaultProps}
        receptionStatus="reception_in_progress"
        receivedCount={10}
        expectedCount={25}
      />
    );
    expect(screen.getByText('En curso')).toBeInTheDocument();
  });

  it('renders pickup completion time', () => {
    render(<ReceptionCard {...defaultProps} />);
    // completedAt is rendered as a localized date/time
    expect(screen.getByText(/Retiro completado/)).toBeInTheDocument();
  });

  it('shows driver name when provided', () => {
    render(<ReceptionCard {...defaultProps} driverName="Carlos López" />);
    expect(screen.getByText(/Carlos López/)).toBeInTheDocument();
  });

  it('shows manifest id when provided', () => {
    render(<ReceptionCard {...defaultProps} manifestId="CARGA-001" />);
    expect(screen.getByText('CARGA-001')).toBeInTheDocument();
  });

  it('shows pickup location when provided', () => {
    render(<ReceptionCard {...defaultProps} pickupLocation="CD Easy Maipú" />);
    expect(screen.getByText('CD Easy Maipú')).toBeInTheDocument();
  });

  it('shows departure time when provided', () => {
    render(<ReceptionCard {...defaultProps} departedAt="2026-03-25T14:30:00Z" />);
    expect(screen.getByText(/Salió a las/)).toBeInTheDocument();
  });

  it('renders non-interactive when interactive is false', () => {
    render(<ReceptionCard {...defaultProps} interactive={false} />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('shows hint text when interactive is false', () => {
    render(<ReceptionCard {...defaultProps} interactive={false} />);
    expect(screen.getByText(/Escanee QR para iniciar/)).toBeInTheDocument();
  });
});
