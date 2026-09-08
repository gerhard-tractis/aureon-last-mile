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

  // spec-82 fase 1 (mock 5c) — the mock's literal copy is "Cerrar ruta",
  // with no "y entregar". Only `data-testid="close-route-button"` guarded
  // this button before, so the earlier "Cerrar ruta y entregar" copy could
  // regress without any test noticing.
  it('reads "Cerrar ruta", not "Cerrar ruta y entregar"', () => {
    render(<CloseRouteButton totalVerified={1} onClose={() => {}} />);
    expect(screen.getByRole('button', { name: 'Cerrar ruta' })).toBeInTheDocument();
  });
});
