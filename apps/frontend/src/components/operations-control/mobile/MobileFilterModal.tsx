"use client";

import { X } from 'lucide-react';
import { useOpsControlFilterStore } from '@/stores/useOpsControlFilterStore';
import { PIPELINE_STAGES } from '@/lib/types/pipeline';
import type { OpsControlFilterState } from '@/stores/useOpsControlFilterStore';
import type { OrderStatus } from '@/lib/types/pipeline';

export interface MobileFilterModalProps {
  open: boolean;
  onClose: () => void;
}

type StatusOption = {
  value: OpsControlFilterState['statusFilter'];
  label: string;
};

const STATUS_OPTIONS: StatusOption[] = [
  { value: 'all', label: 'Todos' },
  { value: 'urgent', label: 'Urgentes' },
  { value: 'alert', label: 'Alertas' },
  { value: 'ok', label: 'OK' },
  { value: 'late', label: 'Atrasados' },
];

type DateOption = {
  value: OpsControlFilterState['datePreset'];
  label: string;
};

const DATE_OPTIONS: DateOption[] = [
  { value: 'today', label: 'Hoy' },
  { value: 'tomorrow', label: 'Mañana' },
  { value: 'next7', label: '7 días' },
];

export function MobileFilterModal({ open, onClose }: MobileFilterModalProps) {
  const {
    statusFilter,
    datePreset,
    stageFilter,
    setStatusFilter,
    setDatePreset,
    setStageFilter,
    clearAllFilters,
  } = useOpsControlFilterStore();

  if (!open) return null;

  function handleLimpiar() {
    clearAllFilters();
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 bg-white flex flex-col overflow-y-auto">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
        <h2 className="text-base font-semibold">Filtros</h2>
        <button
          type="button"
          data-testid="modal-close"
          onClick={onClose}
          className="p-1"
          aria-label="Cerrar"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      <div className="flex-1 px-4 py-4 space-y-6">
        {/* Estado */}
        <section>
          <h3 className="text-xs font-semibold text-gray-500 uppercase mb-2">Estado</h3>
          <div className="flex flex-wrap gap-2">
            {STATUS_OPTIONS.map(({ value, label }) => (
              <button
                key={value}
                type="button"
                data-testid={`status-pill-${value}`}
                data-active={statusFilter === value ? 'true' : 'false'}
                onClick={() => setStatusFilter(value)}
                className={`px-3 py-1 rounded-full text-sm border transition-colors ${
                  statusFilter === value
                    ? 'bg-[#e6c15c] border-[#e6c15c] font-medium'
                    : 'bg-white border-gray-200 text-gray-600'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </section>

        {/* Fecha */}
        <section>
          <h3 className="text-xs font-semibold text-gray-500 uppercase mb-2">Fecha</h3>
          <div className="flex flex-wrap gap-2">
            {DATE_OPTIONS.map(({ value, label }) => (
              <button
                key={value}
                type="button"
                data-testid={`date-pill-${value}`}
                data-active={datePreset === value ? 'true' : 'false'}
                onClick={() => setDatePreset(value)}
                className={`px-3 py-1 rounded-full text-sm border transition-colors ${
                  datePreset === value
                    ? 'bg-[#e6c15c] border-[#e6c15c] font-medium'
                    : 'bg-white border-gray-200 text-gray-600'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </section>

        {/* Etapa */}
        <section>
          <h3 className="text-xs font-semibold text-gray-500 uppercase mb-2">Etapa</h3>
          <div className="flex flex-wrap gap-2">
            {PIPELINE_STAGES.map(({ status, label }) => (
              <button
                key={status}
                type="button"
                data-testid={`stage-pill-${status}`}
                data-active={stageFilter === status ? 'true' : 'false'}
                onClick={() => setStageFilter(status as OrderStatus)}
                className={`px-3 py-1 rounded-full text-sm border transition-colors ${
                  stageFilter === status
                    ? 'bg-[#e6c15c] border-[#e6c15c] font-medium'
                    : 'bg-white border-gray-200 text-gray-600'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </section>
      </div>

      {/* Footer */}
      <div className="px-4 py-3 border-t border-gray-200 flex gap-3">
        <button
          type="button"
          onClick={handleLimpiar}
          className="flex-1 py-2 rounded-lg border border-gray-300 text-gray-700 text-sm font-medium"
        >
          Limpiar
        </button>
        <button
          type="button"
          onClick={onClose}
          className="flex-1 py-2 rounded-lg bg-[#e6c15c] text-white text-sm font-medium"
        >
          Aplicar
        </button>
      </div>
    </div>
  );
}
