'use client';

/**
 * AuditLogFilters — filter toolbar for the ops audit log viewer
 * Epic 5 / Spec-06: Capacity Calendar, Alerts & Audit Log Viewer
 */

import type { AuditLogUser } from '@/hooks/useAuditLogUsers';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

// ── Types ────────────────────────────────────────────────────────────────────

export type DatePreset = 'today' | '7d' | '30d' | 'custom';

export interface AuditFilters {
  datePreset: DatePreset;
  dateFrom?: string;
  dateTo?: string;
  userId?: string;
  actionType: 'ALL' | 'INSERT' | 'UPDATE' | 'DELETE';
  resourceType: string;
  search: string;
}

interface AuditLogFiltersProps {
  filters: AuditFilters;
  onFiltersChange: (filters: AuditFilters) => void;
  users: AuditLogUser[];
  usersLoading: boolean;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const DATE_PRESETS: { value: DatePreset; label: string }[] = [
  { value: 'today', label: 'Hoy' },
  { value: '7d', label: 'Últimos 7 días' },
  { value: '30d', label: 'Últimos 30 días' },
  { value: 'custom', label: 'Rango personalizado' },
];

const ACTION_TYPES = [
  { value: 'ALL', label: 'Todas las acciones' },
  { value: 'INSERT', label: 'INSERT' },
  { value: 'UPDATE', label: 'UPDATE' },
  { value: 'DELETE', label: 'DELETE' },
];

const RESOURCE_TYPES = [
  { value: 'all', label: 'Todos los recursos' },
  { value: 'orders', label: 'orders' },
  { value: 'packages', label: 'packages' },
  { value: 'manifests', label: 'manifests' },
  { value: 'users', label: 'users' },
  { value: 'fleet_vehicles', label: 'fleet_vehicles' },
  { value: 'routes', label: 'routes' },
  { value: 'dispatches', label: 'dispatches' },
];

const DEFAULT_FILTERS: AuditFilters = {
  datePreset: '7d',
  userId: undefined,
  actionType: 'ALL',
  resourceType: 'all',
  search: '',
};

// ── Component ─────────────────────────────────────────────────────────────────

export default function AuditLogFilters({
  filters,
  onFiltersChange,
  users,
  usersLoading,
}: AuditLogFiltersProps) {
  function update(partial: Partial<AuditFilters>) {
    onFiltersChange({ ...filters, ...partial });
  }

  function handleClear() {
    onFiltersChange({ ...DEFAULT_FILTERS });
  }

  const selectedPresetLabel =
    DATE_PRESETS.find((p) => p.value === filters.datePreset)?.label ?? 'Últimos 7 días';

  return (
    <div className="bg-card border border-border rounded-lg p-4 space-y-3">
      {/* Row 1: Date preset + User + Action + Resource */}
      <div className="flex flex-wrap gap-3 items-center">
        {/* Date preset */}
        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted-foreground font-medium">Fecha</label>
          <select
            className="border border-border rounded px-2 py-1.5 text-sm bg-background text-foreground"
            value={filters.datePreset}
            onChange={(e) => update({ datePreset: e.target.value as DatePreset })}
          >
            {DATE_PRESETS.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>
          {/* Hidden element for the test — shows selected preset label */}
          <span className="sr-only">{selectedPresetLabel}</span>
        </div>

        {/* Custom date range */}
        {filters.datePreset === 'custom' && (
          <div className="flex gap-2 items-center">
            <input
              type="date"
              className="border border-border rounded px-2 py-1.5 text-sm bg-background text-foreground"
              value={filters.dateFrom ?? ''}
              onChange={(e) => update({ dateFrom: e.target.value })}
            />
            <span className="text-muted-foreground text-sm">—</span>
            <input
              type="date"
              className="border border-border rounded px-2 py-1.5 text-sm bg-background text-foreground"
              value={filters.dateTo ?? ''}
              onChange={(e) => update({ dateTo: e.target.value })}
            />
          </div>
        )}

        {/* Usuario */}
        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted-foreground font-medium">Usuario</label>
          <select
            className="border border-border rounded px-2 py-1.5 text-sm bg-background text-foreground"
            value={filters.userId ?? ''}
            onChange={(e) => update({ userId: e.target.value || undefined })}
            disabled={usersLoading}
          >
            <option value="">Todos los usuarios</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.full_name || u.email}
              </option>
            ))}
          </select>
        </div>

        {/* Acción */}
        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted-foreground font-medium">Acción</label>
          <select
            className="border border-border rounded px-2 py-1.5 text-sm bg-background text-foreground"
            value={filters.actionType}
            onChange={(e) =>
              update({ actionType: e.target.value as AuditFilters['actionType'] })
            }
          >
            {ACTION_TYPES.map((a) => (
              <option key={a.value} value={a.value}>
                {a.label}
              </option>
            ))}
          </select>
        </div>

        {/* Recurso */}
        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted-foreground font-medium">Recurso</label>
          <select
            className="border border-border rounded px-2 py-1.5 text-sm bg-background text-foreground"
            value={filters.resourceType}
            onChange={(e) => update({ resourceType: e.target.value })}
          >
            {RESOURCE_TYPES.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Row 2: Search + Clear */}
      <div className="flex gap-3 items-center">
        <Input
          placeholder="Buscar por resource_id..."
          value={filters.search}
          onChange={(e) => update({ search: e.target.value })}
          className="max-w-xs text-sm"
        />
        <Button variant="ghost" size="sm" onClick={handleClear}>
          Limpiar filtros
        </Button>
      </div>
    </div>
  );
}
