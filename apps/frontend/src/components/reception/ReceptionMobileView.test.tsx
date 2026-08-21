import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { IncomingRoute } from '@/hooks/reception/useIncomingRoutes';
import type { OpenDiscrepancy } from '@/hooks/reception/useOpenDiscrepancies';

const mockPush = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: mockPush }) }));

// ReceptionMobileView always mounts ReceiveWithoutQRSheet (closed by
// default) so the footer's "Recibir sin QR" has something to open. The
// sheet's confirmed path eventually reaches this mutation — mocked here
// exactly as in ReceiveWithoutQRSheet's own test, so a stray call would
// fail any assertion on it, not silently succeed against a real client.
const mockMutate = vi.fn();
vi.mock('@/hooks/reception/useOpenRouteReception', () => ({
  useOpenRouteReception: () => ({ mutate: mockMutate, isPending: false }),
}));

import { ReceptionMobileView, type ReceptionMobileViewProps } from './ReceptionMobileView';

function buildRoute(overrides: Partial<IncomingRoute> = {}): IncomingRoute {
  return {
    id: 'route-1',
    code: 'PR-2026-0100',
    driver_id: 'driver-1',
    driver_name: 'M. Rojas',
    plate: 'JKLM-42',
    in_transit_at: '2026-08-20T12:00:00.000Z',
    started_at: null,
    manifest_count: 2,
    expected_packages: 40,
    ...overrides,
  };
}

function buildDiscrepancy(overrides: Partial<OpenDiscrepancy> = {}): OpenDiscrepancy {
  return {
    id: 'disc-1',
    routeId: 'route-9',
    routeCode: 'PR-2026-0099',
    expected: 20,
    received: 17,
    delta: 3,
    completedAt: '2026-08-20T11:00:00.000Z',
    ...overrides,
  };
}

// Shorter wait, but listed FIRST in the array — the array's own order is
// deliberately not the wait order, so a hero pick that just takes
// yardRoutes[0] would still pass a naive test.
const esperaCorta = buildRoute({
  id: 'route-short-wait',
  code: 'PR-2026-0148',
  in_transit_at: '2026-08-20T12:20:00.000Z',
});
// Longer wait, listed SECOND — this one must win the hero slot.
const esperaLarga = buildRoute({
  id: 'route-long-wait',
  code: 'PR-2026-0155',
  in_transit_at: '2026-08-20T11:00:00.000Z',
});

const dif = buildDiscrepancy();

const baseProps: ReceptionMobileViewProps = {
  yardRoutes: [esperaCorta, esperaLarga],
  transitRoutes: [],
  discrepancies: [],
  isLoading: false,
  userName: 'Marcela Rojas',
  onStartCount: vi.fn(),
  onOpenQRScanner: vi.fn(),
  onOpenDiscrepancy: vi.fn(),
  now: new Date('2026-08-20T12:30:00.000Z'),
};

describe('ReceptionMobileView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('el héroe es la ruta que lleva más tiempo esperando', () => {
    render(<ReceptionMobileView {...baseProps} yardRoutes={[esperaCorta, esperaLarga]} />);
    const hero = screen.getByTestId('reception-yard-hero');
    // Positive AND negative: the longest wait is in the hero, the shorter
    // wait is not — otherwise both codes rendering somewhere in the hero
    // subtree (e.g. leaking into a nested row) would still pass.
    expect(within(hero).getByText(esperaLarga.code)).toBeInTheDocument();
    expect(within(hero).queryByText(esperaCorta.code)).not.toBeInTheDocument();
  });

  it('las demás rutas en patio son filas, no decisiones', () => {
    render(<ReceptionMobileView {...baseProps} yardRoutes={[esperaCorta, esperaLarga]} />);
    // Exactly one "Iniciar conteo" however many yard routes exist — the
    // compact row for esperaCorta has no call-to-action of its own.
    expect(screen.getAllByRole('button', { name: /Iniciar conteo/ })).toHaveLength(1);
    expect(screen.getByText(esperaCorta.code)).toBeInTheDocument();
  });

  it('muestra el eyebrow TAMBIÉN EN PATIO solo cuando hay filas ademas del héroe', () => {
    const { rerender } = render(
      <ReceptionMobileView {...baseProps} yardRoutes={[esperaCorta, esperaLarga]} />,
    );
    // A rename here would go unnoticed without this assertion — the other
    // two eyebrows (DIFERENCIAS ABIERTAS, REINGRESOS) already have one.
    expect(screen.getByText('TAMBIÉN EN PATIO')).toBeInTheDocument();

    // With only the hero and no other yard routes, the eyebrow has nothing
    // to introduce and must not render an empty section.
    rerender(<ReceptionMobileView {...baseProps} yardRoutes={[esperaLarga]} />);
    expect(screen.queryByText('TAMBIÉN EN PATIO')).not.toBeInTheDocument();
  });

  it('sin camiones en patio muestra el vacío y conserva el pie', () => {
    render(<ReceptionMobileView {...baseProps} yardRoutes={[]} />);
    expect(screen.getByText(/Ningún camión en patio/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Escanear QR de ruta/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Recibir sin QR/i })).toBeInTheDocument();
  });

  it('en carga muestra un esqueleto con la geometría de la tarjeta héroe, nunca un spinner', () => {
    render(<ReceptionMobileView {...baseProps} isLoading yardRoutes={[]} />);
    expect(screen.queryByTestId('reception-yard-hero')).not.toBeInTheDocument();
    expect(screen.queryByText(/Ningún camión en patio/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    // Same structural shell as the real hero card (rounded-2xl, border-2,
    // p-5), populated with animate-pulse blocks rather than a bare box —
    // proves the skeleton is built from the card's own classes, not a
    // disconnected placeholder.
    const skeleton = screen.getByTestId('reception-yard-hero-skeleton');
    expect(skeleton.className).toContain('rounded-2xl');
    expect(skeleton.className).toContain('border-2');
    expect(skeleton.querySelectorAll('.animate-pulse').length).toBeGreaterThan(0);
  });

  it('en carga el pie sigue montado — no hay un instante sin salida', () => {
    render(<ReceptionMobileView {...baseProps} isLoading yardRoutes={[]} />);
    expect(screen.getByRole('button', { name: /Escanear QR de ruta/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Recibir sin QR/i })).toBeInTheDocument();
  });

  it('no monta KPIs ni conmutador de tema', () => {
    // Decisión del mock 3i: el operario no actúa sobre un promedio del
    // turno. Eso vive en 3c, que es la pantalla del jefe.
    render(<ReceptionMobileView {...baseProps} />);
    expect(screen.queryByText(/Rutas esperadas hoy/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/En patio sin contar/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /tema/i })).not.toBeInTheDocument();
  });

  it('las diferencias abiertas llevan a leer el caso', async () => {
    const onOpenDiscrepancy = vi.fn();
    const user = userEvent.setup();
    render(
      <ReceptionMobileView {...baseProps} onOpenDiscrepancy={onOpenDiscrepancy} discrepancies={[dif]} />,
    );
    await user.click(screen.getByRole('button', { name: /Resolver/i }));
    expect(onOpenDiscrepancy).toHaveBeenCalledWith(dif.routeId);
  });

  it('sin diferencias abiertas, no muestra el bloque ni el botón Resolver', () => {
    render(<ReceptionMobileView {...baseProps} discrepancies={[]} />);
    expect(screen.queryByText(/DIFERENCIAS ABIERTAS/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Resolver/i })).not.toBeInTheDocument();
  });

  it('renderiza el returnsSlot bajo el eyebrow REINGRESOS cuando se pasa', () => {
    render(
      <ReceptionMobileView
        {...baseProps}
        returnsSlot={<div data-testid="stub-returns-block">stub returns</div>}
      />,
    );
    expect(screen.getByText('REINGRESOS')).toBeInTheDocument();
    expect(screen.getByTestId('stub-returns-block')).toBeInTheDocument();
  });

  it('sin returnsSlot, no renderiza el eyebrow REINGRESOS', () => {
    render(<ReceptionMobileView {...baseProps} returnsSlot={undefined} />);
    expect(screen.queryByText(/REINGRESOS/i)).not.toBeInTheDocument();
  });

  it('nunca invoca open_route_reception al montar ni al iniciar un conteo', async () => {
    // Starting a count is a plain callback — the mutation that ends the
    // driver's trip belongs only to the confirmed no-QR path.
    const user = userEvent.setup();
    render(<ReceptionMobileView {...baseProps} yardRoutes={[esperaCorta, esperaLarga]} />);
    await user.click(screen.getByRole('button', { name: /Iniciar conteo/ }));
    expect(mockMutate).not.toHaveBeenCalled();
  });

  it('tocar el héroe llama a onStartCount con la ruta que más espera', async () => {
    const onStartCount = vi.fn();
    const user = userEvent.setup();
    render(
      <ReceptionMobileView
        {...baseProps}
        onStartCount={onStartCount}
        yardRoutes={[esperaCorta, esperaLarga]}
      />,
    );
    await user.click(screen.getByRole('button', { name: /Iniciar conteo/ }));
    expect(onStartCount).toHaveBeenCalledWith(esperaLarga.id);
  });

  it('el botón Escanear QR de ruta llama a onOpenQRScanner', async () => {
    const onOpenQRScanner = vi.fn();
    const user = userEvent.setup();
    render(<ReceptionMobileView {...baseProps} onOpenQRScanner={onOpenQRScanner} />);
    await user.click(screen.getByRole('button', { name: /Escanear QR de ruta/i }));
    expect(onOpenQRScanner).toHaveBeenCalledTimes(1);
  });

  it('el botón Recibir sin QR abre la hoja de recepción manual', async () => {
    const user = userEvent.setup();
    render(
      <ReceptionMobileView
        {...baseProps}
        transitRoutes={[buildRoute({ id: 'transit-1', code: 'PR-2026-0210', in_transit_at: null })]}
      />,
    );
    await user.click(screen.getByRole('button', { name: /Recibir sin QR/i }));
    expect(screen.getByText(/Elegí la ruta cuyo camión está frente a vos/i)).toBeInTheDocument();
    expect(screen.getByText('PR-2026-0210')).toBeInTheDocument();
  });
});
