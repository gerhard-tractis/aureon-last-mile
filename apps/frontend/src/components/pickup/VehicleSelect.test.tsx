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

  // spec-95 fase 4 — el selector de `5b` dibuja un ícono de camión y un
  // chevron dentro del propio disparador (no sólo en las filas de la lista).
  it('shows a truck icon and a chevron on the trigger itself', () => {
    render(<VehicleSelect operatorId="op-1" value={null} onChange={() => {}} />);
    expect(screen.getByTestId('vehicle-select-truck-icon')).toBeInTheDocument();
    expect(screen.getByTestId('vehicle-select-chevron-icon')).toBeInTheDocument();
  });

  // spec-95 fase 4 — "sin preselección": el mock ya no muestra una patente
  // elegida de entrada. `value` null es la única entrada honesta de este
  // componente para ese estado — cubierto aquí para que un futuro default
  // (p.ej. "la primera de la lista") falle en este mismo test.
  it('renders no plate selected when value is null, never a default', () => {
    render(<VehicleSelect operatorId="op-1" value={null} onChange={() => {}} />);
    expect(screen.getByLabelText(/Vehículo/i)).toHaveValue('');
  });

  // Review round 1 (spec-95 fase 4) — "presencia" no bastaba: un icono
  // presente pero sin `pointer-events-none` se come el tap, y sin
  // `pl-10 pr-10` el placeholder "Patente" se dibuja debajo del camión en
  // 390px. jsdom no calcula geometría, pero className y aria-hidden sí son
  // asertables por atributo, y CrewSelect.test.tsx:142 ya sentó el
  // precedente de asertar className por esta misma razón.
  it('keeps the decorative truck icon out of hit-testing and the a11y tree', () => {
    render(<VehicleSelect operatorId="op-1" value={null} onChange={() => {}} />);
    const truck = screen.getByTestId('vehicle-select-truck-icon');
    expect(truck.getAttribute('aria-hidden')).toBe('true');
    expect(truck.getAttribute('class')).toContain('pointer-events-none');
  });

  it('pads the input so the truck and chevron never overlap the typed plate', () => {
    render(<VehicleSelect operatorId="op-1" value={null} onChange={() => {}} />);
    expect(screen.getByLabelText(/Vehículo/i).className).toContain('pl-10');
    expect(screen.getByLabelText(/Vehículo/i).className).toContain('pr-10');
  });

  // The chevron itself IS interactive (it toggles the list, see below), so
  // only the truck is checked for pointer-events-none above; asserting it
  // here too would just restate the same fact for a different element.
  it('opens the list on focus and closes it on a chevron click, not a dead affordance', () => {
    render(<VehicleSelect operatorId="op-1" value={null} onChange={() => {}} />);
    const input = screen.getByLabelText(/Vehículo/i);

    fireEvent.focus(input);
    expect(screen.getByRole('listbox')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /patentes/i }));
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /patentes/i }));
    expect(screen.getByRole('listbox')).toBeInTheDocument();
  });

  it('closes the list on Escape without requiring a selection', () => {
    render(<VehicleSelect operatorId="op-1" value={null} onChange={() => {}} />);
    const input = screen.getByLabelText(/Vehículo/i);

    fireEvent.focus(input);
    expect(screen.getByRole('listbox')).toBeInTheDocument();

    fireEvent.keyDown(input, { key: 'Escape' });
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });
});
