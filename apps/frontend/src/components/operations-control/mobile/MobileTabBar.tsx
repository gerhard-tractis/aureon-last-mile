"use client";

import { Activity, BarChart3, Package, TrendingUp, MoreHorizontal } from 'lucide-react';

export interface MobileTabBarProps {
  activeTab: 'ops' | 'dashboard' | 'orders' | 'reports' | 'mas';
  onTabChange: (tab: MobileTabBarProps['activeTab']) => void;
  urgentCount: number;
}

const TABS: {
  id: MobileTabBarProps['activeTab'];
  label: string;
  Icon: React.ComponentType<{ className?: string }>;
}[] = [
  { id: 'ops', label: 'Ops', Icon: Activity },
  { id: 'dashboard', label: 'Dashboard', Icon: BarChart3 },
  { id: 'orders', label: 'Pedidos', Icon: Package },
  { id: 'reports', label: 'Reportes', Icon: TrendingUp },
  { id: 'mas', label: 'Más', Icon: MoreHorizontal },
];

export function MobileTabBar({ activeTab, onTabChange, urgentCount }: MobileTabBarProps) {
  const badgeText = urgentCount > 99 ? '99+' : String(urgentCount);
  const showBadge = urgentCount > 0;

  return (
    <nav className="fixed bottom-0 left-0 right-0 h-[60px] bg-white border-t border-gray-200 flex items-center z-50">
      {TABS.map(({ id, label, Icon }) => {
        const isActive = activeTab === id;
        return (
          <button
            key={id}
            type="button"
            data-testid={`tab-${id}`}
            aria-selected={isActive}
            data-active={isActive ? 'true' : 'false'}
            onClick={() => onTabChange(id)}
            className="flex-1 flex flex-col items-center justify-center h-full active:scale-95 transition-transform"
          >
            <div
              className={`relative flex items-center justify-center rounded-lg p-1 ${
                isActive ? 'bg-[#e6c15c]' : ''
              }`}
            >
              <Icon className="w-5 h-5" />
              {id === 'ops' && showBadge && (
                <span
                  data-testid="ops-badge"
                  className="absolute -top-1 -right-1 bg-red-500 text-white text-[10px] font-bold rounded-full min-w-[16px] h-4 flex items-center justify-center px-0.5"
                >
                  {badgeText}
                </span>
              )}
            </div>
            <span className="text-[10px] mt-0.5">{label}</span>
          </button>
        );
      })}
    </nav>
  );
}
