'use client';

import React from 'react';

export type PipelineTab =
  | 'loading'
  | 'pickup'
  | 'reception'
  | 'distribution'
  | 'routing'
  | 'lastmile'
  | 'analytics_otif'
  | 'analytics_unit_economics'
  | 'analytics_cx';

interface PipelineNavProps {
  activeTab: PipelineTab;
  onTabChange: (tab: PipelineTab) => void;
}

const OPERACIONES_TABS: { id: PipelineTab; step: string; label: string; enabled: boolean }[] = [
  { id: 'loading', step: '①', label: 'Carga', enabled: true },
  { id: 'pickup', step: '②', label: 'Retiro', enabled: false },
  { id: 'reception', step: '③', label: 'Recepción', enabled: false },
  { id: 'distribution', step: '④', label: 'Distribución', enabled: false },
  { id: 'routing', step: '⑤', label: 'Despacho', enabled: false },
  { id: 'lastmile', step: '⑥', label: 'Última Milla', enabled: true },
];

const ANALYTICS_TABS: { id: PipelineTab; label: string; enabled: boolean }[] = [
  { id: 'analytics_otif', label: 'OTIF', enabled: true },
  { id: 'analytics_unit_economics', label: 'Unit Economics', enabled: false },
  { id: 'analytics_cx', label: 'CX', enabled: false },
];

const ALL_TABS = [...OPERACIONES_TABS, ...ANALYTICS_TABS];

export default function PipelineNav({ activeTab, onTabChange }: PipelineNavProps) {
  return (
    <div>
      {/* Mobile dropdown */}
      <select
        className="md:hidden w-full text-sm font-medium border border-slate-200 rounded-lg px-4 py-3 bg-white focus:ring-2 focus:ring-[#e6c15c]"
        value={activeTab}
        onChange={(e) => onTabChange(e.target.value as PipelineTab)}
      >
        <optgroup label="Operaciones">
          {OPERACIONES_TABS.map((tab) => (
            <option key={tab.id} value={tab.id} disabled={!tab.enabled}>
              {tab.step} {tab.label}
              {!tab.enabled ? ' — Próximamente' : ''}
            </option>
          ))}
        </optgroup>
        <optgroup label="Analítica">
          {ANALYTICS_TABS.map((tab) => (
            <option key={tab.id} value={tab.id} disabled={!tab.enabled}>
              {tab.label}
              {!tab.enabled ? ' — Próximamente' : ''}
            </option>
          ))}
        </optgroup>
      </select>

      {/* Desktop tab bar */}
      <div className="hidden md:block border-b border-slate-200">
        {/* Operaciones row */}
        <div className="flex items-center gap-1 mb-0">
          <span className="text-xs font-semibold uppercase tracking-wider text-slate-400 px-3 py-2 whitespace-nowrap">
            Operaciones
          </span>
          <div className="flex items-center" role="tablist" aria-label="Operaciones">
            {OPERACIONES_TABS.map((tab, i) => (
              <React.Fragment key={tab.id}>
                {i > 0 && <div className="w-3 h-px bg-slate-300" />}
                <button
                  role="tab"
                  aria-selected={activeTab === tab.id}
                  disabled={!tab.enabled}
                  title={!tab.enabled ? 'Próximamente' : undefined}
                  onClick={() => onTabChange(tab.id)}
                  className={`whitespace-nowrap px-4 py-2 text-sm border-b-2 -mb-px ${
                    activeTab === tab.id
                      ? 'border-[#e6c15c] text-slate-900 font-semibold'
                      : tab.enabled
                        ? 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300'
                        : 'border-transparent text-slate-300 cursor-not-allowed'
                  }`}
                >
                  {tab.step} {tab.label}
                </button>
              </React.Fragment>
            ))}
          </div>

          <div className="w-px h-6 bg-slate-200 mx-3" />

          {/* Analítica section */}
          <span className="text-xs font-semibold uppercase tracking-wider text-slate-400 px-3 py-2 whitespace-nowrap">
            Analítica
          </span>
          <div className="flex items-center" role="tablist" aria-label="Analítica">
            {ANALYTICS_TABS.map((tab, i) => (
              <React.Fragment key={tab.id}>
                {i > 0 && <div className="w-3 h-px bg-slate-300" />}
                <button
                  role="tab"
                  aria-selected={activeTab === tab.id}
                  disabled={!tab.enabled}
                  title={!tab.enabled ? 'Próximamente' : undefined}
                  onClick={() => onTabChange(tab.id)}
                  className={`whitespace-nowrap px-4 py-2 text-sm border-b-2 -mb-px ${
                    activeTab === tab.id
                      ? 'border-[#e6c15c] text-slate-900 font-semibold'
                      : tab.enabled
                        ? 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300'
                        : 'border-transparent text-slate-300 cursor-not-allowed'
                  }`}
                >
                  {tab.label}
                </button>
              </React.Fragment>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
