import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ManifestCard } from './ManifestCard';

describe('ManifestCard', () => {
  const defaultProps = {
    externalLoadId: 'CARGA-001',
    retailerName: 'Easy',
    orderCount: 10,
    packageCount: 25,
    onClick: vi.fn(),
  };

  it('renders retailer name and load id', () => {
    render(<ManifestCard {...defaultProps} />);
    expect(screen.getByText('Easy')).toBeInTheDocument();
    expect(screen.getByText('CARGA-001')).toBeInTheDocument();
  });

  it('renders order and package counts', () => {
    render(<ManifestCard {...defaultProps} />);
    expect(screen.getByText('10')).toBeInTheDocument();
    expect(screen.getByText('25')).toBeInTheDocument();
  });

  it('shows "Retailer desconocido" when retailerName is null', () => {
    render(<ManifestCard {...defaultProps} retailerName={null} />);
    expect(screen.getByText('Retailer desconocido')).toBeInTheDocument();
  });

  it('calls onClick when clicked', () => {
    const onClick = vi.fn();
    render(<ManifestCard {...defaultProps} onClick={onClick} />);
    fireEvent.click(screen.getByRole('button'));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('calls onClick on Enter key', () => {
    const onClick = vi.fn();
    render(<ManifestCard {...defaultProps} onClick={onClick} />);
    fireEvent.keyDown(screen.getByRole('button'), { key: 'Enter' });
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('shows completed date in Spanish when provided', () => {
    render(<ManifestCard {...defaultProps} completedAt="2026-03-10T12:00:00Z" />);
    expect(screen.getByText(/Completado el/)).toBeInTheDocument();
  });

  it('does not show completed date when not provided', () => {
    render(<ManifestCard {...defaultProps} />);
    expect(screen.queryByText(/Completado el/)).not.toBeInTheDocument();
  });

  it('removes interactive affordances when interactive=false', () => {
    render(<ManifestCard {...defaultProps} interactive={false} />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('is interactive by default', () => {
    render(<ManifestCard {...defaultProps} />);
    expect(screen.getByRole('button')).toBeInTheDocument();
  });
});
