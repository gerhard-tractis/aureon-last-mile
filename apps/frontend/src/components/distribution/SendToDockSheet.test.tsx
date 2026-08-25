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

  it('selecting another andén updates the confirm button and calls onConfirm with its id', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(<SendToDockSheet {...baseProps} onConfirm={onConfirm} />);
    await user.click(screen.getByTestId('send-to-dock-option-zone-b2'));
    const confirmBtn = screen.getByRole('button', { name: 'Enviar a B2' });
    await user.click(confirmBtn);
    expect(onConfirm).toHaveBeenCalledWith('zone-b2');
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
});
