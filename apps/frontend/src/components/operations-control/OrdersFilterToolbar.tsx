'use client';

/**
 * OrdersFilterToolbar
 * Toolbar with search + filter controls that syncs with useOpsControlFilterStore.
 */

import { useOpsControlFilterStore } from '@/stores/useOpsControlFilterStore';
import { PIPELINE_STAGES } from '@/lib/types/pipeline';

export function OrdersFilterToolbar() {
  const {
    search,
    datePreset,
    statusFilter,
    stageFilter,
    setSearch,
    setDatePreset,
    setStatusFilter,
    setStageFilter,
    clearAllFilters,
  } = useOpsControlFilterStore();

  const hasActiveFilters =
    search !== '' ||
    datePreset !== 'today' ||
    statusFilter !== 'all' ||
    stageFilter !== null;

  const stageLabel = stageFilter
    ? (PIPELINE_STAGES.find((s) => s.status === stageFilter)?.label ?? stageFilter)
    : null;

  return (
    <div className="flex flex-wrap items-center gap-2 p-3 bg-white border-b border-gray-200">
      {/* Search input */}
      <input
        type="text"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Buscar orden, cliente..."
        className="flex-1 min-w-[200px] px-3 py-1.5 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
      />

      {/* Date filter */}
      <select
        data-testid="date-select"
        value={datePreset}
        onChange={(e) =>
          setDatePreset(
            e.target.value as 'today' | 'tomorrow' | 'next7' | 'custom',
          )
        }
        className="px-3 py-1.5 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
      >
        <option value="today">Hoy</option>
        <option value="tomorrow">Mañana</option>
        <option value="next7">Próximos 7 días</option>
        <option value="custom">Rango personalizado</option>
      </select>

      {/* Status filter */}
      <select
        data-testid="status-select"
        value={statusFilter}
        onChange={(e) =>
          setStatusFilter(
            e.target.value as 'all' | 'urgent' | 'alert' | 'ok' | 'late',
          )
        }
        className="px-3 py-1.5 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
      >
        <option value="all">Todos</option>
        <option value="urgent">Urgentes</option>
        <option value="alert">Alertas</option>
        <option value="ok">OK</option>
        <option value="late">Atrasados</option>
      </select>

      {/* Stage filter badge */}
      {stageFilter !== null && stageLabel !== null && (
        <span
          data-testid="stage-filter-badge"
          className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium bg-blue-100 text-blue-800 rounded-full"
        >
          Etapa: {stageLabel}
          <button
            data-testid="stage-filter-clear"
            onClick={() => setStageFilter(null)}
            className="ml-1 text-blue-600 hover:text-blue-900 font-bold leading-none"
            aria-label="Limpiar filtro de etapa"
          >
            ×
          </button>
        </span>
      )}

      {/* Clear all filters button */}
      {hasActiveFilters && (
        <button
          onClick={clearAllFilters}
          className="px-3 py-1.5 text-sm text-gray-600 hover:text-gray-900 border border-gray-300 rounded-md hover:bg-gray-50"
        >
          Limpiar filtros
        </button>
      )}
    </div>
  );
}
