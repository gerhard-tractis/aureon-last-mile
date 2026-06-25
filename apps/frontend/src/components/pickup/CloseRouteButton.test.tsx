import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CloseRouteButton } from './CloseRouteButton';

describe('CloseRouteButton', () => {
  it('is disabled when totalVerified is 0', () => {
    render(<CloseRouteButton totalVerified={0} onClose={() => {}} />);
    expect(screen.getByTestId('close-route-button')).toBeDisabled();
  });

  it('is enabled when totalVerified > 0', () => {
    render(<CloseRouteButton totalVerified={3} onClose={() => {}} />);
    expect(screen.getByTestId('close-route-button')).not.toBeDisabled();
  });

  it('fires onClose when clicked', () => {
    const onClose = vi.fn();
    render(<CloseRouteButton totalVerified={1} onClose={onClose} />);
    fireEvent.click(screen.getByTestId('close-route-button'));
    expect(onClose).toHaveBeenCalled();
  });

  it('shows spinner when submitting', () => {
    const { container } = render(
      <CloseRouteButton totalVerified={1} isSubmitting onClose={() => {}} />
    );
    expect(container.querySelector('.animate-spin')).not.toBeNull();
    expect(screen.getByTestId('close-route-button')).toBeDisabled();
  });
});
