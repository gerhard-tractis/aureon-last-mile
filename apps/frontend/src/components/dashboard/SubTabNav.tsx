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
        className="md:hidden w-full text-sm font-medium border border-border rounded-lg px-4 py-3 bg-card focus:ring-2 focus:ring-gold"
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
      <div className="hidden md:block border-b border-border">
        <div className="flex items-center" role="tablist">
          {tabs.map((tab, i) => (
            <React.Fragment key={tab.id}>
              {i > 0 && <div className="w-3 h-px bg-border" />}
              <button
                role="tab"
                aria-selected={activeTab === tab.id}
                disabled={!tab.enabled}
                title={!tab.enabled ? 'Próximamente' : undefined}
                onClick={() => onTabChange(tab.id)}
                className={`whitespace-nowrap px-4 py-2 text-sm border-b-2 -mb-px ${
                  activeTab === tab.id
                    ? 'border-gold text-foreground font-semibold'
                    : tab.enabled
                      ? 'border-transparent text-muted-foreground hover:text-foreground hover:border-border'
                      : 'border-transparent text-muted-foreground/50 cursor-not-allowed'
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
