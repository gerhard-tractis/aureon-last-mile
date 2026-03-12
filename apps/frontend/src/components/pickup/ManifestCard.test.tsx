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

  it('shows "Unknown Retailer" when retailerName is null', () => {
    render(<ManifestCard {...defaultProps} retailerName={null} />);
    expect(screen.getByText('Unknown Retailer')).toBeInTheDocument();
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

  it('shows completed date when provided', () => {
    render(<ManifestCard {...defaultProps} completedAt="2026-03-10T12:00:00Z" />);
    expect(screen.getByText(/Completed/)).toBeInTheDocument();
  });

  it('does not show completed date when not provided', () => {
    render(<ManifestCard {...defaultProps} />);
    expect(screen.queryByText(/Completed/)).not.toBeInTheDocument();
  });
});
