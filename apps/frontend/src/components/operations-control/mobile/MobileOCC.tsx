'use client';

import { useSearchParams, useRouter } from 'next/navigation';
import { Menu, Bell } from 'lucide-react';
import { MobileTabBar } from './MobileTabBar';
import { MobileStatusCards } from './MobileStatusCards';
import { MobileOrdersList } from './MobileOrdersList';
import { usePriorityCounts } from '@/hooks/usePriorityCounts';
import { useOperationsOrders } from '@/hooks/useOperationsOrders';
import { useOpsControlFilterStore } from '@/stores/useOpsControlFilterStore';

// ── Types ─────────────────────────────────────────────────────────────────────

type TabType = 'ops' | 'dashboard' | 'orders' | 'reports' | 'mas';

const VALID_TABS: TabType[] = ['ops', 'dashboard', 'orders', 'reports', 'mas'];

// ── Props ─────────────────────────────────────────────────────────────────────

interface MobileOCCProps {
  operatorId: string;
}

// ── MobileOCC ─────────────────────────────────────────────────────────────────

export function MobileOCC({ operatorId }: MobileOCCProps) {
  const searchParams = useSearchParams();
  const router = useRouter();

  const rawTab = searchParams.get('tab') as TabType | null;
  const activeTab: TabType = rawTab && VALID_TABS.includes(rawTab) ? rawTab : 'ops';

  const handleTabChange = (tab: TabType) => {
    if (tab === 'dashboard') {
      router.push('/app/dashboard');
      return;
    }
    if (tab === 'orders') {
      router.push('/app/orders');
      return;
    }
    router.push(`?tab=${tab}`, { scroll: false });
  };

  // ── Data ──────────────────────────────────────────────────────────────────
  const priorityCounts = usePriorityCounts(operatorId);
  const { stageFilter, datePreset, dateRange, statusFilter } = useOpsControlFilterStore();
  const { data: orders = [], isLoading: ordersLoading } = useOperationsOrders(operatorId, {
    stageFilter,
    datePreset,
    dateRange,
    statusFilter,
  });

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="relative h-screen w-full overflow-hidden">
      {/* Fixed header */}
      <header className="fixed top-0 left-0 right-0 h-14 bg-background border-b border-border flex items-center px-4 z-40">
        <button
          type="button"
          aria-label="Menú"
          className="p-1 mr-2"
        >
          <Menu className="w-6 h-6 text-foreground" />
        </button>

        <span className="flex-1 text-center font-semibold text-foreground">Ops Control</span>

        <div className="flex items-center gap-2">
          <button
            type="button"
            aria-label="Notificaciones"
            className="p-1"
          >
            <Bell className="w-6 h-6 text-foreground" />
          </button>
          {/* User avatar placeholder */}
          <div className="w-8 h-8 rounded-full bg-muted" />
        </div>
      </header>

      {/* Scrollable content */}
      <main className="h-full pt-14 pb-[60px] overflow-y-auto">
        {activeTab === 'ops' && (
          <>
            <MobileStatusCards
              counts={priorityCounts}
              isLoading={priorityCounts.isLoading}
            />
            <MobileOrdersList orders={orders} isLoading={ordersLoading} />
          </>
        )}

        {activeTab === 'dashboard' && (
          <div className="p-4 text-muted-foreground">Redirigiendo...</div>
        )}

        {activeTab === 'orders' && (
          <div className="p-4 text-muted-foreground">Redirigiendo...</div>
        )}

        {activeTab === 'reports' && (
          <p className="text-center text-muted-foreground py-8 px-4">Próximamente</p>
        )}

        {activeTab === 'mas' && (
          <div className="flex flex-col gap-4 px-4 py-6">
            <button type="button" className="text-left text-foreground">
              Configuración
            </button>
            <button type="button" className="text-left text-foreground">
              Cerrar sesión
            </button>
          </div>
        )}
      </main>

      {/* Fixed bottom tab bar */}
      <MobileTabBar
        activeTab={activeTab}
        onTabChange={handleTabChange}
        urgentCount={priorityCounts.urgent}
      />
    </div>
  );
}
