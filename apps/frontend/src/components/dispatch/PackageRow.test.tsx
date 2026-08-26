import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PackageRow } from './PackageRow';

const pkg = {
  dispatch_id: 'd1', order_id: 'o1', order_number: 'ORD-4821',
  contact_name: 'Mario González', contact_address: 'Providencia 123',
  contact_phone: null, package_status: 'en_carga' as const, stage: 'staged' as const,
};

describe('PackageRow', () => {
  it('renders order number and client name', () => {
    render(<PackageRow index={1} pkg={pkg} onRemove={vi.fn()} />);
    expect(screen.getByText('ORD-4821')).toBeInTheDocument();
    expect(screen.getByText('Mario González')).toBeInTheDocument();
  });

  it('calls onRemove with dispatch_id when remove button clicked', () => {
    const onRemove = vi.fn();
    render(<PackageRow index={1} pkg={pkg} onRemove={onRemove} />);
    fireEvent.click(screen.getByRole('button', { name: /eliminar/i }));
    expect(onRemove).toHaveBeenCalledWith('d1');
  });

  /**
   * spec-70 decision 4: the plan/load gap must be visible during loading, not
   * discovered only at the seal refusal.
   */
  it('marks a row still at stage=planned as not yet staged', () => {
    render(<PackageRow index={1} pkg={{ ...pkg, stage: 'planned' }} onRemove={vi.fn()} />);
    expect(screen.getByText(/sin estibar/i)).toBeInTheDocument();
  });

  it('does not show the unstaged marker for a staged row', () => {
    render(<PackageRow index={1} pkg={pkg} onRemove={vi.fn()} />);
    expect(screen.queryByText(/sin estibar/i)).not.toBeInTheDocument();
  });
});
