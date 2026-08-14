import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const mockUseVehicles = vi.fn();
const mockCreateAsync = vi.fn();
const mockUseCreateVehicle = vi.fn();

vi.mock('@/hooks/pickup/useVehicles', async () => {
  const actual = await vi.importActual<typeof import('@/hooks/pickup/useVehicles')>(
    '@/hooks/pickup/useVehicles',
  );
  return {
    ...actual,
    useVehicles: (...args: unknown[]) => mockUseVehicles(...args),
    useCreateVehicle: (...args: unknown[]) => mockUseCreateVehicle(...args),
  };
});

import { VehicleSelect } from './VehicleSelect';

const ACTIVE = [
  { id: 'v-1', plate: 'AAA-111', vehicle_type: 'camion', active: true },
  { id: 'v-2', plate: 'BBB-222', vehicle_type: null, active: true },
];

describe('VehicleSelect', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseVehicles.mockReturnValue({ data: ACTIVE, isLoading: false });
    mockCreateAsync.mockResolvedValue({ id: 'v-new', plate: 'ABC-123' });
    mockUseCreateVehicle.mockReturnValue({ mutateAsync: mockCreateAsync, isPending: false });
  });

  it('lists the active vehicles returned by the hook', () => {
    render(<VehicleSelect operatorId="op-1" value={null} onChange={() => {}} />);
    fireEvent.focus(screen.getByLabelText(/Vehículo/i));

    expect(screen.getByRole('option', { name: /AAA-111/ })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /BBB-222/ })).toBeInTheDocument();
  });

  it('selects an existing vehicle by id', () => {
    const onChange = vi.fn();
    render(<VehicleSelect operatorId="op-1" value={null} onChange={onChange} />);
    fireEvent.focus(screen.getByLabelText(/Vehículo/i));
    fireEvent.click(screen.getByRole('option', { name: /BBB-222/ }));

    expect(onChange).toHaveBeenCalledWith('v-2');
  });

  it('filters the list by the typed plate', () => {
    render(<VehicleSelect operatorId="op-1" value={null} onChange={() => {}} />);
    const input = screen.getByLabelText(/Vehículo/i);
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'bbb' } });

    expect(screen.queryByRole('option', { name: /AAA-111/ })).not.toBeInTheDocument();
    expect(screen.getByRole('option', { name: /BBB-222/ })).toBeInTheDocument();
  });

  it('offers inline creation only when the typed plate matches nothing', () => {
    render(<VehicleSelect operatorId="op-1" value={null} onChange={() => {}} />);
    const input = screen.getByLabelText(/Vehículo/i);
    fireEvent.focus(input);

    fireEvent.change(input, { target: { value: 'AAA-111' } });
    expect(screen.queryByTestId('register-plate-button')).not.toBeInTheDocument();

    fireEvent.change(input, { target: { value: 'abc-123' } });
    expect(screen.getByTestId('register-plate-button')).toBeInTheDocument();
  });

  it('inline creation inserts the normalized plate and selects the new vehicle', async () => {
    const onChange = vi.fn();
    render(<VehicleSelect operatorId="op-1" value={null} onChange={onChange} />);
    const input = screen.getByLabelText(/Vehículo/i);
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '  abc-123  ' } });

    fireEvent.click(screen.getByTestId('register-plate-button'));

    await waitFor(() => expect(mockCreateAsync).toHaveBeenCalledWith({ plate: 'ABC-123' }));
    await waitFor(() => expect(onChange).toHaveBeenCalledWith('v-new'));
  });

  it('refuses the reserved SIN-REGISTRO plate with a clear message and no insert', async () => {
    const onChange = vi.fn();
    render(<VehicleSelect operatorId="op-1" value={null} onChange={onChange} />);
    const input = screen.getByLabelText(/Vehículo/i);
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: ' sin-registro ' } });

    fireEvent.click(screen.getByTestId('register-plate-button'));

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(/patente reservada del sistema/i),
    );
    expect(mockCreateAsync).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('surfaces a creation failure instead of silently selecting nothing', async () => {
    mockCreateAsync.mockRejectedValue(new Error('duplicate key value'));
    const onChange = vi.fn();
    render(<VehicleSelect operatorId="op-1" value={null} onChange={onChange} />);
    const input = screen.getByLabelText(/Vehículo/i);
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'ccc-333' } });
    fireEvent.click(screen.getByTestId('register-plate-button'));

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/duplicate key/i));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('shows the plate of the currently selected vehicle', () => {
    render(<VehicleSelect operatorId="op-1" value="v-2" onChange={() => {}} />);
    expect(screen.getByLabelText(/Vehículo/i)).toHaveValue('BBB-222');
  });
});
