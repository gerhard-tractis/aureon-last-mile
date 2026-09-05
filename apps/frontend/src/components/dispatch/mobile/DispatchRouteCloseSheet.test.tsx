import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { RoutePackage } from '@/lib/dispatch/types';

vi.mock('@/hooks/dispatch/mobile/useSealRoute', () => ({
  useSealRoute: vi.fn(),
}));

import { useSealRoute } from '@/hooks/dispatch/mobile/useSealRoute';
import { DispatchRouteCloseSheet } from './DispatchRouteCloseSheet';

function pkg(overrides: Partial<RoutePackage>): RoutePackage {
  return {
    dispatch_id: 'd1',
    order_id: 'o1',
    order_number: 'ORD-1',
    contact_name: 'Juan',
    contact_address: 'Calle 1',
    contact_phone: null,
    status: 'pending',
    stage: 'staged',
    boxesTotal: 1,
    boxesLoaded: 1,
    ...overrides,
  };
}

function mockSeal(overrides: Partial<ReturnType<typeof useSealRoute>> = {}) {
  const seal = vi.fn().mockResolvedValue({ ok: true, sealedStops: 148, ordersClosed: 60 });
  (useSealRoute as ReturnType<typeof vi.fn>).mockReturnValue({ seal, isSealing: false, ...overrides });
  return seal;
}

beforeEach(() => {
  vi.resetAllMocks();
});

const BASE_PROPS = {
  open: true,
  onOpenChange: vi.fn(),
  routeId: 'route-1',
  routeCode: 'RUT-0001',
  loadPositionLabel: 'A3',
  packagesLoaded: 148,
  onSealed: vi.fn(),
};

describe('DispatchRouteCloseSheet', () => {
  it('names all three consequences from decision 2 — item 4', () => {
    mockSeal();
    const missingPackages = [
      pkg({ order_id: 'o1', order_number: 'ORD-1', boxesTotal: 2, boxesLoaded: 1 }),
    ];
    render(<DispatchRouteCloseSheet {...BASE_PROPS} packages={missingPackages} />);

    expect(screen.getByText(/se quedan en el andén A3/i)).toBeInTheDocument();
    expect(screen.getByText(/148 cargados pasan a listo para despacho/i)).toBeInTheDocument();
    expect(screen.getAllByText(/no se puede volver a abrir/i).length).toBeGreaterThan(0);
  });

  it('"Seguir escaneando" is the primary action and closes the sheet — item 5', async () => {
    mockSeal();
    const onOpenChange = vi.fn();
    render(
      <DispatchRouteCloseSheet
        {...BASE_PROPS}
        onOpenChange={onOpenChange}
        packages={[pkg({ boxesTotal: 2, boxesLoaded: 1 })]}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Seguir escaneando' }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('the close button names the exact missing figure — item 5', () => {
    mockSeal();
    render(
      <DispatchRouteCloseSheet
        {...BASE_PROPS}
        packages={[
          pkg({ order_id: 'o1', boxesTotal: 3, boxesLoaded: 1 }),
          pkg({ order_id: 'o2', boxesTotal: 1, boxesLoaded: 0 }),
        ]}
      />,
    );
    expect(screen.getByRole('button', { name: 'Cerrar con 3 sin cargar' })).toBeInTheDocument();
  });

  it('paginates the missing list with "Ver los N restantes" — item 6', async () => {
    mockSeal();
    const packages = Array.from({ length: 24 }, (_, i) =>
      pkg({ order_id: `o${i}`, order_number: `ORD-${i}`, boxesTotal: 1, boxesLoaded: 0 }),
    );
    render(<DispatchRouteCloseSheet {...BASE_PROPS} packages={packages} />);

    expect(screen.getAllByTestId('close-sheet-missing-row')).toHaveLength(4);
    const showMore = screen.getByRole('button', { name: 'Ver los 20 restantes' });
    await userEvent.click(showMore);
    expect(screen.getAllByTestId('close-sheet-missing-row')).toHaveLength(24);
  });

  it('close is disabled until a reason is chosen, then forces with it — item 7/8 setup', async () => {
    const seal = mockSeal();
    const onSealed = vi.fn();
    const onOpenChange = vi.fn();
    render(
      <DispatchRouteCloseSheet
        {...BASE_PROPS}
        onOpenChange={onOpenChange}
        onSealed={onSealed}
        packages={[pkg({ order_id: 'o1', order_number: 'ORD-1', boxesTotal: 2, boxesLoaded: 1 })]}
      />,
    );

    const closeButton = screen.getByRole('button', { name: 'Cerrar con 1 sin cargar' });
    expect(closeButton).toBeDisabled();

    await userEvent.click(screen.getByRole('radio', { name: 'Terminó el turno' }));
    expect(closeButton).not.toBeDisabled();

    await userEvent.click(closeButton);
    await waitFor(() => expect(seal).toHaveBeenCalled());
    expect(seal).toHaveBeenCalledWith('route-1', {
      force: true,
      reason_code: 'turno_terminado',
      note: undefined,
    });
    expect(onSealed).toHaveBeenCalledWith({ sealedStops: 148, ordersClosed: 60 });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('"otro" requires a non-empty note before the close button enables', async () => {
    mockSeal();
    render(
      <DispatchRouteCloseSheet
        {...BASE_PROPS}
        packages={[pkg({ order_id: 'o1', order_number: 'ORD-1', boxesTotal: 2, boxesLoaded: 1 })]}
      />,
    );
    const closeButton = screen.getByRole('button', { name: 'Cerrar con 1 sin cargar' });

    await userEvent.click(screen.getByRole('radio', { name: 'Otro motivo' }));
    expect(closeButton).toBeDisabled();

    await userEvent.type(screen.getByLabelText('Detalle del motivo'), 'Se cayó del pallet');
    expect(closeButton).not.toBeDisabled();
  });

  it('a per-row note is optional and its absence never blocks the close — item 7', async () => {
    const seal = mockSeal();
    render(
      <DispatchRouteCloseSheet
        {...BASE_PROPS}
        packages={[pkg({ order_id: 'o1', order_number: 'ORD-1', boxesTotal: 2, boxesLoaded: 1 })]}
      />,
    );
    await userEvent.click(screen.getByRole('radio', { name: 'No se ubicó el paquete' }));
    const closeButton = screen.getByRole('button', { name: 'Cerrar con 1 sin cargar' });
    expect(closeButton).not.toBeDisabled();
    await userEvent.click(closeButton);
    await waitFor(() => expect(seal).toHaveBeenCalled());
    expect(seal.mock.calls[0][1].note).toBeUndefined();
  });

  it('a typed per-row note reaches the seal call folded into note — item 7', async () => {
    const seal = mockSeal();
    render(
      <DispatchRouteCloseSheet
        {...BASE_PROPS}
        packages={[pkg({ order_id: 'o1', order_number: 'ORD-1', boxesTotal: 2, boxesLoaded: 1 })]}
      />,
    );
    await userEvent.click(screen.getByRole('radio', { name: 'No se ubicó el paquete' }));
    await userEvent.type(screen.getByLabelText('Nota para ORD-1'), 'Bajo otro pallet');
    await userEvent.click(screen.getByRole('button', { name: 'Cerrar con 1 sin cargar' }));
    await waitFor(() => expect(seal).toHaveBeenCalled());
    expect(seal.mock.calls[0][1].note).toBe('ORD-1: Bajo otro pallet');
  });

  it('shows a server refusal instead of closing the sheet', async () => {
    const seal = vi.fn().mockResolvedValue({ code: 'FORCE_REASON_REQUIRED', message: 'Se requiere un motivo', ok: false });
    (useSealRoute as ReturnType<typeof vi.fn>).mockReturnValue({ seal, isSealing: false });
    const onOpenChange = vi.fn();
    render(
      <DispatchRouteCloseSheet
        {...BASE_PROPS}
        onOpenChange={onOpenChange}
        packages={[pkg({ order_id: 'o1', order_number: 'ORD-1', boxesTotal: 2, boxesLoaded: 1 })]}
      />,
    );
    await userEvent.click(screen.getByRole('radio', { name: 'Terminó el turno' }));
    await userEvent.click(screen.getByRole('button', { name: 'Cerrar con 1 sin cargar' }));
    await waitFor(() => expect(screen.getByText('Se requiere un motivo')).toBeInTheDocument());
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });
});
