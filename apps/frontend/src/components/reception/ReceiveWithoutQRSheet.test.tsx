import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { IncomingRoute } from '@/hooks/reception/useIncomingRoutes';

const mockPush = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: mockPush }) }));

// The sheet must never open a reception itself — only the reviewed
// `ReceiveWithoutQRButton` may, and only after its own confirmation dialog.
// Mocking `useOpenRouteReception` here lets the "nothing on mount" test
// assert the actual mutation entry point was never touched, not just that
// nothing rendered.
const mockMutate = vi.fn();
vi.mock('@/hooks/reception/useOpenRouteReception', () => ({
  useOpenRouteReception: () => ({ mutate: mockMutate, isPending: false }),
}));

import { ReceiveWithoutQRSheet } from './ReceiveWithoutQRSheet';

function buildRoute(overrides: Partial<IncomingRoute> = {}): IncomingRoute {
  return {
    id: 'route-1',
    code: 'PR-2026-0148',
    driver_id: 'driver-1',
    driver_name: 'M. Rojas',
    plate: 'JKLM-42',
    in_transit_at: null,
    started_at: '2026-08-20T09:30:00.000Z',
    manifest_count: 1,
    expected_packages: 18,
    ...overrides,
  };
}

describe('ReceiveWithoutQRSheet', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('lists routes still in transit, identifying the truck by code and plate', () => {
    const routeA = buildRoute();
    const routeB = buildRoute({ id: 'route-2', code: 'PR-2026-0199', plate: 'ZZZZ-99' });

    render(
      <ReceiveWithoutQRSheet open onOpenChange={vi.fn()} routes={[routeA, routeB]} />,
    );

    expect(screen.getByText('PR-2026-0148')).toBeInTheDocument();
    expect(screen.getByText(/JKLM-42/)).toBeInTheDocument();
    expect(screen.getByText('PR-2026-0199')).toBeInTheDocument();
    expect(screen.getByText(/ZZZZ-99/)).toBeInTheDocument();
  });

  it('does not open any reception until a route is chosen', () => {
    // open_route_reception ends the driver's trip: it freezes expected_count
    // and locks pickup scanning. It must never fire from mounting the sheet.
    render(<ReceiveWithoutQRSheet open onOpenChange={vi.fn()} routes={[buildRoute()]} />);

    expect(mockMutate).not.toHaveBeenCalled();
  });

  it('keeps each plate inside its own route card, not floating between rows', () => {
    // The plate is the single datum the receptionist matches against the
    // truck in front of them. With two rows on screen, a caption that isn't
    // contained by the same bordered card as its route is ambiguous about
    // which truck it names.
    const routeA = buildRoute();
    const routeB = buildRoute({ id: 'route-2', code: 'PR-2026-0199', plate: 'ZZZZ-99' });

    render(
      <ReceiveWithoutQRSheet open onOpenChange={vi.fn()} routes={[routeA, routeB]} />,
    );

    const cardA = screen.getByTestId('receive-without-qr-option-route-1');
    expect(within(cardA).getByText(/JKLM-42/)).toBeInTheDocument();
    expect(
      within(cardA).getByRole('button', { name: /PR-2026-0148/ }),
    ).toBeInTheDocument();
    expect(within(cardA).queryByText(/ZZZZ-99/)).not.toBeInTheDocument();
  });

  it('shows the confirmation button after choosing a route', async () => {
    const user = userEvent.setup();
    render(<ReceiveWithoutQRSheet open onOpenChange={vi.fn()} routes={[buildRoute()]} />);

    await user.click(screen.getByRole('button', { name: /PR-2026-0148/ }));

    expect(
      screen.getByRole('button', { name: /Recibir sin QR/i }),
    ).toBeInTheDocument();
    expect(mockMutate).not.toHaveBeenCalled();
  });

  it('echoes the armed route\'s code and plate, and offers a way back to the list', async () => {
    const user = userEvent.setup();
    render(<ReceiveWithoutQRSheet open onOpenChange={vi.fn()} routes={[buildRoute()]} />);

    await user.click(screen.getByRole('button', { name: /PR-2026-0148/ }));

    expect(screen.getByText('PR-2026-0148')).toBeInTheDocument();
    expect(screen.getByText(/JKLM-42/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Cambiar ruta/i }));

    expect(screen.getByRole('button', { name: /PR-2026-0148/ })).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /Recibir sin QR/i }),
    ).not.toBeInTheDocument();
    expect(mockMutate).not.toHaveBeenCalled();
  });

  it('resets the chosen route when the sheet is dismissed, so reopening starts back at the list', async () => {
    const user = userEvent.setup();
    render(<ReceiveWithoutQRSheet open onOpenChange={vi.fn()} routes={[buildRoute()]} />);

    await user.click(screen.getByRole('button', { name: /PR-2026-0148/ }));
    expect(screen.getByRole('button', { name: /Recibir sin QR/i })).toBeInTheDocument();

    await user.keyboard('{Escape}');

    expect(screen.getByRole('button', { name: /PR-2026-0148/ })).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /Recibir sin QR/i }),
    ).not.toBeInTheDocument();
  });

  it('says so when no route is in transit, instead of rendering an empty list', () => {
    render(<ReceiveWithoutQRSheet open onOpenChange={vi.fn()} routes={[]} />);

    expect(screen.getByText(/Ninguna ruta en camino/i)).toBeInTheDocument();
  });
});
