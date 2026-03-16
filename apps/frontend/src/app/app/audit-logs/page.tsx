'use client';

/**
 * Audit Logs page — ops-manager view
 * Epic 5 / Spec-06: Capacity Calendar, Alerts & Audit Log Viewer
 *
 * Route: /app/audit-logs
 * Allowed roles: operations_manager, admin
 */

import { Suspense, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useOperatorId } from '@/hooks/useOperatorId';
import { useAuditLogsOps } from '@/hooks/useAuditLogsOps';
import { useAuditLogUsers } from '@/hooks/useAuditLogUsers';
import { Skeleton } from '@/components/ui/skeleton';
import AuditLogTable from '@/components/audit/AuditLogTable';
import AuditLogFilters from '@/components/audit/AuditLogFilters';
import AuditLogExport from '@/components/audit/AuditLogExport';
import type { AuditFilters } from '@/components/audit/AuditLogFilters';
import type { SortColumn, SortDirection } from '@/components/audit/AuditLogTable';

// ── Constants ─────────────────────────────────────────────────────────────────

const ALLOWED_ROLES = ['operations_manager', 'admin'];
const PAGE_SIZE = 50;

// ── Helpers ───────────────────────────────────────────────────────────────────

function getDateRange(preset: AuditFilters['datePreset'], dateFrom?: string, dateTo?: string) {
  const today = new Date();
  const todayStr = today.toISOString().split('T')[0];

  switch (preset) {
    case 'today':
      return { dateFrom: todayStr, dateTo: todayStr };
    case '30d': {
      const d = new Date();
      d.setDate(d.getDate() - 30);
      return { dateFrom: d.toISOString().split('T')[0], dateTo: todayStr };
    }
    case 'custom':
      return { dateFrom, dateTo };
    case '7d':
    default: {
      const d = new Date();
      d.setDate(d.getDate() - 7);
      return { dateFrom: d.toISOString().split('T')[0], dateTo: todayStr };
    }
  }
}

// ── Inner Content ─────────────────────────────────────────────────────────────

function AuditLogsContent() {
  const router = useRouter();
  const { operatorId, role } = useOperatorId();

  const [filters, setFilters] = useState<AuditFilters>({
    datePreset: '7d',
    userId: undefined,
    actionType: 'ALL',
    resourceType: 'all',
    search: '',
  });

  const [page, setPage] = useState(1);
  const [sortColumn, setSortColumn] = useState<SortColumn>('timestamp');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');

  // Role guard
  useEffect(() => {
    if (role && !ALLOWED_ROLES.includes(role)) {
      router.push('/app/dashboard');
    }
  }, [role, router]);

  if (!role) {
    return (
      <div className="space-y-4 p-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  if (!ALLOWED_ROLES.includes(role)) return null;

  // eslint-disable-next-line react-hooks/rules-of-hooks
  return <AuditLogsInner
    operatorId={operatorId}
    filters={filters}
    setFilters={setFilters}
    page={page}
    setPage={setPage}
    sortColumn={sortColumn}
    setSortColumn={setSortColumn}
    sortDirection={sortDirection}
    setSortDirection={setSortDirection}
  />;
}

// Split inner to keep hooks after the early returns above in a separate component
function AuditLogsInner({
  operatorId,
  filters,
  setFilters,
  page,
  setPage,
  sortColumn,
  setSortColumn,
  sortDirection,
  setSortDirection,
}: {
  operatorId: string | null;
  filters: AuditFilters;
  setFilters: (f: AuditFilters) => void;
  page: number;
  setPage: (p: number) => void;
  sortColumn: SortColumn;
  setSortColumn: (c: SortColumn) => void;
  sortDirection: SortDirection;
  setSortDirection: (d: SortDirection) => void;
}) {
  const { dateFrom, dateTo } = getDateRange(filters.datePreset, filters.dateFrom, filters.dateTo);

  const { data: logs, count, isLoading } = useAuditLogsOps(operatorId, {
    dateFrom,
    dateTo,
    userId: filters.userId,
    actionType: filters.actionType,
    resourceType: filters.resourceType,
    search: filters.search,
    page,
    pageSize: PAGE_SIZE,
  });

  const { data: users, isLoading: usersLoading } = useAuditLogUsers(operatorId);

  // Build user display map: id → full_name
  const userMap = useMemo<Record<string, string>>(() => {
    const map: Record<string, string> = {};
    for (const u of users) {
      map[u.id] = u.full_name || u.email;
    }
    return map;
  }, [users]);

  function handleFiltersChange(newFilters: AuditFilters) {
    setFilters(newFilters);
    setPage(1); // reset to page 1 on filter change
  }

  function handleSortChange(column: SortColumn, direction: SortDirection) {
    setSortColumn(column);
    setSortDirection(direction);
    setPage(1);
  }

  return (
    <div className="space-y-4 p-4">
      <title>Registro de Auditoría | Aureon Last Mile</title>

      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-2xl font-bold text-foreground">Registro de Auditoría</h1>
        <AuditLogExport logs={logs} userMap={userMap} />
      </div>

      {/* Filters */}
      <AuditLogFilters
        filters={filters}
        onFiltersChange={handleFiltersChange}
        users={users}
        usersLoading={usersLoading}
      />

      {/* Table */}
      <AuditLogTable
        logs={logs}
        count={count}
        page={page}
        pageSize={PAGE_SIZE}
        onPageChange={setPage}
        onSortChange={handleSortChange}
        sortColumn={sortColumn}
        sortDirection={sortDirection}
        userMap={userMap}
        isLoading={isLoading}
      />
    </div>
  );
}

// ── Page Export ───────────────────────────────────────────────────────────────

export default function AuditLogsPage() {
  return (
    <Suspense
      fallback={
        <div className="space-y-4 p-4">
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-96 w-full" />
        </div>
      }
    >
      <AuditLogsContent />
    </Suspense>
  );
}
