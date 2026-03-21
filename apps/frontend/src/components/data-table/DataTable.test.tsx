import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DataTable, type ColumnDef } from './DataTable';

interface TestRow {
  id: string;
  name: string;
  count: number;
}

const columns: ColumnDef<TestRow>[] = [
  { accessorKey: 'id', header: 'ID' },
  { accessorKey: 'name', header: 'Name' },
  { accessorKey: 'count', header: 'Count' },
];

const data: TestRow[] = [
  { id: 'ORD-1', name: 'Alice', count: 10 },
  { id: 'ORD-2', name: 'Bob', count: 20 },
  { id: 'ORD-3', name: 'Charlie', count: 30 },
];

describe('DataTable', () => {
  it('renders column headers', () => {
    render(<DataTable columns={columns} data={data} />);
    expect(screen.getByText('ID')).toBeInTheDocument();
    expect(screen.getByText('Name')).toBeInTheDocument();
    expect(screen.getByText('Count')).toBeInTheDocument();
  });

  it('renders all data rows', () => {
    render(<DataTable columns={columns} data={data} />);
    expect(screen.getByText('ORD-1')).toBeInTheDocument();
    expect(screen.getByText('Alice')).toBeInTheDocument();
    expect(screen.getByText('ORD-3')).toBeInTheDocument();
  });

  it('calls onRowClick when a row is clicked', () => {
    const handleClick = vi.fn();
    render(<DataTable columns={columns} data={data} onRowClick={handleClick} />);
    fireEvent.click(screen.getByText('Bob'));
    expect(handleClick).toHaveBeenCalledWith(data[1]);
  });

  it('renders empty state when no data', () => {
    render(<DataTable columns={columns} data={[]} emptyMessage="No results" />);
    expect(screen.getByText('No results')).toBeInTheDocument();
  });

  it('renders search input when searchPlaceholder provided', () => {
    render(<DataTable columns={columns} data={data} searchPlaceholder="Buscar..." />);
    expect(screen.getByPlaceholderText('Buscar...')).toBeInTheDocument();
  });

  it('renders skeleton when isLoading is true', () => {
    const { container } = render(<DataTable columns={columns} data={[]} isLoading />);
    expect(container.querySelectorAll('[data-skeleton-row]').length).toBeGreaterThan(0);
  });

  it('renders pagination when provided', () => {
    render(
      <DataTable
        columns={columns}
        data={data}
        pagination={{ page: 1, pageSize: 25, total: 100 }}
        onPageChange={() => {}}
      />
    );
    expect(screen.getByText(/1-25 de 100/)).toBeInTheDocument();
  });
});
