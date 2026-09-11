import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ManifestsAvailabilityNotice } from './ManifestsAvailabilityNotice';

describe('ManifestsAvailabilityNotice', () => {
  // M4 — an ordinary initial load must NOT show the network-pause copy.
  // A skeleton is silent; it does not accuse the connection of anything.
  it('shows a silent skeleton for "loading", not the connection warning', () => {
    render(<ManifestsAvailabilityNotice availability="loading" />);
    expect(screen.queryByText(/revisa tu conexión/i)).toBeNull();
    expect(screen.getByRole('status')).toHaveAttribute('aria-busy', 'true');
  });

  it('shows the network-pause warning only for "unknown"', () => {
    render(<ManifestsAvailabilityNotice availability="unknown" />);
    expect(screen.getByText(/no pudimos comprobar/i)).toBeInTheDocument();
    expect(screen.getByText(/revisa tu conexión/i)).toBeInTheDocument();
  });

  it('shows a distinct error message with retry for "error", not the connection copy', async () => {
    const onRetry = vi.fn();
    render(<ManifestsAvailabilityNotice availability="error" onRetry={onRetry} />);
    expect(screen.queryByText(/revisa tu conexión/i)).toBeNull();
    expect(screen.getByText(/no pudimos cargar/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /reintentar/i }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('renders nothing for "known"', () => {
    const { container } = render(<ManifestsAvailabilityNotice availability="known" />);
    expect(container).toBeEmptyDOMElement();
  });
});
