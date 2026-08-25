import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { DockZoneForm } from './DockZoneForm';
import { useCreateDockZone, useUpdateDockZone } from '@/hooks/distribution/useDockZones';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

// Mock mutations
const mockCreate = vi.fn();
const mockUpdate = vi.fn();

vi.mock('@/hooks/distribution/useDockZones', () => ({
  useCreateDockZone: vi.fn(),
  useUpdateDockZone: vi.fn(),
}));

// Mock useChileComunas
vi.mock('@/hooks/distribution/useChileComunas', () => ({
  useChileComunas: vi.fn(() => ({
    data: [
      { id: 'c1', nombre: 'Las Condes',  region: 'Metropolitana de Santiago', region_num: 13 },
      { id: 'c2', nombre: 'Providencia', region: 'Metropolitana de Santiago', region_num: 13 },
      { id: 'c3', nombre: 'Vitacura',    region: 'Metropolitana de Santiago', region_num: 13 },
    ],
    isLoading: false,
  })),
}));

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return React.createElement(QueryClientProvider, { client: qc }, children);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(useCreateDockZone).mockReturnValue({
    mutate: mockCreate, isPending: false, isError: false, error: null,
  } as unknown as ReturnType<typeof useCreateDockZone>);
  vi.mocked(useUpdateDockZone).mockReturnValue({
    mutate: mockUpdate, isPending: false, isError: false, error: null,
  } as unknown as ReturnType<typeof useUpdateDockZone>);
});

describe('DockZoneForm', () => {
  it('renders name and code inputs', () => {
    render(<DockZoneForm operatorId="op1" />, { wrapper });
    expect(screen.getByLabelText(/nombre/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/código/i)).toBeInTheDocument();
  });

  it('does NOT render the old textarea (una por línea)', () => {
    render(<DockZoneForm operatorId="op1" />, { wrapper });
    expect(screen.queryByPlaceholderText(/una por línea/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/una por línea/i)).not.toBeInTheDocument();
  });

  it('renders a commune search input (combobox)', () => {
    render(<DockZoneForm operatorId="op1" />, { wrapper });
    expect(screen.getByPlaceholderText(/buscar comuna/i)).toBeInTheDocument();
  });

  it('shows commune options in the list', () => {
    render(<DockZoneForm operatorId="op1" />, { wrapper });
    expect(screen.getByText('Las Condes')).toBeInTheDocument();
    expect(screen.getByText('Providencia')).toBeInTheDocument();
  });

  it('selecting a commune adds it as a chip', async () => {
    render(<DockZoneForm operatorId="op1" />, { wrapper });
    fireEvent.click(screen.getByText('Las Condes'));
    await waitFor(() => {
      expect(screen.getAllByText('Las Condes').length).toBeGreaterThan(0);
    });
  });

  it('shows save button', () => {
    render(<DockZoneForm operatorId="op1" onSuccess={() => {}} />, { wrapper });
    expect(screen.getByRole('button', { name: /guardar/i })).toBeInTheDocument();
  });

  it('shows cancel button when onCancel is provided', () => {
    render(<DockZoneForm operatorId="op1" onCancel={() => {}} />, { wrapper });
    expect(screen.getByRole('button', { name: /cancelar/i })).toBeInTheDocument();
  });

  it('does not show cancel button when onCancel is not provided', () => {
    render(<DockZoneForm operatorId="op1" />, { wrapper });
    expect(screen.queryByRole('button', { name: /cancelar/i })).not.toBeInTheDocument();
  });

  it('calls onCancel when cancel button is clicked', () => {
    const onCancel = vi.fn();
    render(<DockZoneForm operatorId="op1" onCancel={onCancel} />, { wrapper });
    fireEvent.click(screen.getByRole('button', { name: /cancelar/i }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('submits with comunaIds (not comunas string array) on create', async () => {
    render(<DockZoneForm operatorId="op1" />, { wrapper });

    fireEvent.change(screen.getByLabelText(/nombre/i), { target: { value: 'Andén 1' } });
    fireEvent.change(screen.getByLabelText(/código/i), { target: { value: 'DOCK-001' } });

    fireEvent.click(screen.getByText('Las Condes'));

    fireEvent.click(screen.getByRole('button', { name: /guardar/i }));

    await waitFor(() => {
      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({ comunaIds: ['c1'] }),
        expect.anything()
      );
    });
  });

  it('in edit mode, pre-populates selected communes from editingZone.comunas[].id', async () => {
    const editingZone = {
      id: 'z1', name: 'Andén Existing', code: 'EX-001',
      is_consolidation: false, is_active: true, operator_id: 'op1', capacity: null,
      comunas: [{ id: 'c2', nombre: 'Providencia' }],
    };
    render(<DockZoneForm operatorId="op1" editingZone={editingZone} />, { wrapper });
    await waitFor(() => {
      expect(screen.getAllByText('Providencia').length).toBeGreaterThan(0);
    });
  });

  it('populates name and code when editing existing zone', () => {
    const editingZone = {
      id: 'z1', name: 'Andén 1', code: 'DOCK-001',
      is_consolidation: false, is_active: true, operator_id: 'op1', capacity: null,
      comunas: [],
    };
    render(<DockZoneForm operatorId="op1" editingZone={editingZone} />, { wrapper });
    expect(screen.getByDisplayValue('Andén 1')).toBeInTheDocument();
    expect(screen.getByDisplayValue('DOCK-001')).toBeInTheDocument();
  });

  it('calls updateMutation with comunaIds in edit mode', async () => {
    const editingZone = {
      id: 'z1', name: 'Andén Existing', code: 'EX-001',
      is_consolidation: false, is_active: true, operator_id: 'op1', capacity: null,
      comunas: [{ id: 'c2', nombre: 'Providencia' }],
    };
    render(<DockZoneForm operatorId="op1" editingZone={editingZone} />, { wrapper });
    fireEvent.click(screen.getByRole('button', { name: /guardar/i }));
    await waitFor(() => {
      expect(mockUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'z1', comunaIds: ['c2'] }),
        expect.anything()
      );
    });
  });

  it('renders an optional capacity field labelled "Capacidad (paquetes)"', () => {
    render(<DockZoneForm operatorId="op1" />, { wrapper });
    const field = screen.getByLabelText(/capacidad \(paquetes\)/i);
    expect(field).toBeInTheDocument();
    expect(field).not.toBeRequired();
  });

  it('submits capacity null when the capacity field is left empty', async () => {
    render(<DockZoneForm operatorId="op1" />, { wrapper });
    fireEvent.change(screen.getByLabelText(/nombre/i), { target: { value: 'Andén 1' } });
    fireEvent.change(screen.getByLabelText(/código/i), { target: { value: 'DOCK-001' } });
    fireEvent.click(screen.getByRole('button', { name: /guardar/i }));
    await waitFor(() => {
      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({ capacity: null }),
        expect.anything()
      );
    });
  });

  it('submits the entered numeric capacity', async () => {
    render(<DockZoneForm operatorId="op1" />, { wrapper });
    fireEvent.change(screen.getByLabelText(/nombre/i), { target: { value: 'Andén 1' } });
    fireEvent.change(screen.getByLabelText(/código/i), { target: { value: 'DOCK-001' } });
    fireEvent.change(screen.getByLabelText(/capacidad \(paquetes\)/i), { target: { value: '180' } });
    fireEvent.click(screen.getByRole('button', { name: /guardar/i }));
    await waitFor(() => {
      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({ capacity: 180 }),
        expect.anything()
      );
    });
  });

  it('pre-populates capacity when editing an existing zone that has one', () => {
    const editingZone = {
      id: 'z1', name: 'Andén 1', code: 'DOCK-001',
      is_consolidation: false, is_active: true, operator_id: 'op1', capacity: 180,
      comunas: [],
    };
    render(<DockZoneForm operatorId="op1" editingZone={editingZone} />, { wrapper });
    expect(screen.getByDisplayValue('180')).toBeInTheDocument();
  });

  it('leaves the capacity field empty when editing a zone with no capacity configured', () => {
    const editingZone = {
      id: 'z1', name: 'Andén 1', code: 'DOCK-001',
      is_consolidation: false, is_active: true, operator_id: 'op1', capacity: null,
      comunas: [],
    };
    render(<DockZoneForm operatorId="op1" editingZone={editingZone} />, { wrapper });
    const field = screen.getByLabelText(/capacidad \(paquetes\)/i) as HTMLInputElement;
    expect(field.value).toBe('');
  });

  // Regression: capacity 0/negative pre-populated verbatim, combined with the
  // field's min={1}, made the WHOLE form unsubmittable via native
  // rangeUnderflow — a DBA-set 0/-1 zone couldn't even be renamed. The form
  // must normalize <= 0 to empty on load, same as dock-capacity.ts treats it.
  it('normalizes a zone with capacity 0 to an empty field on edit (not "0")', () => {
    const editingZone = {
      id: 'z1', name: 'Andén 1', code: 'DOCK-001',
      is_consolidation: false, is_active: true, operator_id: 'op1', capacity: 0,
      comunas: [],
    };
    render(<DockZoneForm operatorId="op1" editingZone={editingZone} />, { wrapper });
    const field = screen.getByLabelText(/capacidad \(paquetes\)/i) as HTMLInputElement;
    expect(field.value).toBe('');
  });

  it('normalizes a zone with negative capacity to an empty field on edit', () => {
    const editingZone = {
      id: 'z1', name: 'Andén 1', code: 'DOCK-001',
      is_consolidation: false, is_active: true, operator_id: 'op1', capacity: -1,
      comunas: [],
    };
    render(<DockZoneForm operatorId="op1" editingZone={editingZone} />, { wrapper });
    const field = screen.getByLabelText(/capacidad \(paquetes\)/i) as HTMLInputElement;
    expect(field.value).toBe('');
  });

  it('caps the capacity field at a Postgres int4 (2147483647)', () => {
    render(<DockZoneForm operatorId="op1" />, { wrapper });
    const field = screen.getByLabelText(/capacidad \(paquetes\)/i) as HTMLInputElement;
    expect(field.max).toBe('2147483647');
  });

  it('shows an inline error when the create mutation fails (e.g. out-of-range capacity)', () => {
    vi.mocked(useCreateDockZone).mockReturnValue({
      mutate: mockCreate,
      isPending: false,
      isError: true,
      error: new Error('El valor está fuera de rango'),
    } as unknown as ReturnType<typeof useCreateDockZone>);
    render(<DockZoneForm operatorId="op1" />, { wrapper });
    expect(screen.getByText(/no se pudo guardar/i)).toBeInTheDocument();
  });

  it('shows an inline error when the update mutation fails', () => {
    vi.mocked(useUpdateDockZone).mockReturnValue({
      mutate: mockUpdate,
      isPending: false,
      isError: true,
      error: new Error('El valor está fuera de rango'),
    } as unknown as ReturnType<typeof useUpdateDockZone>);
    const editingZone = {
      id: 'z1', name: 'Andén 1', code: 'DOCK-001',
      is_consolidation: false, is_active: true, operator_id: 'op1', capacity: null,
      comunas: [],
    };
    render(<DockZoneForm operatorId="op1" editingZone={editingZone} />, { wrapper });
    expect(screen.getByText(/no se pudo guardar/i)).toBeInTheDocument();
  });

  it('shows no inline error when neither mutation is in an error state', () => {
    render(<DockZoneForm operatorId="op1" />, { wrapper });
    expect(screen.queryByText(/no se pudo guardar/i)).not.toBeInTheDocument();
  });
});
