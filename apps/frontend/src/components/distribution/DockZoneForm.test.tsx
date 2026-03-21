// apps/frontend/src/components/distribution/DockZoneForm.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DockZoneForm } from './DockZoneForm';

vi.mock('@/hooks/distribution/useDockZones', () => ({
  useCreateDockZone: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
  useUpdateDockZone: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
}));

describe('DockZoneForm', () => {
  it('renders form fields', () => {
    render(<DockZoneForm operatorId="op-1" onSuccess={() => {}} />);
    expect(screen.getByLabelText(/nombre/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/código/i)).toBeInTheDocument();
  });

  it('shows save button', () => {
    render(<DockZoneForm operatorId="op-1" onSuccess={() => {}} />);
    expect(screen.getByRole('button', { name: /guardar/i })).toBeInTheDocument();
  });

  it('renders comunas textarea', () => {
    render(<DockZoneForm operatorId="op-1" onSuccess={() => {}} />);
    expect(screen.getByLabelText(/comunas/i)).toBeInTheDocument();
  });

  it('populates form when editing existing zone', () => {
    const zone = { id: 'zone-1', name: 'Andén 1', code: 'DOCK-001', is_consolidation: false, comunas: ['las condes'], is_active: true, operator_id: 'op-1' };
    render(<DockZoneForm operatorId="op-1" onSuccess={() => {}} editingZone={zone} />);
    expect(screen.getByDisplayValue('Andén 1')).toBeInTheDocument();
    expect(screen.getByDisplayValue('DOCK-001')).toBeInTheDocument();
  });

  it('shows cancel button when onCancel is provided', () => {
    render(<DockZoneForm operatorId="op-1" onCancel={() => {}} />);
    expect(screen.getByRole('button', { name: /cancelar/i })).toBeInTheDocument();
  });

  it('does not show cancel button when onCancel is not provided', () => {
    render(<DockZoneForm operatorId="op-1" />);
    expect(screen.queryByRole('button', { name: /cancelar/i })).not.toBeInTheDocument();
  });

  it('calls onCancel when cancel button is clicked', () => {
    const onCancel = vi.fn();
    render(<DockZoneForm operatorId="op-1" onCancel={onCancel} />);
    fireEvent.click(screen.getByRole('button', { name: /cancelar/i }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
