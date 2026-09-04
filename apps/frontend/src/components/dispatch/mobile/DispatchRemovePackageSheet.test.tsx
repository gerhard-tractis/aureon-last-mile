import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DispatchRemovePackageSheet } from './DispatchRemovePackageSheet';
import type { StopPackageRow } from '@/lib/dispatch/mobile/route-packages-by-stop';

const target: StopPackageRow = {
  packageId: 'p1',
  dispatchId: 'd1',
  orderId: 'o1',
  orderNumber: 'ORD-1',
  barcode: 'CL8841881',
  packageNumber: '1 de 2',
  clientName: 'Javiera Muñoz',
  loaded: true,
  loadedAtIso: '2026-09-03T14:00:00Z',
  notEmbarked: false,
};

describe('DispatchRemovePackageSheet', () => {
  it('is closed when target is null', () => {
    render(
      <DispatchRemovePackageSheet target={null} onOpenChange={vi.fn()} onConfirm={vi.fn()} isPending={false} errorMessage={null} />,
    );
    expect(screen.queryByText(/quitar pedido/i)).not.toBeInTheDocument();
  });

  it('spec-76 decision 7 corrected — names the real behaviour: whole order, sectorizado, audit-logged', () => {
    render(
      <DispatchRemovePackageSheet target={target} onOpenChange={vi.fn()} onConfirm={vi.fn()} isPending={false} errorMessage={null} />,
    );
    expect(screen.getByText(/se quitará todo el pedido ord-1 de la ruta/i)).toBeInTheDocument();
    expect(screen.getByText(/sectorizado/)).toBeInTheDocument();
    expect(screen.getByText(/queda registrado quién lo quitó y cuándo/i)).toBeInTheDocument();
  });

  it('requires a non-empty reason before confirming', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(
      <DispatchRemovePackageSheet target={target} onOpenChange={vi.fn()} onConfirm={onConfirm} isPending={false} errorMessage={null} />,
    );
    expect(screen.getByRole('button', { name: /quitar pedido/i })).toBeDisabled();
    await user.type(screen.getByLabelText('Motivo para quitar el pedido'), 'Paquete dañado');
    expect(screen.getByRole('button', { name: /quitar pedido/i })).not.toBeDisabled();
    await user.click(screen.getByRole('button', { name: /quitar pedido/i }));
    expect(onConfirm).toHaveBeenCalledWith('Paquete dañado');
  });

  it('shows the server error message when removal fails (e.g. manager-only 403)', () => {
    render(
      <DispatchRemovePackageSheet
        target={target}
        onOpenChange={vi.fn()}
        onConfirm={vi.fn()}
        isPending={false}
        errorMessage="Solo un responsable puede quitar paradas de la planificación."
      />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent(/solo un responsable/i);
  });

  it('disables the confirm button while pending', () => {
    render(
      <DispatchRemovePackageSheet target={target} onOpenChange={vi.fn()} onConfirm={vi.fn()} isPending errorMessage={null} />,
    );
    expect(screen.getByRole('button', { name: /quitando/i })).toBeDisabled();
  });
});
