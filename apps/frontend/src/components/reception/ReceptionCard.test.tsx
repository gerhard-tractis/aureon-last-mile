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

  it('shows "En progreso" badge for in-progress reception', () => {
    render(
      <ReceptionCard
        {...defaultProps}
        receptionStatus="reception_in_progress"
        receivedCount={10}
        expectedCount={25}
      />
    );
    expect(screen.getByText('En progreso')).toBeInTheDocument();
  });

  it('renders pickup completion time', () => {
    render(<ReceptionCard {...defaultProps} />);
    // completedAt is rendered as a localized date/time
    expect(screen.getByText(/Retiro completado/)).toBeInTheDocument();
  });
});
