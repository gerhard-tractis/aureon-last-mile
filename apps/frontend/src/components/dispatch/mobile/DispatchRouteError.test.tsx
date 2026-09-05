import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('@/hooks/dispatch/mobile/useDispatchRetryChecklist', () => ({
  useDispatchRetryChecklist: vi.fn(),
}));

import { useDispatchRetryChecklist } from '@/hooks/dispatch/mobile/useDispatchRetryChecklist';
import { DispatchRouteError, type DispatchRouteErrorProps } from './DispatchRouteError';
import { dispatchErrorCopy } from '@/lib/dispatch/mobile/dispatch-review';

function mockChecklist(overrides: Partial<ReturnType<typeof useDispatchRetryChecklist>> = {}) {
  (useDispatchRetryChecklist as ReturnType<typeof vi.fn>).mockReturnValue({
    data: { verified: ['Camión y conductor asignados', '24 paradas con dirección y teléfono'], warnings: ['2 paradas sin teléfono del receptor'] },
    isLoading: false,
    ...overrides,
  });
}

const BASE_PROPS: DispatchRouteErrorProps = {
  routeId: 'route-1',
  operatorId: 'op-1',
  vehicleAssigned: true,
  driverAssigned: true,
  info: dispatchErrorCopy('DT_API_ERROR'),
  attempt: 1,
  onRetry: vi.fn(),
  onBack: vi.fn(),
};

beforeEach(() => {
  vi.resetAllMocks();
  mockChecklist();
});

describe('DispatchRouteError — item 13, names what did not change', () => {
  it('shows the whatChanged text and the error text', () => {
    render(<DispatchRouteError {...BASE_PROPS} />);
    expect(screen.getByText(/loaded/)).toBeInTheDocument();
    expect(screen.getByText(/listo_para_despacho/)).toBeInTheDocument();
    expect(screen.getByText(/no se cre[oó] nada/i)).toBeInTheDocument();
  });
});

describe('DispatchRouteError — item 15, checklist shown only for DT_API_ERROR', () => {
  it('shows verified and warning rows for DT_API_ERROR', () => {
    render(<DispatchRouteError {...BASE_PROPS} />);
    expect(screen.getByText('Camión y conductor asignados')).toBeInTheDocument();
    expect(screen.getByText('24 paradas con dirección y teléfono')).toBeInTheDocument();
    expect(screen.getByText('2 paradas sin teléfono del receptor')).toBeInTheDocument();
  });

  it('does not show the checklist for DT_ACCEPTED_LOCAL_FAILED', () => {
    render(<DispatchRouteError {...BASE_PROPS} info={dispatchErrorCopy('DT_ACCEPTED_LOCAL_FAILED')} />);
    expect(screen.queryByText('Camión y conductor asignados')).not.toBeInTheDocument();
  });

  it('the primary button is labelled Completar for DT_ACCEPTED_LOCAL_FAILED, never Reintentar', () => {
    render(<DispatchRouteError {...BASE_PROPS} info={dispatchErrorCopy('DT_ACCEPTED_LOCAL_FAILED')} />);
    expect(screen.getByRole('button', { name: /^completar$/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^reintentar$/i })).not.toBeInTheDocument();
  });

  it('the primary button is labelled Verificar for a no-response state', () => {
    render(<DispatchRouteError {...BASE_PROPS} info={dispatchErrorCopy(null)} />);
    expect(screen.getByRole('button', { name: /^verificar$/i })).toBeInTheDocument();
  });
});

describe('DispatchRouteError — primary action calls onRetry', () => {
  it('tapping the primary button calls onRetry', async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    render(<DispatchRouteError {...BASE_PROPS} onRetry={onRetry} />);
    await user.click(screen.getByRole('button', { name: /^reintentar$/i }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('a validation refusal (no primaryAction) shows no primary button, only Volver', () => {
    render(<DispatchRouteError {...BASE_PROPS} info={dispatchErrorCopy('EMPTY_ROUTE')} />);
    expect(screen.queryByRole('button', { name: /^reintentar$/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /volver/i })).toBeInTheDocument();
  });
});

describe('DispatchRouteError — item 14, attempt escalation', () => {
  it('below the threshold, the normal primary action shows', () => {
    render(<DispatchRouteError {...BASE_PROPS} attempt={2} />);
    expect(screen.getByRole('button', { name: /^reintentar$/i })).toBeInTheDocument();
    expect(screen.queryByText(/jefe de turno/i)).not.toBeInTheDocument();
  });

  it('at the third attempt, escalation copy replaces the primary action', () => {
    render(<DispatchRouteError {...BASE_PROPS} attempt={3} />);
    expect(screen.getByText(/jefe de turno/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^reintentar$/i })).not.toBeInTheDocument();
  });
});
