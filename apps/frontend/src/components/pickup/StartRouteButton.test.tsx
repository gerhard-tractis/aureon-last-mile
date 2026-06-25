import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { StartRouteButton } from './StartRouteButton';

describe('StartRouteButton', () => {
  it('opens dialog and calls onStart with trimmed label', () => {
    const onStart = vi.fn();
    render(<StartRouteButton onStart={onStart} />);

    fireEvent.click(screen.getByTestId('start-route-button'));
    const input = screen.getByLabelText(/Vehículo/i);
    fireEvent.change(input, { target: { value: '  AAA-111  ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Iniciar' }));

    expect(onStart).toHaveBeenCalledWith('AAA-111');
  });

  it('calls onStart with null when label empty', () => {
    const onStart = vi.fn();
    render(<StartRouteButton onStart={onStart} />);

    fireEvent.click(screen.getByTestId('start-route-button'));
    fireEvent.click(screen.getByRole('button', { name: 'Iniciar' }));

    expect(onStart).toHaveBeenCalledWith(null);
  });

  it('disables button when disabled prop set', () => {
    render(<StartRouteButton onStart={() => {}} disabled />);
    expect(screen.getByTestId('start-route-button')).toBeDisabled();
  });
});
