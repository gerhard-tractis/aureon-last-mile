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

  it('shows the in-progress badge when verifiedCount > 0', () => {
    render(<ManifestCard {...defaultProps} verifiedCount={3} packageCount={10} />);
    const badge = screen.getByTestId('in-progress-badge');
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveTextContent('En progreso · 3/10');
  });

  it('hides the in-progress badge when verifiedCount is 0 or omitted', () => {
    const { rerender } = render(<ManifestCard {...defaultProps} verifiedCount={0} />);
    expect(screen.queryByTestId('in-progress-badge')).not.toBeInTheDocument();
    rerender(<ManifestCard {...defaultProps} />);
    expect(screen.queryByTestId('in-progress-badge')).not.toBeInTheDocument();
  });

  it('hides the in-progress badge on in-transit cards (Pickup confirmado wins)', () => {
    render(<ManifestCard {...defaultProps} verifiedCount={5} inTransit />);
    expect(screen.queryByTestId('in-progress-badge')).not.toBeInTheDocument();
    expect(screen.getByText('Pickup confirmado')).toBeInTheDocument();
  });

  describe('spec-53 label printing', () => {
    it('hides the print button when the module is disabled', () => {
      render(<ManifestCard {...defaultProps} labelsEnabled={false} manifestId="m-1" />);
      expect(screen.queryByText(/imprimir etiquetas/i)).not.toBeInTheDocument();
    });

    it('hides the print button when no manifest row exists yet', () => {
      render(<ManifestCard {...defaultProps} labelsEnabled manifestId={null} />);
      expect(screen.queryByText(/imprimir etiquetas/i)).not.toBeInTheDocument();
    });

    it('reads "Imprimir etiquetas" when labelsPrintedAt is null', () => {
      render(<ManifestCard {...defaultProps} labelsEnabled manifestId="m-1" labelsPrintedAt={null} />);
      expect(screen.getByText('Imprimir etiquetas')).toBeInTheDocument();
    });

    it('calls onPrintLabels directly (no confirm) on first print', () => {
      const onPrintLabels = vi.fn();
      render(
        <ManifestCard
          {...defaultProps}
          labelsEnabled
          manifestId="m-1"
          labelsPrintedAt={null}
          onPrintLabels={onPrintLabels}
        />,
      );
      fireEvent.click(screen.getByText('Imprimir etiquetas'));
      expect(onPrintLabels).toHaveBeenCalledTimes(1);
    });

    it('reads "Reimprimir etiquetas" and opens a confirm dialog showing the previous print date and user', () => {
      render(
        <ManifestCard
          {...defaultProps}
          labelsEnabled
          manifestId="m-1"
          labelsPrintedAt="2026-08-13T08:41:00Z"
          labelsPrintedByName="Gerhard"
        />,
      );
      expect(screen.getByText('Reimprimir etiquetas')).toBeInTheDocument();
      fireEvent.click(screen.getByText('Reimprimir etiquetas'));
      const description = screen.getByText(/Última impresión/);
      expect(description).toHaveTextContent('Gerhard');
    });

    it('calls onPrintLabels only after confirming the reprint dialog', () => {
      const onPrintLabels = vi.fn();
      render(
        <ManifestCard
          {...defaultProps}
          labelsEnabled
          manifestId="m-1"
          labelsPrintedAt="2026-08-13T08:41:00Z"
          labelsPrintedByName="Gerhard"
          onPrintLabels={onPrintLabels}
        />,
      );
      fireEvent.click(screen.getByText('Reimprimir etiquetas'));
      expect(onPrintLabels).not.toHaveBeenCalled();
      fireEvent.click(screen.getByText('Reimprimir'));
      expect(onPrintLabels).toHaveBeenCalledTimes(1);
    });
  });
});
