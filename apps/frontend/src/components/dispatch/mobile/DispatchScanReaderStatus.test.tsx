import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DispatchScanReaderStatus } from './DispatchScanReaderStatus';

describe('DispatchScanReaderStatus', () => {
  it('defaults to the pre-existing "md" size (2e, unchanged)', () => {
    render(<DispatchScanReaderStatus armed={true} />);
    expect(screen.getByText(/LISTO/)).toHaveClass('text-[11px]');
  });

  it('spec-78 review — "lg" renders larger text for the tablet (decision 4, "información de primera clase")', () => {
    render(<DispatchScanReaderStatus armed={true} size="lg" />);
    expect(screen.getByText(/LISTO/)).toHaveClass('text-[15px]');
  });

  it('shows the unarmed prompt regardless of size', () => {
    render(<DispatchScanReaderStatus armed={false} size="lg" />);
    expect(screen.getByText(/TOCA PARA REACTIVAR/)).toBeInTheDocument();
  });
});
