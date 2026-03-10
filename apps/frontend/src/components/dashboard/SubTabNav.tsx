'use client';

import React from 'react';

export interface TabDefinition {
  id: string;
  label: string;
  enabled: boolean;
  step?: string;
}

interface SubTabNavProps {
  tabs: TabDefinition[];
  activeTab: string;
  onTabChange: (tabId: string) => void;
}

export default function SubTabNav({ tabs, activeTab, onTabChange }: SubTabNavProps) {
  return (
    <div>
      {/* Mobile dropdown */}
      <select
        className="md:hidden w-full text-sm font-medium border border-slate-200 rounded-lg px-4 py-3 bg-white focus:ring-2 focus:ring-[#e6c15c]"
        value={activeTab}
        onChange={(e) => onTabChange(e.target.value)}
        role="combobox"
      >
        {tabs.map((tab) => (
          <option key={tab.id} value={tab.id} disabled={!tab.enabled}>
            {tab.step ? `${tab.step} ` : ''}{tab.label}
            {!tab.enabled ? ' — Próximamente' : ''}
          </option>
        ))}
      </select>

      {/* Desktop tab bar */}
      <div className="hidden md:block border-b border-slate-200">
        <div className="flex items-center" role="tablist">
          {tabs.map((tab, i) => (
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
                {tab.step ? `${tab.step} ` : ''}{tab.label}
              </button>
            </React.Fragment>
          ))}
        </div>
      </div>
    </div>
  );
}
