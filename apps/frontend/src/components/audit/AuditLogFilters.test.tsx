import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import AuditLogFilters from './AuditLogFilters';

const mockUsers = [
  { id: 'u-1', email: 'alice@example.com', full_name: 'Alice' },
  { id: 'u-2', email: 'bob@example.com', full_name: 'Bob' },
];

const defaultFilters = {
  datePreset: '7d' as const,
  userId: undefined,
  actionType: 'ALL' as const,
  resourceType: 'all',
  search: '',
};

describe('AuditLogFilters', () => {
  it('renders date preset selector with default value', () => {
    const onFiltersChange = vi.fn();
    render(
      <AuditLogFilters
        filters={defaultFilters}
        onFiltersChange={onFiltersChange}
        users={mockUsers}
        usersLoading={false}
      />
    );
    // The date preset select should have the "7d" value selected
    const selects = screen.getAllByRole('combobox');
    expect(selects.length).toBeGreaterThan(0);
    const dateSelect = selects[0] as HTMLSelectElement;
    expect(dateSelect.value).toBe('7d');
  });

  it('renders action type filter', () => {
    const onFiltersChange = vi.fn();
    render(
      <AuditLogFilters
        filters={defaultFilters}
        onFiltersChange={onFiltersChange}
        users={mockUsers}
        usersLoading={false}
      />
    );
    expect(screen.getByText(/acción/i)).toBeDefined();
  });

  it('renders resource type filter', () => {
    const onFiltersChange = vi.fn();
    render(
      <AuditLogFilters
        filters={defaultFilters}
        onFiltersChange={onFiltersChange}
        users={mockUsers}
        usersLoading={false}
      />
    );
    // Check the label text "Recurso" is present (there may be multiple matches — use getAllByText)
    const labels = screen.getAllByText(/recurso/i);
    expect(labels.length).toBeGreaterThan(0);
  });

  it('renders search input', () => {
    const onFiltersChange = vi.fn();
    render(
      <AuditLogFilters
        filters={defaultFilters}
        onFiltersChange={onFiltersChange}
        users={mockUsers}
        usersLoading={false}
      />
    );
    expect(screen.getByPlaceholderText(/buscar/i)).toBeDefined();
  });

  it('calls onFiltersChange when search input changes', () => {
    const onFiltersChange = vi.fn();
    render(
      <AuditLogFilters
        filters={defaultFilters}
        onFiltersChange={onFiltersChange}
        users={mockUsers}
        usersLoading={false}
      />
    );
    const searchInput = screen.getByPlaceholderText(/buscar/i);
    fireEvent.change(searchInput, { target: { value: 'order-123' } });
    expect(onFiltersChange).toHaveBeenCalled();
  });

  it('renders clear all filters button', () => {
    const onFiltersChange = vi.fn();
    render(
      <AuditLogFilters
        filters={defaultFilters}
        onFiltersChange={onFiltersChange}
        users={mockUsers}
        usersLoading={false}
      />
    );
    expect(screen.getByRole('button', { name: /limpiar/i })).toBeDefined();
  });

  it('calls onFiltersChange with reset values when clear is clicked', () => {
    const onFiltersChange = vi.fn();
    render(
      <AuditLogFilters
        filters={{ ...defaultFilters, search: 'abc', actionType: 'UPDATE' }}
        onFiltersChange={onFiltersChange}
        users={mockUsers}
        usersLoading={false}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: /limpiar/i }));
    expect(onFiltersChange).toHaveBeenCalledWith(expect.objectContaining({
      search: '',
      actionType: 'ALL',
    }));
  });
});
