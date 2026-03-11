import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ScanResultPopup } from './ScanResultPopup';

describe('ScanResultPopup', () => {
  it('renders when visible', () => {
    render(<ScanResultPopup visible={true} onDismiss={vi.fn()} />);
    expect(screen.getByText('Package Not Included')).toBeInTheDocument();
  });

  it('does not render when not visible', () => {
    render(<ScanResultPopup visible={false} onDismiss={vi.fn()} />);
    expect(
      screen.queryByText('Package Not Included')
    ).not.toBeInTheDocument();
  });

  it('calls onDismiss when clicked', () => {
    const onDismiss = vi.fn();
    render(<ScanResultPopup visible={true} onDismiss={onDismiss} />);
    fireEvent.click(screen.getByRole('alert'));
    expect(onDismiss).toHaveBeenCalled();
  });

  it('has alert role for accessibility', () => {
    render(<ScanResultPopup visible={true} onDismiss={vi.fn()} />);
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });
});
