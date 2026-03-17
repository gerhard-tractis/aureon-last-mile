'use client';

/**
 * AuditLogTable — sortable table with expandable rows for audit log viewer
 * Epic 5 / Spec-06: Capacity Calendar, Alerts & Audit Log Viewer
 */

import React, { useState } from 'react';
import type { AuditLogEntry } from '@/hooks/useAuditLogsOps';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import AuditLogDetailRow from './AuditLogDetailRow';

// ── Types ────────────────────────────────────────────────────────────────────

export type SortColumn = 'timestamp' | 'user_id' | 'action' | 'resource_type';
export type SortDirection = 'asc' | 'desc';

interface AuditLogTableProps {
  logs: AuditLogEntry[];
  count: number | null;
  page: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  onSortChange: (column: SortColumn, direction: SortDirection) => void;
  sortColumn: SortColumn;
  sortDirection: SortDirection;
  userMap: Record<string, string>;
  isLoading: boolean;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatTimestamp(ts: string): string {
  const d = new Date(ts);
  return d.toLocaleString('es-CL', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function actionBadgeClass(action: string): string {
  if (action.startsWith('INSERT')) return 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400';
  if (action.startsWith('DELETE')) return 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400';
  if (action.startsWith('UPDATE')) return 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400';
  return 'bg-muted text-muted-foreground';
}

// ── Sub-components ────────────────────────────────────────────────────────────

function SortableHeader({
  label,
  column,
  currentCol,
  currentDir,
  onSort,
}: {
  label: string;
  column: SortColumn;
  currentCol: SortColumn;
  currentDir: SortDirection;
  onSort: (col: SortColumn, dir: SortDirection) => void;
}) {
  const isActive = currentCol === column;
  const nextDir: SortDirection = isActive && currentDir === 'asc' ? 'desc' : 'asc';
  const arrow = isActive ? (currentDir === 'asc' ? ' ▲' : ' ▼') : ' ⇅';

  return (
    <th
      className="text-left p-3 font-semibold text-foreground cursor-pointer select-none hover:bg-muted/50 transition-colors whitespace-nowrap"
      onClick={() => onSort(column, nextDir)}
    >
      {label}
      <span className="text-muted-foreground text-xs ml-1">{arrow}</span>
    </th>
  );
}

function SkeletonRows({ count }: { count: number }) {
  return (
    <>
      {Array.from({ length: count }).map((_, i) => (
        <tr key={i} role="status" aria-label="loading">
          {Array.from({ length: 6 }).map((__, j) => (
            <td key={j} className="p-3">
              <Skeleton className="h-4 w-full" />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────────

export default function AuditLogTable({
  logs,
  count,
  page,
  pageSize,
  onPageChange,
  onSortChange,
  sortColumn,
  sortDirection,
  userMap,
  isLoading,
}: AuditLogTableProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const totalPages = count != null ? Math.max(1, Math.ceil(count / pageSize)) : 1;

  function toggleRow(id: string) {
    setExpandedId((prev) => (prev === id ? null : id));
  }

  return (
    <div className="bg-card border border-border rounded-lg overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="border-b bg-muted/50">
              <SortableHeader
                label="Fecha/Hora"
                column="timestamp"
                currentCol={sortColumn}
                currentDir={sortDirection}
                onSort={onSortChange}
              />
              <SortableHeader
                label="Usuario"
                column="user_id"
                currentCol={sortColumn}
                currentDir={sortDirection}
                onSort={onSortChange}
              />
              <SortableHeader
                label="Acción"
                column="action"
                currentCol={sortColumn}
                currentDir={sortDirection}
                onSort={onSortChange}
              />
              <SortableHeader
                label="Recurso"
                column="resource_type"
                currentCol={sortColumn}
                currentDir={sortDirection}
                onSort={onSortChange}
              />
              <th className="text-left p-3 font-semibold text-foreground hidden md:table-cell">
                IP
              </th>
              <th className="p-3 font-semibold text-foreground text-center w-12">
                Detalle
              </th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <SkeletonRows count={8} />
            ) : logs.length === 0 ? (
              <tr>
                <td colSpan={6} className="p-8 text-center text-muted-foreground">
                  No se encontraron registros
                </td>
              </tr>
            ) : (
              logs.map((log) => (
                <React.Fragment key={log.id}>
                  <tr
                    className="border-b hover:bg-muted/30 transition-colors"
                  >
                    <td className="p-3 text-foreground whitespace-nowrap">
                      {formatTimestamp(log.timestamp)}
                    </td>
                    <td className="p-3 text-foreground">
                      {userMap[log.user_id] ?? log.user_id}
                    </td>
                    <td className="p-3">
                      <span
                        className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${actionBadgeClass(log.action)}`}
                      >
                        {log.action}
                      </span>
                    </td>
                    <td className="p-3 text-foreground">
                      <span className="font-medium">{log.resource_type ?? '—'}</span>
                      {log.resource_id && (
                        <span className="text-muted-foreground text-xs ml-1">
                          {log.resource_id}
                        </span>
                      )}
                    </td>
                    <td className="p-3 text-muted-foreground text-xs hidden md:table-cell">
                      {log.ip_address ?? '—'}
                    </td>
                    <td className="p-3 text-center">
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label="Detalle"
                        onClick={() => toggleRow(log.id)}
                        className="px-2"
                      >
                        {expandedId === log.id ? '▼' : '▶'}
                      </Button>
                    </td>
                  </tr>
                  {expandedId === log.id && (
                    <tr>
                      <td colSpan={6} className="p-0">
                        <AuditLogDetailRow entry={log} />
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div className="flex items-center justify-between px-4 py-3 border-t border-border">
        <span className="text-sm text-muted-foreground">
          {count != null ? `${count.toLocaleString('es-CL')} registros` : ''}
        </span>
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="sm"
            disabled={page <= 1}
            onClick={() => onPageChange(page - 1)}
            aria-label="Anterior"
          >
            ◀
          </Button>
          <span className="text-sm text-foreground">
            Página {page} de {totalPages}
          </span>
          <Button
            variant="ghost"
            size="sm"
            disabled={page >= totalPages}
            onClick={() => onPageChange(page + 1)}
            aria-label="Siguiente"
          >
            ▶
          </Button>
        </div>
      </div>
    </div>
  );
}
