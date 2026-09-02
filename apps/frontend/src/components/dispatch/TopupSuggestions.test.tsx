import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import {
  TopupSuggestions,
  TOPUP_ACCEPT_REFUSAL_MESSAGES,
  topupRefusalMessage,
} from './TopupSuggestions';
import { TopupAcceptError } from '@/hooks/dispatch/useTopupCandidates';

const mockUseTopupCandidates = vi.fn();
const mockMutate = vi.fn();

vi.mock('@/hooks/dispatch/useTopupCandidates', async () => {
  const actual = await vi.importActual<typeof import('@/hooks/dispatch/useTopupCandidates')>(
    '@/hooks/dispatch/useTopupCandidates',
  );
  return {
    ...actual,
    useTopupCandidates: (...args: unknown[]) => mockUseTopupCandidates(...args),
    useAcceptTopup: () => ({ mutate: mockMutate, isPending: false }),
  };
});

const CANDIDATE = {
  routeBlockId: 'rb-1',
  donorRouteId: 'route-2',
  donorExternalRouteId: 'EXT-2',
  donorDriverName: 'Juan Pérez',
  comunaId: 'comuna-1',
  comunaName: 'Providencia',
  packageCount: 4,
};

beforeEach(() => {
  vi.clearAllMocks();
  mockUseTopupCandidates.mockReturnValue({
    data: { routeId: 'r1', eligible: true, reason: null, candidates: [CANDIDATE] },
    isLoading: false,
  });
  vi.stubGlobal('prompt', vi.fn(() => 'motivo de prueba'));
});

describe('TopupSuggestions — role gate', () => {
  it.each(['ops_leader', 'operations_manager', 'admin', 'super_admin'])(
    'renders for manager role %s',
    (role) => {
      render(<TopupSuggestions routeId="r1" operatorId="op-1" role={role} />);
      expect(screen.getByText('Providencia')).toBeInTheDocument();
    },
  );

  it('renders nothing for a non-manager role (loading_crew)', () => {
    const { container } = render(<TopupSuggestions routeId="r1" operatorId="op-1" role="loading_crew" />);
    expect(container).toBeEmptyDOMElement();
    // The role gate withholds the query entirely, not just the render.
    expect(mockUseTopupCandidates).toHaveBeenCalledWith('r1', 'op-1', false);
  });

  it('renders nothing for a null role', () => {
    const { container } = render(<TopupSuggestions routeId="r1" operatorId="op-1" role={null} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe('TopupSuggestions — render-nothing-when-unconfigured contract', () => {
  it('renders nothing while loading', () => {
    mockUseTopupCandidates.mockReturnValue({ data: undefined, isLoading: true });
    const { container } = render(<TopupSuggestions routeId="r1" operatorId="op-1" role="admin" />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing on a query error (data undefined)', () => {
    mockUseTopupCandidates.mockReturnValue({ data: undefined, isLoading: false });
    const { container } = render(<TopupSuggestions routeId="r1" operatorId="op-1" role="admin" />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing when the route is ineligible (e.g. AT_MAX_DROPS)', () => {
    mockUseTopupCandidates.mockReturnValue({
      data: { routeId: 'r1', eligible: false, reason: 'AT_MAX_DROPS', candidates: [] },
      isLoading: false,
    });
    const { container } = render(<TopupSuggestions routeId="r1" operatorId="op-1" role="admin" />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing when eligible but there are zero candidates — never "no suggestions available"', () => {
    mockUseTopupCandidates.mockReturnValue({
      data: { routeId: 'r1', eligible: true, reason: null, candidates: [] },
      isLoading: false,
    });
    const { container } = render(<TopupSuggestions routeId="r1" operatorId="op-1" role="admin" />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe('TopupSuggestions — accept flow', () => {
  it('prompts for a reason and calls the mutation with it', () => {
    render(<TopupSuggestions routeId="r1" operatorId="op-1" role="admin" />);
    fireEvent.click(screen.getByRole('button', { name: /Aceptar/i }));
    expect(mockMutate).toHaveBeenCalledWith(
      { donorRouteId: 'route-2', comunaId: 'comuna-1', reason: 'motivo de prueba' },
      expect.objectContaining({ onError: expect.any(Function), onSettled: expect.any(Function) }),
    );
  });

  it('does not call the mutation when the reason prompt is cancelled', () => {
    vi.stubGlobal('prompt', vi.fn(() => null));
    render(<TopupSuggestions routeId="r1" operatorId="op-1" role="admin" />);
    fireEvent.click(screen.getByRole('button', { name: /Aceptar/i }));
    expect(mockMutate).not.toHaveBeenCalled();
  });

  it('does not call the mutation when the reason prompt is blank', () => {
    vi.stubGlobal('prompt', vi.fn(() => '   '));
    render(<TopupSuggestions routeId="r1" operatorId="op-1" role="admin" />);
    fireEvent.click(screen.getByRole('button', { name: /Aceptar/i }));
    expect(mockMutate).not.toHaveBeenCalled();
  });

  it('shows a distinct, honest message and clears the phantom accepted row on a stale-suggestion refusal', async () => {
    mockMutate.mockImplementation((_vars, { onError, onSettled }) => {
      onError(new TopupAcceptError('BLOCK_ALREADY_STAGED'));
      onSettled();
    });
    render(<TopupSuggestions routeId="r1" operatorId="op-1" role="admin" />);
    fireEvent.click(screen.getByRole('button', { name: /Aceptar/i }));

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(TOPUP_ACCEPT_REFUSAL_MESSAGES.BLOCK_ALREADY_STAGED),
    );
    // The button returns to its normal label — no phantom "Aceptando..."
    // left behind after the refusal, and the list itself is refetched by
    // the hook's own onSettled invalidation (covered in the hook's tests),
    // not re-rendered as if the row were now accepted.
    expect(screen.getByRole('button', { name: 'Aceptar' })).toBeInTheDocument();
  });
});

describe('TopupSuggestions — refusal-code -> message mapping', () => {
  const codes = [
    'BLOCK_ALREADY_STAGED',
    'OVER_TOPUP_CAP',
    'AT_MAX_DROPS',
    'DONOR_ROUTE_NOT_RAIDABLE',
    'RECEIVING_ROUTE_NOT_LOADABLE',
    'ALREADY_HAS_TOPUP',
    'BLOCK_NOT_FOUND',
    'NOT_ADJACENT',
    'INVALID_TOPUP',
    'ROUTE_NOT_FOUND',
    'REASON_REQUIRED',
    'FORBIDDEN',
  ];

  it('maps every known refusal code to its OWN distinct message', () => {
    const messages = codes.map((c) => topupRefusalMessage(c));
    expect(new Set(messages).size).toBe(codes.length);
  });

  it.each(codes)('renders the mapped message for %s via the accept flow', async (code) => {
    mockMutate.mockImplementation((_vars, { onError, onSettled }) => {
      onError(new TopupAcceptError(code));
      onSettled();
    });
    render(<TopupSuggestions routeId="r1" operatorId="op-1" role="admin" />);
    fireEvent.click(screen.getByRole('button', { name: /Aceptar/i }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(TOPUP_ACCEPT_REFUSAL_MESSAGES[code]));
  });

  it('falls back to a generic honest message for an unknown code', () => {
    const msg = topupRefusalMessage('SOME_UNMAPPED_CODE');
    expect(msg).not.toBe('');
    expect(Object.values(TOPUP_ACCEPT_REFUSAL_MESSAGES)).not.toContain(msg);
  });
});

// ---------------------------------------------------------------------------
// Review additions (spec-73 phase 4b adversarial review).
// ---------------------------------------------------------------------------

describe('TopupSuggestions — review: the eligible flag is a gate in its own right', () => {
  // The existing "ineligible (AT_MAX_DROPS)" case also has `candidates: []`,
  // so deleting `!data.eligible` from the guard left every test green — the
  // flag was decorative. A payload that says "not eligible" while still
  // carrying rows must render nothing on the FLAG, not on the row count.
  it('renders nothing when eligible is false even if candidates are present', () => {
    mockUseTopupCandidates.mockReturnValue({
      data: { routeId: 'r1', eligible: false, reason: 'ALREADY_HAS_TOPUP', candidates: [CANDIDATE] },
      isLoading: false,
    });
    const { container } = render(<TopupSuggestions routeId="r1" operatorId="op-1" role="admin" />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe('TopupSuggestions — review: a failed read is not the same fact as "no candidates"', () => {
  // "There is nothing to suggest" and "we could not work out what to suggest"
  // are different facts. Rendering both as an empty screen tells the manager
  // the first when the second is true — the same class of defect phase 3's
  // review found in RouteBlockList.
  it('says the suggestions could not be loaded when the read fails', () => {
    mockUseTopupCandidates.mockReturnValue({ data: undefined, isLoading: false, isError: true });
    render(<TopupSuggestions routeId="r1" operatorId="op-1" role="admin" />);
    expect(screen.getByTestId('topup-read-failed')).toBeInTheDocument();
  });

  it('stays silent when the read succeeded and there is genuinely nothing to suggest', () => {
    mockUseTopupCandidates.mockReturnValue({
      data: { routeId: 'r1', eligible: true, reason: null, candidates: [] },
      isLoading: false,
      isError: false,
    });
    const { container } = render(<TopupSuggestions routeId="r1" operatorId="op-1" role="admin" />);
    expect(container).toBeEmptyDOMElement();
  });

  it('stays silent while the read is still in flight — never a premature failure note', () => {
    mockUseTopupCandidates.mockReturnValue({ data: undefined, isLoading: true, isError: false });
    const { container } = render(<TopupSuggestions routeId="r1" operatorId="op-1" role="admin" />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe('TopupSuggestions — review: the refusal must outlive the row it refused', () => {
  // The refusal invalidates the list, and the refetch commonly returns FEWER
  // rows (the stale one is gone) — often zero. With the render-nothing guard
  // ahead of the banner, that unmounted the whole widget and took the
  // explanation with it: the manager clicks Aceptar, is prompted for a
  // reason, and the screen simply goes blank with no statement that the
  // move was refused.
  it('keeps the refusal visible after the refetch empties the candidate list', async () => {
    mockMutate.mockImplementation((_vars, { onError, onSettled }) => {
      onError(new TopupAcceptError('BLOCK_ALREADY_STAGED'));
      onSettled();
    });
    const { rerender } = render(<TopupSuggestions routeId="r1" operatorId="op-1" role="admin" />);
    fireEvent.click(screen.getByRole('button', { name: /Aceptar/i }));
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());

    // The invalidation lands: the refused block is no longer a candidate.
    mockUseTopupCandidates.mockReturnValue({
      data: { routeId: 'r1', eligible: true, reason: null, candidates: [] },
      isLoading: false,
      isError: false,
    });
    rerender(<TopupSuggestions routeId="r1" operatorId="op-1" role="admin" />);

    expect(screen.getByRole('alert')).toHaveTextContent(
      TOPUP_ACCEPT_REFUSAL_MESSAGES.BLOCK_ALREADY_STAGED,
    );
  });
});

describe('TopupSuggestions — review: one accept at a time, route-wide', () => {
  // `ALREADY_HAS_TOPUP` is a one-shot ledger: a route may borrow exactly one
  // block. Disabling only the clicked row left every OTHER row live while the
  // first POST was in flight, so a manager could fire two accepts for the same
  // route and have the second one refused after the fact.
  it('disables every accept button while any accept is in flight', () => {
    const second = { ...CANDIDATE, routeBlockId: 'rb-2', comunaId: 'comuna-2', comunaName: 'Ñuñoa' };
    mockUseTopupCandidates.mockReturnValue({
      data: { routeId: 'r1', eligible: true, reason: null, candidates: [CANDIDATE, second] },
      isLoading: false,
      isError: false,
    });
    // A mutation that never settles — the in-flight window.
    mockMutate.mockImplementation(() => {});
    render(<TopupSuggestions routeId="r1" operatorId="op-1" role="admin" />);

    const buttons = screen.getAllByRole('button');
    expect(buttons).toHaveLength(2);
    fireEvent.click(buttons[0]);

    for (const b of screen.getAllByRole('button')) {
      expect(b).toBeDisabled();
    }
    fireEvent.click(screen.getAllByRole('button')[1]);
    expect(mockMutate).toHaveBeenCalledTimes(1);
  });
});

describe('TopupSuggestions — review: refusal copy may not assert a cause the database does not guarantee', () => {
  // accept_topup_block raises DONOR_ROUTE_NOT_RAIDABLE for ANY donor status
  // outside ('planned','loading') — which includes 'draft' and 'cancelled',
  // neither of which has a sealed manifest. Naming the manifest as the cause
  // sends the manager to look at a seal that may never have happened.
  it('does not blame a sealed manifest for DONOR_ROUTE_NOT_RAIDABLE', () => {
    expect(TOPUP_ACCEPT_REFUSAL_MESSAGES.DONOR_ROUTE_NOT_RAIDABLE).not.toMatch(/manifiesto/i);
  });

  // The same function raises NOT_ADJACENT when the RECEIVING route has no
  // source andén at all (`array_length(v_own_zones, 1) IS NULL`), not only
  // when the two andenes are unrelated. A message that blames adjacency alone
  // points the manager at the adjacency table when the real gap is that this
  // route has no andén to be adjacent to.
  it('admits the missing-andén case in the NOT_ADJACENT message', () => {
    expect(TOPUP_ACCEPT_REFUSAL_MESSAGES.NOT_ADJACENT).toMatch(/no tiene andén/i);
  });
});
