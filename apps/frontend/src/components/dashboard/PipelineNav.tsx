'use client';

import React from 'react';

export type PipelineTab = 'overview' | 'loading' | 'pickup' | 'reception' | 'distribution' | 'routing' | 'lastmile';

interface PipelineNavProps {
  activeTab: PipelineTab;
  onTabChange: (tab: PipelineTab) => void;
}

const TABS: { id: PipelineTab; step: string; label: string; enabled: boolean }[] = [
  { id: 'overview', step: '', label: 'Vista General', enabled: true },
  { id: 'loading', step: '①', label: 'Carga', enabled: true },
  { id: 'pickup', step: '②', label: 'Retiro', enabled: false },
  { id: 'reception', step: '③', label: 'Recepción', enabled: false },
  { id: 'distribution', step: '④', label: 'Distribución', enabled: false },
  { id: 'routing', step: '⑤', label: 'Despacho', enabled: false },
  { id: 'lastmile', step: '⑥', label: 'Última Milla', enabled: true },
];

export default function PipelineNav({ activeTab, onTabChange }: PipelineNavProps) {
  return (
    <div>
      {/* Mobile dropdown */}
      <select
        className="md:hidden w-full text-sm font-medium border border-slate-200 rounded-lg px-4 py-3 bg-white focus:ring-2 focus:ring-[#e6c15c]"
        value={activeTab}
        onChange={(e) => onTabChange(e.target.value as PipelineTab)}
      >
        {TABS.map((tab) => (
          <option key={tab.id} value={tab.id} disabled={!tab.enabled}>
            {tab.step ? `${tab.step} ${tab.label}` : tab.label}
            {!tab.enabled ? ' — Próximamente' : ''}
          </option>
        ))}
      </select>

      {/* Desktop tab bar */}
      <div
        className="hidden md:flex items-center border-b border-slate-200"
        role="tablist"
      >
        {TABS.map((tab, i) => (
          <React.Fragment key={tab.id}>
            {i > 0 && <div className="w-4 h-px bg-slate-300" />}
            <button
              role="tab"
              aria-selected={activeTab === tab.id}
              disabled={!tab.enabled}
              title={!tab.enabled ? 'Próximamente' : undefined}
              onClick={() => onTabChange(tab.id)}
              className={`whitespace-nowrap px-4 py-3 text-sm border-b-2 -mb-px ${
                activeTab === tab.id
                  ? 'border-[#e6c15c] text-slate-900 font-semibold'
                  : tab.enabled
                    ? 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300'
                    : 'border-transparent text-slate-300 cursor-not-allowed'
              }`}
            >
              {tab.step ? `${tab.step} ${tab.label}` : tab.label}
            </button>
          </React.Fragment>
        ))}
      </div>
    </div>
  );
}
