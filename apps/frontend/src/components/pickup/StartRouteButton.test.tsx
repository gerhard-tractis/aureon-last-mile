import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const mockUseVehicles = vi.fn();
const mockCreateAsync = vi.fn();

vi.mock('@/hooks/pickup/useVehicles', async () => {
  const actual = await vi.importActual<typeof import('@/hooks/pickup/useVehicles')>(
    '@/hooks/pickup/useVehicles',
  );
  return {
    ...actual,
    useVehicles: (...args: unknown[]) => mockUseVehicles(...args),
    useCreateVehicle: () => ({ mutateAsync: mockCreateAsync, isPending: false }),
  };
});

import { StartRouteButton } from './StartRouteButton';

const ACTIVE = [
  { id: 'v-1', plate: 'AAA-111', vehicle_type: 'camion', active: true },
  { id: 'v-2', plate: 'BBB-222', vehicle_type: null, active: true },
];

function openDialog() {
  fireEvent.click(screen.getByTestId('start-route-button'));
}

describe('StartRouteButton', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseVehicles.mockReturnValue({ data: ACTIVE, isLoading: false });
    mockCreateAsync.mockResolvedValue({ id: 'v-new', plate: 'ABC-123' });
  });

  it('labels the vehicle field as required, not optional', () => {
    render(<StartRouteButton operatorId="op-1" onStart={() => {}} />);
    openDialog();

    expect(screen.queryByText(/opcional/i)).not.toBeInTheDocument();
    expect(screen.getByText(/Vehículo/)).toBeInTheDocument();
  });

  it('cannot be confirmed until a vehicle is selected', () => {
    const onStart = vi.fn();
    render(<StartRouteButton operatorId="op-1" onStart={onStart} />);
    openDialog();

    const confirm = screen.getByRole('button', { name: 'Iniciar' });
    expect(confirm).toBeDisabled();

    fireEvent.click(confirm);
    expect(onStart).not.toHaveBeenCalled();
  });

  it('passes the selected vehicle id up', async () => {
    const onStart = vi.fn();
    render(<StartRouteButton operatorId="op-1" onStart={onStart} />);
    openDialog();

    fireEvent.focus(screen.getByLabelText(/Vehículo/i));
    fireEvent.click(screen.getByRole('option', { name: /BBB-222/ }));

    const confirm = screen.getByRole('button', { name: 'Iniciar' });
    await waitFor(() => expect(confirm).not.toBeDisabled());
    fireEvent.click(confirm);

    expect(onStart).toHaveBeenCalledWith('v-2');
  });

  it('enables confirm after an inline plate registration', async () => {
    const onStart = vi.fn();
    render(<StartRouteButton operatorId="op-1" onStart={onStart} />);
    openDialog();

    const input = screen.getByLabelText(/Vehículo/i);
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'abc-123' } });
    fireEvent.click(screen.getByTestId('register-plate-button'));

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Iniciar' })).not.toBeDisabled(),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Iniciar' }));
    expect(onStart).toHaveBeenCalledWith('v-new');
  });

  it('disables the trigger when disabled prop set', () => {
    render(<StartRouteButton operatorId="op-1" onStart={() => {}} disabled />);
    expect(screen.getByTestId('start-route-button')).toBeDisabled();
  });

  // spec-95 fase 8 (mock 5a:224-225) — "Ver QR de la ruta" sits secondary
  // to "Iniciar ruta de retiro". No route exists yet at this point (the
  // panel is still BORRADOR) — Recogida.dc.html:222-223 draws it right next
  // to the primary CTA regardless, so it has to actually create the route,
  // same as the primary, and only differ in what happens after: the caller
  // learns which button was used via onStart's second argument. Anything
  // less would be exactly the drawn-but-unwired affordance the fase 9
  // review already paid for once.
  describe('«Ver QR de la ruta» (mock 5a:225)', () => {
    it('renders as a secondary action, distinct from the primary CTA', () => {
      render(<StartRouteButton operatorId="op-1" onStart={() => {}} />);
      expect(screen.getByTestId('view-route-qr-button')).toBeInTheDocument();
    });

    it('opens the same vehicle dialog', () => {
      render(<StartRouteButton operatorId="op-1" onStart={() => {}} />);
      fireEvent.click(screen.getByTestId('view-route-qr-button'));
      expect(screen.getByText(/Vehículo/)).toBeInTheDocument();
    });

    it('signals the QR intent to the caller on confirm, unlike the primary path', async () => {
      const onStart = vi.fn();
      render(<StartRouteButton operatorId="op-1" onStart={onStart} />);
      fireEvent.click(screen.getByTestId('view-route-qr-button'));

      fireEvent.focus(screen.getByLabelText(/Vehículo/i));
      fireEvent.click(screen.getByRole('option', { name: /BBB-222/ }));

      const confirm = screen.getByRole('button', { name: 'Iniciar' });
      await waitFor(() => expect(confirm).not.toBeDisabled());
      fireEvent.click(confirm);

      expect(onStart).toHaveBeenCalledWith('v-2', true);
    });

    it('still signals no QR intent from the primary CTA', async () => {
      const onStart = vi.fn();
      render(<StartRouteButton operatorId="op-1" onStart={onStart} />);
      openDialog();

      fireEvent.focus(screen.getByLabelText(/Vehículo/i));
      fireEvent.click(screen.getByRole('option', { name: /BBB-222/ }));

      const confirm = screen.getByRole('button', { name: 'Iniciar' });
      await waitFor(() => expect(confirm).not.toBeDisabled());
      fireEvent.click(confirm);

      // Exactly one argument — the pre-existing contract every other test
      // in this file already pins with `toHaveBeenCalledWith('v-2')`.
      expect(onStart).toHaveBeenCalledWith('v-2');
    });

    it('disables the QR trigger too when disabled prop set', () => {
      render(<StartRouteButton operatorId="op-1" onStart={() => {}} disabled />);
      expect(screen.getByTestId('view-route-qr-button')).toBeDisabled();
    });
  });
});
