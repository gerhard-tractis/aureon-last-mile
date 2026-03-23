'use client';

import React from 'react';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';

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
        className="md:hidden w-full text-sm font-medium border border-border rounded-lg px-4 py-3 bg-card focus:ring-2 focus:ring-accent"
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
      <div className="hidden md:block">
        <Tabs value={activeTab} onValueChange={onTabChange}>
          <TabsList className="bg-transparent border-b border-border rounded-none h-auto p-0 w-full justify-start">
            {tabs.map((tab) => (
              <TabsTrigger
                key={tab.id}
                value={tab.id}
                disabled={!tab.enabled}
                title={!tab.enabled ? 'Próximamente' : undefined}
                className={`rounded-none border-b-2 border-transparent data-[state=active]:border-accent data-[state=active]:text-accent data-[state=active]:shadow-none text-[var(--color-text-secondary)] px-4 py-2 text-sm${!tab.enabled ? ' opacity-50 cursor-not-allowed' : ''}`}
              >
                {tab.step ? `${tab.step} ` : ''}{tab.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>
    </div>
  );
}
