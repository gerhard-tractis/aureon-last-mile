import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import AuditLogTable from './AuditLogTable';

const mockLogs = [
  {
    id: 'e-1',
    operator_id: 'op-1',
    user_id: 'u-1',
    action: 'UPDATE',
    resource_type: 'orders',
    resource_id: 'order-123',
    changes_json: { before: { status: 'ingresado' }, after: { status: 'verificado' } },
    ip_address: '10.0.0.1',
    timestamp: '2026-03-13T14:23:00.000Z',
  },
  {
    id: 'e-2',
    operator_id: 'op-1',
    user_id: 'u-2',
    action: 'INSERT',
    resource_type: 'packages',
    resource_id: 'pkg-456',
    changes_json: { after: { weight: 2.5 } },
    ip_address: null,
    timestamp: '2026-03-12T09:00:00.000Z',
  },
];

const mockUserMap = { 'u-1': 'Alice', 'u-2': 'Bob' };

describe('AuditLogTable', () => {
  it('renders table headers', () => {
    render(
      <AuditLogTable
        logs={mockLogs}
        count={2}
        page={1}
        pageSize={50}
        onPageChange={vi.fn()}
        onSortChange={vi.fn()}
        sortColumn="timestamp"
        sortDirection="desc"
        userMap={mockUserMap}
        isLoading={false}
      />
    );
    expect(screen.getByText(/fecha/i)).toBeDefined();
    expect(screen.getByText(/usuario/i)).toBeDefined();
    expect(screen.getByText(/acción/i)).toBeDefined();
    expect(screen.getByText(/recurso/i)).toBeDefined();
  });

  it('renders log rows', () => {
    render(
      <AuditLogTable
        logs={mockLogs}
        count={2}
        page={1}
        pageSize={50}
        onPageChange={vi.fn()}
        onSortChange={vi.fn()}
        sortColumn="timestamp"
        sortDirection="desc"
        userMap={mockUserMap}
        isLoading={false}
      />
    );
    expect(screen.getByText('UPDATE')).toBeDefined();
    expect(screen.getByText('INSERT')).toBeDefined();
    expect(screen.getByText('order-123')).toBeDefined();
  });

  it('shows loading skeleton when isLoading is true', () => {
    render(
      <AuditLogTable
        logs={[]}
        count={0}
        page={1}
        pageSize={50}
        onPageChange={vi.fn()}
        onSortChange={vi.fn()}
        sortColumn="timestamp"
        sortDirection="desc"
        userMap={{}}
        isLoading={true}
      />
    );
    expect(screen.getAllByRole('status').length).toBeGreaterThan(0);
  });

  it('shows empty state when no logs', () => {
    render(
      <AuditLogTable
        logs={[]}
        count={0}
        page={1}
        pageSize={50}
        onPageChange={vi.fn()}
        onSortChange={vi.fn()}
        sortColumn="timestamp"
        sortDirection="desc"
        userMap={{}}
        isLoading={false}
      />
    );
    expect(screen.getByText(/no se encontraron registros/i)).toBeDefined();
  });

  it('renders pagination info', () => {
    render(
      <AuditLogTable
        logs={mockLogs}
        count={100}
        page={1}
        pageSize={50}
        onPageChange={vi.fn()}
        onSortChange={vi.fn()}
        sortColumn="timestamp"
        sortDirection="desc"
        userMap={mockUserMap}
        isLoading={false}
      />
    );
    expect(screen.getByText(/página 1 de 2/i)).toBeDefined();
  });

  it('calls onPageChange when next page button is clicked', () => {
    const onPageChange = vi.fn();
    render(
      <AuditLogTable
        logs={mockLogs}
        count={100}
        page={1}
        pageSize={50}
        onPageChange={onPageChange}
        onSortChange={vi.fn()}
        sortColumn="timestamp"
        sortDirection="desc"
        userMap={mockUserMap}
        isLoading={false}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: /siguiente/i }));
    expect(onPageChange).toHaveBeenCalledWith(2);
  });

  it('expands row detail on expand button click', () => {
    render(
      <AuditLogTable
        logs={mockLogs}
        count={2}
        page={1}
        pageSize={50}
        onPageChange={vi.fn()}
        onSortChange={vi.fn()}
        sortColumn="timestamp"
        sortDirection="desc"
        userMap={mockUserMap}
        isLoading={false}
      />
    );
    const expandButtons = screen.getAllByRole('button', { name: /detalle/i });
    fireEvent.click(expandButtons[0]);
    // After expanding, detail row renders
    expect(screen.getByText(/before/i)).toBeDefined();
  });
});
