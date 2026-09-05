import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DispatchTabletActionBar } from './DispatchTabletActionBar';

const refocusPackageFieldMock = vi.fn();
vi.mock('@/lib/scan/refocus-package-field', () => ({
  refocusPackageField: () => refocusPackageFieldMock(),
}));

const baseProps = {
  packagesLoaded: 148,
  canDispatch: false,
  dispatchDisabledReason: 'Disponible cuando la ruta esté cerrada',
  dispatching: false,
  dispatchError: null,
  onDispatch: vi.fn(),
};

describe('DispatchTabletActionBar', () => {
  it('renders Cerrar ruta always disabled, with its reason as visible text (never title= only)', () => {
    render(<DispatchTabletActionBar {...baseProps} />);
    const closeButton = screen.getByRole('button', { name: 'Cerrar ruta' });
    expect(closeButton).toBeDisabled();
    expect(screen.getByText('El cierre de ruta es la próxima pantalla — spec-77')).toBeInTheDocument();
  });

  it('renders Despachar disabled with its reason when canDispatch is false', () => {
    render(<DispatchTabletActionBar {...baseProps} />);
    expect(screen.getByRole('button', { name: /Despachar a DispatchTrack/ })).toBeDisabled();
    expect(screen.getByText('Disponible cuando la ruta esté cerrada')).toBeInTheDocument();
  });

  it('opens a full confirmation dialog before calling onDispatch — decision 3, never a one-tap action', async () => {
    const onDispatch = vi.fn();
    render(<DispatchTabletActionBar {...baseProps} canDispatch dispatchDisabledReason={null} onDispatch={onDispatch} />);

    await userEvent.click(screen.getByRole('button', { name: /Despachar a DispatchTrack/ }));
    expect(screen.getByText('Confirmar despacho')).toBeInTheDocument();
    expect(screen.getByText(/Se enviará la ruta con 148 paquetes/)).toBeInTheDocument();
    expect(onDispatch).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: 'Despachar' }));
    expect(onDispatch).toHaveBeenCalledTimes(1);
  });

  it('shows "Despachando…" and disables the trigger while a dispatch is in flight', () => {
    render(<DispatchTabletActionBar {...baseProps} canDispatch dispatching />);
    const button = screen.getByRole('button', { name: 'Despachando…' });
    expect(button).toBeDisabled();
  });

  it('shows a dispatch error when present', () => {
    render(
      <DispatchTabletActionBar
        {...baseProps}
        dispatchError={{
          text: 'Error de DispatchTrack',
          whatChanged: '',
          primaryAction: 'retry',
          primaryLabel: 'Reintentar',
          showChecklist: false,
          retryable: true,
        }}
      />,
    );
    expect(screen.getByText('Error de DispatchTrack')).toBeInTheDocument();
  });

  it('review I2 — re-arms the scan field after cancelling the confirmation, so the next gun trigger-pull is not silently dropped', async () => {
    refocusPackageFieldMock.mockClear();
    render(<DispatchTabletActionBar {...baseProps} canDispatch dispatchDisabledReason={null} />);

    await userEvent.click(screen.getByRole('button', { name: /Despachar a DispatchTrack/ }));
    expect(refocusPackageFieldMock).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(refocusPackageFieldMock).toHaveBeenCalledTimes(1);
  });

  it('the disabled reasons are wired via aria-describedby, not visible text alone', () => {
    render(<DispatchTabletActionBar {...baseProps} />);
    const closeButton = screen.getByRole('button', { name: 'Cerrar ruta' });
    const dispatchButton = screen.getByRole('button', { name: /Despachar a DispatchTrack/ });
    expect(closeButton.getAttribute('aria-describedby')).toBeTruthy();
    expect(dispatchButton.getAttribute('aria-describedby')).toBeTruthy();
  });
});
