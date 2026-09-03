import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DispatchVehiclePickerRow } from './DispatchVehiclePickerRow';
import type { VehiclePickerRow } from '@/lib/dispatch/mobile/vehicle-picker';

function makeRow(overrides: Partial<VehiclePickerRow>): VehiclePickerRow {
  return {
    id: 'v1',
    externalVehicleId: 'RTHK-72',
    plateNumber: 'RTHK-72',
    vehicleType: 'Camión 3/4',
    driverName: 'Mario González',
    capacityPackages: 240,
    assignable: true,
    blockReason: null,
    blockedByRouteCode: null,
    ...overrides,
  };
}

describe('DispatchVehiclePickerRow', () => {
  it('renders an assignable vehicle as a native radio control', () => {
    const onSelect = vi.fn();
    render(<DispatchVehiclePickerRow row={makeRow({})} selected={false} onSelect={onSelect} />);
    const radio = screen.getByRole('radio', { name: /RTHK-72/i });
    expect(radio).toBeInTheDocument();
    fireEvent.click(radio);
    expect(onSelect).toHaveBeenCalledWith('v1');
  });

  it('shows capacity as "type · N pqt"', () => {
    render(<DispatchVehiclePickerRow row={makeRow({ vehicleType: 'Camión 3/4', capacityPackages: 240 })} selected={false} onSelect={vi.fn()} />);
    expect(screen.getByText(/Camión 3\/4 · 240 pqt/)).toBeInTheDocument();
  });

  it('a blocked vehicle is visible but NOT exposed as a button or radio (Lecciones aplicadas #4)', () => {
    const onSelect = vi.fn();
    render(
      <DispatchVehiclePickerRow
        row={makeRow({ assignable: false, blockReason: 'blocked', blockedByRouteCode: 'RUT-0088' })}
        selected={false}
        onSelect={onSelect}
      />,
    );
    expect(screen.queryByRole('radio')).not.toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.getByText('EN RUT-0088')).toBeInTheDocument();
  });

  it('a vehicle with no capacity configured is visible, not assignable, and never draws a bar', () => {
    render(
      <DispatchVehiclePickerRow
        row={makeRow({ assignable: false, blockReason: 'no_capacity', capacityPackages: null })}
        selected={false}
        onSelect={vi.fn()}
      />,
    );
    expect(screen.queryByRole('radio')).not.toBeInTheDocument();
    expect(screen.getByText('Sin capacidad configurada')).toBeInTheDocument();
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
  });

  it('reflects the selected state via aria-checked', () => {
    render(<DispatchVehiclePickerRow row={makeRow({})} selected onSelect={vi.fn()} />);
    expect(screen.getByRole('radio')).toHaveAttribute('aria-checked', 'true');
  });
});
