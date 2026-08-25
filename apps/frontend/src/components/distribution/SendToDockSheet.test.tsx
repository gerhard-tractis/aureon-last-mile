import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SendToDockSheet } from './SendToDockSheet';
import type { SendToDockRequest } from './PendingMobileList';
import type { DockZoneRecord } from '@/hooks/distribution/useDockZones';

function makeZone(overrides: Partial<DockZoneRecord> = {}): DockZoneRecord {
  return {
    id: 'zone-a1',
    name: 'Zona Norte',
    code: 'A1',
    is_consolidation: false,
    comunas: [],
    is_active: true,
    operator_id: 'op-1',
    capacity: 180,
    ...overrides,
  };
}

const suggestedZone = makeZone();
const otherZone = makeZone({ id: 'zone-b2', code: 'B2', name: 'Zona Sur', capacity: null });
const consolidationZone = makeZone({
  id: 'zone-cons',
  code: 'CONS',
  name: 'Consolidación',
  is_consolidation: true,
  capacity: null,
});

const request: SendToDockRequest = {
  packageIds: ['pkg-1'],
  packageLabels: ['BULTO-1'],
  code: 'BULTO-1',
  comunaName: 'Quilicura',
  suggestedZone,
};

const activeZones: DockZoneRecord[] = [suggestedZone, otherZone, consolidationZone];

const baseProps = {
  open: true,
  onOpenChange: vi.fn(),
  request,
  activeZones,
  sectorizedCounts: { 'zone-a1': 169 },
  canUse: true,
  onConfirm: vi.fn(),
};

describe('SendToDockSheet (4e)', () => {
  it('titles the sheet "Enviar {código} a" with an order/comuna/suggested subtitle', () => {
    render(<SendToDockSheet {...baseProps} />);
    expect(screen.getByText('Enviar BULTO-1 a')).toBeInTheDocument();
    expect(screen.getByText(/Quilicura/)).toBeInTheDocument();
    expect(screen.getByText(/sugerido A1 por comuna/i)).toBeInTheDocument();
  });

  it('shows the suggested andén first, accent-bordered, badged SUGERIDO, with its occupancy', () => {
    render(<SendToDockSheet {...baseProps} />);
    const suggested = screen.getByTestId('send-to-dock-option-zone-a1');
    expect(suggested).toHaveTextContent('SUGERIDO');
    expect(suggested).toHaveTextContent('169 / 180');
    const codes = screen.getAllByTestId(/^send-to-dock-option-/).map((el) => el.dataset.testid);
    expect(codes[0]).toBe('send-to-dock-option-zone-a1');
  });

  it('renders occupancy only where capacity is configured', () => {
    render(<SendToDockSheet {...baseProps} />);
    const other = screen.getByTestId('send-to-dock-option-zone-b2');
    expect(within(other).queryByTestId('dock-capacity-fill')).not.toBeInTheDocument();
  });

  it('lists consolidación last, with the retention note', () => {
    render(<SendToDockSheet {...baseProps} />);
    const codes = screen.getAllByTestId(/^send-to-dock-option-/).map((el) => el.dataset.testid);
    expect(codes[codes.length - 1]).toBe('send-to-dock-option-zone-cons');
    expect(screen.getByText(/queda retenido hasta su fecha/i)).toBeInTheDocument();
  });

  it('shows the audit note', () => {
    render(<SendToDockSheet {...baseProps} />);
    expect(
      screen.getByText(/el envío manual queda registrado con tu nombre y hora/i),
    ).toBeInTheDocument();
  });

  it('footer has Cancelar and "Enviar a {código}", defaulting to the suggested zone', () => {
    render(<SendToDockSheet {...baseProps} />);
    expect(screen.getByRole('button', { name: /cancelar/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Enviar a A1' })).toBeInTheDocument();
  });

  // Finding #4 (Fase 3 review) — onConfirm now hands back the whole
  // selected zone object, not just its id, so callers read
  // `zone.is_consolidation` off what the user actually picked instead of
  // re-looking it up in a filtered zones array that might miss it (see the
  // inactive-consolidation-zone case finding #3 covers).
  it('selecting another andén updates the confirm button and calls onConfirm with that full zone', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(<SendToDockSheet {...baseProps} onConfirm={onConfirm} />);
    await user.click(screen.getByTestId('send-to-dock-option-zone-b2'));
    const confirmBtn = screen.getByRole('button', { name: 'Enviar a B2' });
    await user.click(confirmBtn);
    expect(onConfirm).toHaveBeenCalledWith(otherZone);
  });

  it('Cancelar closes the sheet without confirming', async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    const onConfirm = vi.fn();
    render(<SendToDockSheet {...baseProps} onOpenChange={onOpenChange} onConfirm={onConfirm} />);
    await user.click(screen.getByRole('button', { name: /cancelar/i }));
    expect(onConfirm).not.toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('the whole sheet is absent — not disabled — when canUse is false', () => {
    render(<SendToDockSheet {...baseProps} canUse={false} />);
    expect(screen.queryByText('Enviar BULTO-1 a')).not.toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('renders nothing when there is no pending request', () => {
    render(<SendToDockSheet {...baseProps} request={null} />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('every option row and the footer buttons meet the touch floor', () => {
    render(<SendToDockSheet {...baseProps} />);
    for (const opt of screen.getAllByTestId(/^send-to-dock-option-/)) {
      expect(opt.className).toMatch(/min-h-\[?(4[4-9]|[5-9]\d)/);
    }
    const confirm = screen.getByRole('button', { name: 'Enviar a A1' });
    expect(confirm.className).toMatch(/h-\[?(5[6-9]|60)/);
  });

  // Finding #2 (Fase 3 review) — every unmapped-comuna or future-dated
  // package suggests consolidación itself (determineDockZone's fallback).
  // Before the fix, orderedZones appended consolidación again
  // unconditionally, producing a duplicate zone-cons row/key/testid, both
  // reading as selected.
  it('does not list consolidación twice when consolidación IS the suggested zone', () => {
    const consolidationRequest: SendToDockRequest = {
      packageIds: ['pkg-2'],
      packageLabels: ['BULTO-2'],
      code: 'BULTO-2',
      comunaName: null,
      suggestedZone: consolidationZone,
    };
    render(<SendToDockSheet {...baseProps} request={consolidationRequest} />);
    const matches = screen.getAllByTestId('send-to-dock-option-zone-cons');
    expect(matches).toHaveLength(1);
    expect(matches[0]).toHaveTextContent('SUGERIDO');
  });

  // Finding #3 (Fase 3 review) — the suggested zone can be inactive (the
  // sectorization engine's consolidation fallback doesn't filter on
  // is_active), so it may be absent from `activeZones`. The sheet must
  // still render it (from `request.suggestedZone`, now typed
  // DockZoneRecord end-to-end — no cast, no missing capacity/operator_id).
  it('still shows the suggested zone even when it is missing from activeZones (inactive consolidation case)', () => {
    const inactiveConsolidation = makeZone({
      id: 'zone-cons-inactive',
      code: 'CONS2',
      name: 'Consolidación Antigua',
      is_consolidation: true,
      is_active: false,
      capacity: null,
    });
    const req: SendToDockRequest = {
      packageIds: ['pkg-3'],
      packageLabels: ['BULTO-3'],
      code: 'BULTO-3',
      comunaName: null,
      suggestedZone: inactiveConsolidation,
    };
    // activeZones deliberately does NOT include inactiveConsolidation.
    render(<SendToDockSheet {...baseProps} request={req} activeZones={[suggestedZone, otherZone]} />);
    const suggested = screen.getByTestId('send-to-dock-option-zone-cons-inactive');
    expect(suggested).toHaveTextContent('SUGERIDO');
    expect(screen.getByRole('button', { name: 'Enviar a CONS2' })).toBeInTheDocument();
  });

  // Finding #7 (Fase 3 review) — isSuggested's className branch used to be
  // checked before isSelected, so after picking a different andén the
  // suggested row kept its accent border/fill and both rows read as chosen
  // at a glance. aria-pressed was already correct; this is the visible
  // affordance.
  it('once another andén is picked, only that row carries the selected styling — the suggested row reverts', async () => {
    const user = userEvent.setup();
    render(<SendToDockSheet {...baseProps} />);
    const suggested = screen.getByTestId('send-to-dock-option-zone-a1');
    const other = screen.getByTestId('send-to-dock-option-zone-b2');

    expect(suggested).toHaveAttribute('aria-pressed', 'true');
    await user.click(other);

    expect(other).toHaveAttribute('aria-pressed', 'true');
    expect(suggested).toHaveAttribute('aria-pressed', 'false');
    // The suggested row keeps its SUGERIDO badge/accent treatment (it IS
    // still the suggestion) but must not also read as selected.
    expect(other.className).not.toBe(suggested.className);
    expect(other.className).toMatch(/border-accent/);
  });

  // spec-68 Fase 4 review (finding #2) — a caller can bundle packages
  // whose comunas resolve to different andenes; `suggestedZone` then only
  // reflects the FIRST match. `mixedComunaBatch` stops the sheet from
  // claiming that pre-selection is comuna-justified for the whole batch.
  describe('mixedComunaBatch', () => {
    it('replaces the "sugerido X por comuna" subtitle with an explicit warning', () => {
      render(<SendToDockSheet {...baseProps} mixedComunaBatch />);
      expect(screen.queryByText(/sugerido A1 por comuna/i)).not.toBeInTheDocument();
      expect(screen.getByText(/comunas distintas/i)).toBeInTheDocument();
    });

    it('suppresses the SUGERIDO badge on the pre-selected zone', () => {
      render(<SendToDockSheet {...baseProps} mixedComunaBatch />);
      expect(screen.queryByText('SUGERIDO')).not.toBeInTheDocument();
    });

    it('still pre-selects the suggested zone as the default pick, just without the SUGERIDO framing', () => {
      render(<SendToDockSheet {...baseProps} mixedComunaBatch />);
      expect(screen.getByTestId('send-to-dock-option-zone-a1')).toHaveAttribute('aria-pressed', 'true');
      expect(screen.getByRole('button', { name: 'Enviar a A1' })).toBeInTheDocument();
    });

    it('defaults to false — the ordinary single-comuna flow is unaffected', () => {
      render(<SendToDockSheet {...baseProps} />);
      expect(screen.getByText(/sugerido A1 por comuna/i)).toBeInTheDocument();
      expect(screen.getByText('SUGERIDO')).toBeInTheDocument();
    });
  });
});
