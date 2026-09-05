import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('@/hooks/dispatch/mobile/useDispatchRouteToDT', () => ({
  useDispatchRouteToDT: vi.fn(),
}));

vi.mock('@/hooks/dispatch/mobile/useDispatchRetryChecklist', () => ({
  useDispatchRetryChecklist: () => ({ data: { verified: [], warnings: [] }, isLoading: false }),
}));

import { useDispatchRouteToDT } from '@/hooks/dispatch/mobile/useDispatchRouteToDT';
import { DispatchRouteDispatchReview, type DispatchRouteDispatchReviewProps } from './DispatchRouteDispatchReview';

function mockDispatch(overrides: Partial<ReturnType<typeof useDispatchRouteToDT>> = {}) {
  const dispatch = vi.fn().mockResolvedValue({ ok: true, externalRouteId: 'DT-164972', packagesDispatched: 148 });
  (useDispatchRouteToDT as ReturnType<typeof vi.fn>).mockReturnValue({ dispatch, isDispatching: false, ...overrides });
  return dispatch;
}

const BASE_PROPS: DispatchRouteDispatchReviewProps = {
  routeId: 'route-1',
  operatorId: 'op-1',
  routeCode: 'RUT-0099',
  driverName: 'Mario González',
  vehicleExternalId: 'RTHK-72',
  routeDate: '2026-09-05',
  stopsCount: 24,
  packagesCount: 148,
  onDispatched: vi.fn(),
};

beforeEach(() => {
  vi.resetAllMocks();
});

describe('DispatchRouteDispatchReview', () => {
  it('item 9 — shows camión, conductor, fecha and paradas · paquetes', () => {
    mockDispatch();
    render(<DispatchRouteDispatchReview {...BASE_PROPS} />);

    expect(screen.getByText('RTHK-72')).toBeInTheDocument();
    expect(screen.getByText('Mario González')).toBeInTheDocument();
    expect(screen.getByText(/sáb|sab, 05 sep|05 sep/i)).toBeInTheDocument();
    expect(screen.getByText('24 paradas · 148 paquetes')).toBeInTheDocument();
  });

  it('item 11 — the "Qué pasa al despachar" block enumerates the four effects', () => {
    mockDispatch();
    render(<DispatchRouteDispatchReview {...BASE_PROPS} />);

    expect(screen.getByText(/qu[eé] pasa al despachar/i)).toBeInTheDocument();
    expect(screen.getByText(/se crean las paradas en dispatchtrack/i)).toBeInTheDocument();
    expect(screen.getByText(/en_ruta/i)).toBeInTheDocument();
    expect(screen.getByText(/despu[eé]s no se edita desde aureon/i)).toBeInTheDocument();
    expect(screen.getByText(/si el env[ií]o falla, nada cambia/i)).toBeInTheDocument();
  });

  it('item 10 — with no vehicle assigned, Despachar is disabled and the reason is shown', () => {
    mockDispatch();
    render(<DispatchRouteDispatchReview {...BASE_PROPS} vehicleExternalId={null} />);

    expect(screen.getByRole('button', { name: /despachar/i })).toBeDisabled();
    expect(screen.getByText(/dispatchtrack exige el identificador del cami[oó]n/i)).toBeInTheDocument();
  });

  it('item 10 — with a vehicle assigned, Despachar is enabled', () => {
    mockDispatch();
    render(<DispatchRouteDispatchReview {...BASE_PROPS} />);
    expect(screen.getByRole('button', { name: /^despachar$/i })).not.toBeDisabled();
  });

  it('tapping Despachar calls the endpoint with the real truck/driver identifiers and reports the outcome', async () => {
    const dispatch = mockDispatch();
    const onDispatched = vi.fn();
    render(<DispatchRouteDispatchReview {...BASE_PROPS} onDispatched={onDispatched} />);

    await userEvent.click(screen.getByRole('button', { name: /^despachar$/i }));

    await waitFor(() => expect(dispatch).toHaveBeenCalledWith('route-1', {
      truckIdentifier: 'RTHK-72',
      driverIdentifier: 'Mario González',
    }));
    expect(onDispatched).toHaveBeenCalledWith({ externalRouteId: 'DT-164972', packagesDispatched: 148 });
  });

  it('item 12 — two rapid taps, before the first request resolves, dispatch once', async () => {
    let resolveDispatch: (v: unknown) => void = () => {};
    const dispatch = vi.fn().mockImplementation(
      () => new Promise((resolve) => { resolveDispatch = resolve; }),
    );
    (useDispatchRouteToDT as ReturnType<typeof vi.fn>).mockReturnValue({ dispatch, isDispatching: false });
    render(<DispatchRouteDispatchReview {...BASE_PROPS} />);
    const button = screen.getByRole('button', { name: /^despachar$/i });

    // Two clicks with nothing awaited between them — the closest a test
    // can get to a real double-tap, where the SECOND tap lands before the
    // first request has any chance to resolve. `dblClick` was tried first
    // and does not reproduce this: it awaits enough between its internal
    // events that a mocked, instantly-resolving `dispatch` had already
    // completed (and reset its own guard) before the second click fired —
    // proving nothing about the guard this item asks for.
    fireEvent.click(button);
    fireEvent.click(button);

    expect(dispatch).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveDispatch({ ok: true, externalRouteId: 'DT-1', packagesDispatched: 1 });
    });
  });

  it('item 12 — while isDispatching is true, the button is disabled and shows progress', () => {
    mockDispatch({ isDispatching: true });
    render(<DispatchRouteDispatchReview {...BASE_PROPS} />);
    expect(screen.getByRole('button', { name: /despachando/i })).toBeDisabled();
  });

  it('a DT_API_ERROR refusal shows the distinct copy for that code, not a generic message', async () => {
    const dispatch = vi.fn().mockResolvedValue({ ok: false, code: 'DT_API_ERROR', message: 'x' });
    (useDispatchRouteToDT as ReturnType<typeof vi.fn>).mockReturnValue({ dispatch, isDispatching: false });
    render(<DispatchRouteDispatchReview {...BASE_PROPS} />);

    await userEvent.click(screen.getByRole('button', { name: /^despachar$/i }));
    await waitFor(() => expect(screen.getByText(/no se cre[oó] nada/i)).toBeInTheDocument());
  });

  it('a DT_ACCEPTED_LOCAL_FAILED refusal shows its own distinct copy, never the DT_API_ERROR one', async () => {
    const dispatch = vi.fn().mockResolvedValue({
      ok: false,
      code: 'DT_ACCEPTED_LOCAL_FAILED',
      externalRouteId: 'DT-9',
      message: 'x',
    });
    (useDispatchRouteToDT as ReturnType<typeof vi.fn>).mockReturnValue({ dispatch, isDispatching: false });
    render(<DispatchRouteDispatchReview {...BASE_PROPS} />);

    await userEvent.click(screen.getByRole('button', { name: /^despachar$/i }));
    await waitFor(() => expect(screen.getByText(/ya recibi[oó] la ruta/i)).toBeInTheDocument());
    expect(screen.queryByText(/no se cre[oó] nada/i)).not.toBeInTheDocument();
  });

  it('Fase 3 (2k) — Volver on the error screen returns to the review, Despachar reappears', async () => {
    const dispatch = vi.fn().mockResolvedValue({ ok: false, code: 'DT_API_ERROR', message: 'x' });
    (useDispatchRouteToDT as ReturnType<typeof vi.fn>).mockReturnValue({ dispatch, isDispatching: false });
    render(<DispatchRouteDispatchReview {...BASE_PROPS} />);

    await userEvent.click(screen.getByRole('button', { name: /^despachar$/i }));
    await waitFor(() => expect(screen.getByTestId('dispatch-route-error')).toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: /volver/i }));
    expect(screen.getByRole('button', { name: /^despachar$/i })).toBeInTheDocument();
  });

  it('Fase 3 (2k) — Reintentar on the error screen calls dispatch again', async () => {
    const dispatch = vi.fn().mockResolvedValue({ ok: false, code: 'DT_API_ERROR', message: 'x' });
    (useDispatchRouteToDT as ReturnType<typeof vi.fn>).mockReturnValue({ dispatch, isDispatching: false });
    render(<DispatchRouteDispatchReview {...BASE_PROPS} />);

    await userEvent.click(screen.getByRole('button', { name: /^despachar$/i }));
    await waitFor(() => expect(screen.getByTestId('dispatch-route-error')).toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: /^reintentar$/i }));
    await waitFor(() => expect(dispatch).toHaveBeenCalledTimes(2));
  });

  it('Fase 3 item 14 — three failed attempts escalate to the shift lead', async () => {
    const dispatch = vi.fn().mockResolvedValue({ ok: false, code: 'DT_API_ERROR', message: 'x' });
    (useDispatchRouteToDT as ReturnType<typeof vi.fn>).mockReturnValue({ dispatch, isDispatching: false });
    render(<DispatchRouteDispatchReview {...BASE_PROPS} />);

    await userEvent.click(screen.getByRole('button', { name: /^despachar$/i }));
    await waitFor(() => expect(screen.getByTestId('dispatch-route-error')).toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: /^reintentar$/i }));
    await waitFor(() => expect(dispatch).toHaveBeenCalledTimes(2));
    await userEvent.click(screen.getByRole('button', { name: /^reintentar$/i }));
    await waitFor(() => expect(dispatch).toHaveBeenCalledTimes(3));
    expect(screen.getByText(/jefe de turno/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^reintentar$/i })).not.toBeInTheDocument();
  });

  it('a validation refusal (EMPTY_ROUTE) also opens the error screen — Volver, no primary action', async () => {
    const dispatch = vi.fn().mockResolvedValue({ ok: false, code: 'EMPTY_ROUTE', message: 'x' });
    (useDispatchRouteToDT as ReturnType<typeof vi.fn>).mockReturnValue({ dispatch, isDispatching: false });
    render(<DispatchRouteDispatchReview {...BASE_PROPS} />);

    await userEvent.click(screen.getByRole('button', { name: /^despachar$/i }));
    await waitFor(() => expect(screen.getByTestId('dispatch-route-error')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: /volver/i })).toBeInTheDocument();
  });
});
