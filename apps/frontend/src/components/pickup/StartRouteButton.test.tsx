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
});
