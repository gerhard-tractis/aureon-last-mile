'use client';

import { useState, useMemo } from 'react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { DataTableToolbar, type FilterChip } from './DataTableToolbar';
import { DataTablePagination } from './DataTablePagination';
import { DataTableSkeleton } from './DataTableSkeleton';

export interface ColumnDef<T> {
  accessorKey: keyof T & string;
  header: string;
  cell?: (row: T) => React.ReactNode;
  className?: string;
  sortable?: boolean;
}

interface DataTableProps<T> {
  columns: ColumnDef<T>[];
  data: T[];
  isLoading?: boolean;
  filterChips?: FilterChip[];
  searchPlaceholder?: string;
  onRowClick?: (row: T) => void;
  pagination?: { page: number; pageSize: number; total: number };
  onPageChange?: (page: number) => void;
  emptyMessage?: string;
}

type SortDir = 'asc' | 'desc' | null;

export function DataTable<T extends Record<string, unknown>>({
  columns,
  data,
  isLoading,
  filterChips,
  searchPlaceholder,
  onRowClick,
  pagination,
  onPageChange,
  emptyMessage = 'Sin resultados',
}: DataTableProps<T>) {
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>(null);
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    if (!search) return data;
    const q = search.toLowerCase();
    return data.filter((row) =>
      columns.some((col) => String(row[col.accessorKey] ?? '').toLowerCase().includes(q))
    );
  }, [data, search, columns]);

  const sorted = useMemo(() => {
    if (!sortKey || !sortDir) return filtered;
    return [...filtered].sort((a, b) => {
      const av = a[sortKey] ?? '';
      const bv = b[sortKey] ?? '';
      const cmp = String(av).localeCompare(String(bv), undefined, { numeric: true });
      return sortDir === 'asc' ? cmp : -cmp;
    });
  }, [filtered, sortKey, sortDir]);

  function handleSort(key: string) {
    if (sortKey === key) {
      setSortDir(sortDir === 'asc' ? 'desc' : sortDir === 'desc' ? null : 'asc');
      if (sortDir === 'desc') setSortKey(null);
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  }

  if (isLoading) {
    return <DataTableSkeleton columns={columns.length} />;
  }

  return (
    <div>
      {(searchPlaceholder || filterChips) && (
        <DataTableToolbar
          searchPlaceholder={searchPlaceholder}
          searchValue={search}
          onSearchChange={setSearch}
          filterChips={filterChips}
        />
      )}

      <Table>
        <TableHeader>
          <TableRow className="bg-surface hover:bg-surface">
            {columns.map((col) => (
              <TableHead
                key={col.accessorKey}
                className={`text-[11px] font-semibold uppercase tracking-wide text-text-muted h-8 ${col.sortable !== false ? 'cursor-pointer select-none' : ''} ${col.className ?? ''}`}
                onClick={col.sortable !== false ? () => handleSort(col.accessorKey) : undefined}
              >
                {col.header}
                {sortKey === col.accessorKey && (
                  <span className="ml-1">{sortDir === 'asc' ? '↑' : '↓'}</span>
                )}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {sorted.length === 0 ? (
            <TableRow>
              <TableCell colSpan={columns.length} className="text-center text-sm text-text-muted py-8">
                {emptyMessage}
              </TableCell>
            </TableRow>
          ) : (
            sorted.map((row, i) => (
              <TableRow
                key={i}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                className={`h-8 border-b border-border-subtle ${onRowClick ? 'cursor-pointer hover:bg-surface-raised' : ''}`}
              >
                {columns.map((col) => (
                  <TableCell key={col.accessorKey} className={`py-1.5 text-sm ${col.className ?? ''}`}>
                    {col.cell ? col.cell(row) : String(row[col.accessorKey] ?? '')}
                  </TableCell>
                ))}
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>

      {pagination && onPageChange && (
        <DataTablePagination {...pagination} onPageChange={onPageChange} />
      )}
    </div>
  );
}
