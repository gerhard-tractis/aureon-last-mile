import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QRHandoff } from './QRHandoff';

// Mock qrcode.react to avoid canvas rendering in tests
vi.mock('qrcode.react', () => ({
  QRCodeSVG: ({ value, ...props }: { value: string; [key: string]: unknown }) => (
    <svg data-testid="qr-code" data-value={value} {...props} />
  ),
}));

describe('QRHandoff', () => {
  const defaultProps = {
    qrPayload: 'manifest-uuid-123',
    retailerName: 'Easy',
    packageCount: 25,
    onDismiss: vi.fn(),
  };

  it('renders the QR code with manifest UUID', () => {
    render(<QRHandoff {...defaultProps} />);
    const qr = screen.getByTestId('qr-code');
    expect(qr).toBeInTheDocument();
    expect(qr).toHaveAttribute('data-value', 'manifest-uuid-123');
  });

  it('displays the retailer name', () => {
    render(<QRHandoff {...defaultProps} />);
    // Retailer name appears in the subtitle (e.g., "Easy — Carga de Easy")
    const subtitle = screen.getByText(/Carga de Easy/);
    expect(subtitle).toBeInTheDocument();
  });

  it('displays the package count', () => {
    render(<QRHandoff {...defaultProps} />);
    expect(screen.getByText(/25/)).toBeInTheDocument();
    expect(screen.getByText(/paquetes/i)).toBeInTheDocument();
  });

  it('shows "Volver" dismiss button', () => {
    render(<QRHandoff {...defaultProps} />);
    expect(screen.getByRole('button', { name: /volver/i })).toBeInTheDocument();
  });

  it('calls onDismiss when "Volver" is clicked', () => {
    const onDismiss = vi.fn();
    render(<QRHandoff {...defaultProps} onDismiss={onDismiss} />);
    fireEvent.click(screen.getByRole('button', { name: /volver/i }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('shows instructional text for the receiver', () => {
    render(<QRHandoff {...defaultProps} />);
    expect(
      screen.getByText(/muestre este código/i)
    ).toBeInTheDocument();
  });

  it('renders with unknown retailer gracefully', () => {
    render(<QRHandoff {...defaultProps} retailerName={null} />);
    // When retailerName is null, "Carga" appears in header & label
    const matches = screen.getAllByText(/carga/i);
    expect(matches.length).toBeGreaterThan(0);
  });

  it('renders full-screen layout', () => {
    const { container } = render(<QRHandoff {...defaultProps} />);
    const wrapper = container.firstElementChild;
    expect(wrapper?.className).toContain('min-h-screen');
  });
});
