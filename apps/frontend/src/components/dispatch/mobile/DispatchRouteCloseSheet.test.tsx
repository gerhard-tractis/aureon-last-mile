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
    stage: 'planned',
    boxesTotal: 1,
    boxesLoaded: 0,
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
  packagesLoaded: 60,
  onSealed: vi.fn(),
};

describe('DispatchRouteCloseSheet', () => {
  // H1 (adversarial review) — mutation-verified against three specific
  // failures the old test let through: printing `packagesLoaded` instead of
  // `totalMissingBoxes`, deleting the "no se puede volver a abrir" line
  // entirely (satisfied only by `SheetDescription`), and hardcoding the
  // loaded figure. `24` and `60` are deliberately distinct so a swap
  // between them is visible, and each consequence is asserted against its
  // OWN exact `<li>`, scoped past `SheetDescription`, rather than a
  // substring search across the whole sheet.
  it('names all three consequences from decision 2, each in its own line — item 4', () => {
    mockSeal();
    const missingPackages = Array.from({ length: 24 }, (_, i) =>
      pkg({ order_id: `o${i}`, order_number: `ORD-${i}`, stage: 'planned', boxesTotal: 1, boxesLoaded: 0 }),
    );
    render(<DispatchRouteCloseSheet {...BASE_PROPS} packages={missingPackages} />);

    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(3);
    expect(items[0]).toHaveTextContent(
      'Los 24 paquetes se quedan en el andén A3 y hay que meterlos en otra ruta.',
    );
    expect(items[1]).toHaveTextContent('Los 60 cargados pasan a listo para despacho.');
    expect(items[2]).toHaveTextContent('La ruta no se puede volver a abrir.');
  });

  // MEDIUM (adversarial review) — a single missing box must read
  // grammatically, never "Los 1 paquetes".
  it('the missing-boxes line is singular for exactly one box', () => {
    mockSeal();
    render(
      <DispatchRouteCloseSheet
        {...BASE_PROPS}
        packages={[pkg({ order_id: 'o1', stage: 'planned', boxesTotal: 1, boxesLoaded: 0 })]}
      />,
    );
    const items = screen.getAllByRole('listitem');
    expect(items[0]).toHaveTextContent('El paquete se queda en el andén A3 y hay que meterlo en otra ruta.');
  });

  // MEDIUM — `loadPositionLabel` absent must never duplicate "el andén".
  it('never doubles "el andén" when the route has no load position', () => {
    mockSeal();
    render(
      <DispatchRouteCloseSheet
        {...BASE_PROPS}
        loadPositionLabel={null}
        packages={[pkg({ order_id: 'o1', stage: 'planned', boxesTotal: 1, boxesLoaded: 0 })]}
      />,
    );
    const items = screen.getAllByRole('listitem');
    expect(items[0]).not.toHaveTextContent(/andén el andén/);
    expect(items[0]).toHaveTextContent('El paquete se queda en el andén y hay que meterlo en otra ruta.');
  });

  it('"Seguir escaneando" is the primary action and closes the sheet — item 5', async () => {
    mockSeal();
    const onOpenChange = vi.fn();
    render(
      <DispatchRouteCloseSheet
        {...BASE_PROPS}
        onOpenChange={onOpenChange}
        packages={[pkg({ stage: 'planned', boxesTotal: 1, boxesLoaded: 0 })]}
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
          pkg({ order_id: 'o1', stage: 'planned', boxesTotal: 3, boxesLoaded: 1 }),
          pkg({ order_id: 'o2', stage: 'planned', boxesTotal: 1, boxesLoaded: 0 }),
        ]}
      />,
    );
    expect(screen.getByRole('button', { name: 'Cerrar con 3 sin cargar' })).toBeInTheDocument();
  });

  it('paginates the missing list with "Ver los N restantes" — item 6', async () => {
    mockSeal();
    const packages = Array.from({ length: 24 }, (_, i) =>
      pkg({ order_id: `o${i}`, order_number: `ORD-${i}`, stage: 'planned', boxesTotal: 1, boxesLoaded: 0 }),
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
        packages={[pkg({ order_id: 'o1', order_number: 'ORD-1', stage: 'planned', boxesTotal: 2, boxesLoaded: 1 })]}
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
    expect(onSealed).toHaveBeenCalledWith({
      sealedStops: 148,
      ordersClosed: 60,
      packagesLeftAtDock: 0,
      splitOrdersCount: 0,
    });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('spec-77 Fase 4 item 16 — a forced close reports what the seal actually released/split, not an inferred count', async () => {
    const seal = vi.fn().mockResolvedValue({
      ok: true,
      sealedStops: 148,
      ordersClosed: 60,
      forced: {
        reason_code: 'turno_terminado',
        released_count: 20,
        split_count: 4,
        split_order_ids: ['o5', 'o6'],
      },
    });
    (useSealRoute as ReturnType<typeof vi.fn>).mockReturnValue({ seal, isSealing: false });
    const onSealed = vi.fn();
    render(
      <DispatchRouteCloseSheet
        {...BASE_PROPS}
        onSealed={onSealed}
        packages={[pkg({ order_id: 'o1', order_number: 'ORD-1', stage: 'planned', boxesTotal: 2, boxesLoaded: 1 })]}
      />,
    );

    await userEvent.click(screen.getByRole('radio', { name: 'Terminó el turno' }));
    await userEvent.click(screen.getByRole('button', { name: 'Cerrar con 1 sin cargar' }));
    await waitFor(() => expect(seal).toHaveBeenCalled());
    expect(onSealed).toHaveBeenCalledWith({
      sealedStops: 148,
      ordersClosed: 60,
      packagesLeftAtDock: 24,
      splitOrdersCount: 2,
    });
  });

  // MEDIUM (adversarial review) — the close button being disabled must have
  // a visible reason, not `title=` only (no hover on a touchscreen); the
  // convention `close-route-copy.ts`/`DispatchTabletActionBar` already set.
  it('the disabled close button shows why, as visible text — MEDIUM', async () => {
    mockSeal();
    render(
      <DispatchRouteCloseSheet
        {...BASE_PROPS}
        packages={[pkg({ order_id: 'o1', order_number: 'ORD-1', stage: 'planned', boxesTotal: 2, boxesLoaded: 1 })]}
      />,
    );
    const closeButton = screen.getByRole('button', { name: 'Cerrar con 1 sin cargar' });
    expect(closeButton).not.toHaveAttribute('title');
    const reasonId = closeButton.getAttribute('aria-describedby');
    expect(reasonId).toBeTruthy();
    expect(document.getElementById(reasonId!)).toHaveTextContent(/motivo/i);

    await userEvent.click(screen.getByRole('radio', { name: 'Otro motivo' }));
    const stillDisabledReasonId = closeButton.getAttribute('aria-describedby');
    expect(stillDisabledReasonId).toBeTruthy();
    expect(document.getElementById(stillDisabledReasonId!)).toHaveTextContent(/detalle/i);
  });

  it('"otro" requires a non-empty note before the close button enables', async () => {
    mockSeal();
    render(
      <DispatchRouteCloseSheet
        {...BASE_PROPS}
        packages={[pkg({ order_id: 'o1', order_number: 'ORD-1', stage: 'planned', boxesTotal: 2, boxesLoaded: 1 })]}
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
        packages={[pkg({ order_id: 'o1', order_number: 'ORD-1', stage: 'planned', boxesTotal: 2, boxesLoaded: 1 })]}
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
        packages={[pkg({ order_id: 'o1', order_number: 'ORD-1', stage: 'planned', boxesTotal: 2, boxesLoaded: 1 })]}
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
        packages={[pkg({ order_id: 'o1', order_number: 'ORD-1', stage: 'planned', boxesTotal: 2, boxesLoaded: 1 })]}
      />,
    );
    await userEvent.click(screen.getByRole('radio', { name: 'Terminó el turno' }));
    await userEvent.click(screen.getByRole('button', { name: 'Cerrar con 1 sin cargar' }));
    await waitFor(() => expect(screen.getByText('Se requiere un motivo')).toBeInTheDocument());
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });

  // LOW (adversarial review, WAI-ARIA radiogroup pattern) — roving
  // tabindex + arrow-key navigation, not five independently-tabbable radios.
  describe('reason picker keyboard navigation', () => {
    it('only one reason is tab-stoppable at a time, and arrow keys move + select', async () => {
      mockSeal();
      const user = userEvent.setup();
      render(
        <DispatchRouteCloseSheet
          {...BASE_PROPS}
          packages={[pkg({ order_id: 'o1', stage: 'planned', boxesTotal: 1, boxesLoaded: 0 })]}
        />,
      );
      const radios = screen.getAllByRole('radio');
      // Nothing selected yet: the first radio is the roving tab stop.
      expect(radios[0]).toHaveAttribute('tabIndex', '0');
      radios.slice(1).forEach((r) => expect(r).toHaveAttribute('tabIndex', '-1'));

      radios[0].focus();
      await user.keyboard('{ArrowDown}');
      expect(radios[1]).toHaveFocus();
      expect(radios[1]).toHaveAttribute('aria-checked', 'true');
      expect(radios[1]).toHaveAttribute('tabIndex', '0');
      expect(radios[0]).toHaveAttribute('tabIndex', '-1');

      await user.keyboard('{ArrowUp}');
      expect(radios[0]).toHaveFocus();
      expect(radios[0]).toHaveAttribute('aria-checked', 'true');
    });
  });
});
