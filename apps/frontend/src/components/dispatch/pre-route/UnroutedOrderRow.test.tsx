import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { UnroutedOrderRow } from './UnroutedOrderRow';
import type { UnroutedOrderRow as OrderRow } from '@/hooks/dispatch/pre-route/useUnroutedGroups';
import * as useOrderPackagesModule from '@/hooks/dispatch/pre-route/useOrderPackages';

vi.mock('@/hooks/useOperatorId', () => ({
  useOperatorId: () => ({ operatorId: 'op-1' }),
}));

const ORDER: OrderRow = {
  id: 'o1',
  orderNumber: 'ORD-48177',
  comunaName: 'Calera de Tango',
  address: 'Camino Real 123',
  packageCount: 3,
  windowStart: '08:00:00',
  windowEnd: '12:00:00',
  hasSplitDockZone: false,
};

const BASE = {
  order: ORDER,
  selected: false,
  onToggle: () => {},
};

function mockPackages(result: Partial<ReturnType<typeof useOrderPackagesModule.useOrderPackages>>) {
  vi.spyOn(useOrderPackagesModule, 'useOrderPackages').mockReturnValue(
    result as ReturnType<typeof useOrderPackagesModule.useOrderPackages>,
  );
}

describe('UnroutedOrderRow', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows the order, comuna, address, package count and window', () => {
    render(<UnroutedOrderRow {...BASE} />);
    expect(screen.getByText('ORD-48177')).toBeInTheDocument();
    expect(screen.getByText('Calera de Tango')).toBeInTheDocument();
    expect(screen.getByText('Camino Real 123')).toBeInTheDocument();
    expect(screen.getByTestId('unrouted-order-package-count-o1')).toHaveTextContent('3');
    expect(screen.getByText('08:00–12:00')).toBeInTheDocument();
  });

  it('makes the whole row a click target for selection', async () => {
    const onToggle = vi.fn();
    render(<UnroutedOrderRow {...BASE} onToggle={onToggle} />);
    await userEvent.click(screen.getByText('ORD-48177'));
    expect(onToggle).toHaveBeenCalledWith('o1');
  });

  it('exposes the checkbox as a real, independently focusable control', () => {
    render(<UnroutedOrderRow {...BASE} selected />);
    const checkbox = screen.getByTestId('unrouted-order-o1');
    expect(checkbox.tagName).toBe('BUTTON');
    expect(checkbox).toHaveAttribute('role', 'checkbox');
    expect(checkbox).toHaveAttribute('aria-checked', 'true');
  });

  it('toggles selection once — not twice — when the checkbox itself is clicked', async () => {
    const onToggle = vi.fn();
    render(<UnroutedOrderRow {...BASE} onToggle={onToggle} />);
    await userEvent.click(screen.getByTestId('unrouted-order-o1'));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it('toggles selection with Space on the focused checkbox', async () => {
    const onToggle = vi.fn();
    render(<UnroutedOrderRow {...BASE} onToggle={onToggle} />);
    const checkbox = screen.getByTestId('unrouted-order-o1');
    checkbox.focus();
    await userEvent.keyboard(' ');
    expect(onToggle).toHaveBeenCalledWith('o1');
  });

  it('is collapsed by default and renders no package panel', () => {
    render(<UnroutedOrderRow {...BASE} />);
    expect(screen.queryByTestId('order-packages-loading')).toBeNull();
  });

  it('expands with a click on the chevron, without touching selection', async () => {
    mockPackages({ data: [], isLoading: false, isError: false });
    const onToggle = vi.fn();
    render(<UnroutedOrderRow {...BASE} onToggle={onToggle} />);
    await userEvent.click(screen.getByRole('button', { name: /expandir/i }));
    expect(onToggle).not.toHaveBeenCalled();
    expect(screen.getByText(/Sin paquetes/)).toBeInTheDocument();
  });

  it('expands with Enter on the focused chevron, without deselecting the row', async () => {
    // Regression for the Critical 1 bug: Enter on the chevron used to bubble
    // into the row's own keydown handler, which both cancelled the button's
    // native activation (so nothing expanded) and toggled selection instead.
    mockPackages({ data: [], isLoading: false, isError: false });
    const onToggle = vi.fn();
    render(<UnroutedOrderRow {...BASE} onToggle={onToggle} />);
    const chevron = screen.getByRole('button', { name: /expandir/i });
    chevron.focus();
    await userEvent.keyboard('{Enter}');
    expect(onToggle).not.toHaveBeenCalled();
    expect(screen.getByText(/Sin paquetes/)).toBeInTheDocument();
  });

  it('sets aria-expanded and aria-controls on the chevron, pointing at the packages panel', () => {
    mockPackages({ data: [], isLoading: false, isError: false });
    render(<UnroutedOrderRow {...BASE} />);
    const chevron = screen.getByRole('button', { name: /expandir/i });
    expect(chevron).toHaveAttribute('aria-expanded', 'false');
    expect(chevron).toHaveAttribute('aria-controls', 'unrouted-order-packages-o1');
  });

  it('threads a failed fetch through to the expanded panel', async () => {
    mockPackages({ data: undefined, isLoading: false, isError: true });
    render(<UnroutedOrderRow {...BASE} />);
    await userEvent.click(screen.getByRole('button', { name: /expandir/i }));
    expect(screen.getByText(/No se pudieron cargar los paquetes/)).toBeInTheDocument();
  });

  it('flags an order split across dock zones', () => {
    render(<UnroutedOrderRow {...BASE} order={{ ...ORDER, hasSplitDockZone: true }} />);
    expect(screen.getByLabelText(/varios andenes/i)).toBeInTheDocument();
  });

  it('shows a placeholder window when the order has none', () => {
    render(<UnroutedOrderRow {...BASE} order={{ ...ORDER, windowStart: null, windowEnd: null }} />);
    expect(screen.getByText('Sin ventana')).toBeInTheDocument();
  });

  it('still renders the address in full when the comuna name is very long', () => {
    const longComuna = 'A'.repeat(60);
    render(<UnroutedOrderRow {...BASE} order={{ ...ORDER, comunaName: longComuna, address: 'Dirección Corta 1' }} />);
    expect(screen.getByText(longComuna)).toBeInTheDocument();
    expect(screen.getByText('Dirección Corta 1')).toBeInTheDocument();
  });

  it('renders the window without the urgency style by default', () => {
    render(<UnroutedOrderRow {...BASE} />);
    expect(screen.getByTestId('unrouted-order-window-o1')).not.toHaveClass('bg-status-error-bg');
  });

  it('marks the window urgent (red) when urgent is true', () => {
    render(<UnroutedOrderRow {...BASE} urgent />);
    expect(screen.getByTestId('unrouted-order-window-o1')).toHaveClass('bg-status-error-bg');
  });

  it('does not add a focusable control for the urgency chip', () => {
    // Regression guard: the chip must stay a plain <span>, never a
    // role-bearing or focusable element nested in the row.
    render(<UnroutedOrderRow {...BASE} urgent />);
    const chip = screen.getByTestId('unrouted-order-window-o1');
    expect(chip.tagName).toBe('SPAN');
    expect(chip).not.toHaveAttribute('role');
  });

  it('carries the urgency in text, not just colour (I8 / WCAG 1.4.1)', () => {
    render(<UnroutedOrderRow {...BASE} urgent />);
    expect(screen.getByText('Ventana más próxima a cerrar')).toBeInTheDocument();
  });

  it('renders no urgency text when not urgent', () => {
    render(<UnroutedOrderRow {...BASE} />);
    expect(screen.queryByText('Ventana más próxima a cerrar')).toBeNull();
  });
});
