"use client";

import { useState, useMemo } from 'react';
import { Search, Filter } from 'lucide-react';
import type { OperationsOrder } from '@/hooks/useOperationsOrders';
import type { OrderPriority } from '@/lib/types/pipeline';
import { useOpsControlFilterStore } from '@/stores/useOpsControlFilterStore';
import { MobileOrderCard } from './MobileOrderCard';
import { MobileFilterModal } from './MobileFilterModal';
import { MobilePullToRefresh } from './MobilePullToRefresh';
import { OrderDetailModal } from '@/components/operations-control/OrderDetailModal';

// ── Priority computation ───────────────────────────────────────────────────

export function computePriority(order: OperationsOrder): OrderPriority {
  if (!order.delivery_window_end) return 'ok';
  const windowEnd = new Date(order.delivery_window_end);
  if (windowEnd < new Date()) return 'late';
  const minsUntil = (windowEnd.getTime() - Date.now()) / 60000;
  if (minsUntil <= 45) return 'urgent';
  if (minsUntil <= 120) return 'alert';
  return 'ok';
}

// ── Group config ──────────────────────────────────────────────────────────

const GROUP_ORDER: OrderPriority[] = ['urgent', 'alert', 'ok', 'late'];

const GROUP_LABELS: Record<OrderPriority, string> = {
  urgent: '🔴 Urgentes',
  alert: '🟡 Alertas',
  ok: '🟢 OK',
  late: '⚫ Atrasados',
};

// ── Props ─────────────────────────────────────────────────────────────────

interface MobileOrdersListProps {
  orders: OperationsOrder[];
  isLoading: boolean;
}

// ── Component ─────────────────────────────────────────────────────────────

const INITIAL_VISIBLE = 20;

export function MobileOrdersList({ orders, isLoading }: MobileOrdersListProps) {
  const { statusFilter } = useOpsControlFilterStore();

  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterModalOpen, setFilterModalOpen] = useState(false);
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const [visibleCount, setVisibleCount] = useState(INITIAL_VISIBLE);

  // ── Search filter ────────────────────────────────────────────────────────

  const filteredOrders = useMemo(() => {
    const lowerQuery = searchQuery.toLowerCase();
    return lowerQuery
      ? orders.filter(
          (o) =>
            o.order_number.toLowerCase().includes(lowerQuery) ||
            (o.retailer_name ?? '').toLowerCase().includes(lowerQuery),
        )
      : orders;
  }, [orders, searchQuery]);

  // ── Priority grouping ────────────────────────────────────────────────────

  const grouped = useMemo(() => {
    const result: Record<OrderPriority, OperationsOrder[]> = {
      urgent: [],
      alert: [],
      ok: [],
      late: [],
    };
    for (const order of filteredOrders) {
      result[computePriority(order)].push(order);
    }
    return result;
  }, [filteredOrders]);

  // ── Flat filtered list (respects statusFilter) ───────────────────────────

  const flatFiltered = useMemo(() => {
    const visibleGroups: OrderPriority[] =
      statusFilter === 'all'
        ? GROUP_ORDER.filter((g) => grouped[g].length > 0)
        : GROUP_ORDER.filter((g) => g === statusFilter && grouped[g].length > 0);
    return visibleGroups.flatMap((g) => grouped[g]);
  }, [grouped, statusFilter]);

  const visibleGroups: OrderPriority[] =
    statusFilter === 'all'
      ? GROUP_ORDER.filter((g) => grouped[g].length > 0)
      : GROUP_ORDER.filter((g) => g === statusFilter && grouped[g].length > 0);

  const paginatedOrders = flatFiltered.slice(0, visibleCount);
  const hasMore = flatFiltered.length > visibleCount;

  const isEmpty = !isLoading && flatFiltered.length === 0;

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col">
      {/* Toolbar: search + filter */}
      <div className="flex items-center justify-end gap-2 px-4 py-2">
        {searchOpen && (
          <input
            data-testid="search-input"
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Buscar pedido..."
            className="flex-1 border border-border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            autoFocus
          />
        )}
        <button
          type="button"
          data-testid="search-toggle"
          onClick={() => {
            setSearchOpen((v) => !v);
            if (searchOpen) setSearchQuery('');
          }}
          className="p-2 rounded-full hover:bg-muted"
          aria-label="Buscar"
        >
          <Search className="w-5 h-5 text-muted-foreground" />
        </button>
        <button
          type="button"
          data-testid="filter-btn"
          onClick={() => setFilterModalOpen(true)}
          className="p-2 rounded-full hover:bg-muted"
          aria-label="Filtros"
        >
          <Filter className="w-5 h-5 text-muted-foreground" />
        </button>
      </div>

      {/* Search results label */}
      {searchQuery && (
        <p
          data-testid="search-results-label"
          className="text-xs text-muted-foreground px-4 pb-2"
        >
          {flatFiltered.length} resultados para &apos;{searchQuery}&apos;
        </p>
      )}

      {/* Loading skeletons */}
      {isLoading && (
        <div className="px-4 space-y-3">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              data-testid="order-skeleton"
              className="bg-muted animate-pulse h-[80px] rounded-lg"
            />
          ))}
        </div>
      )}

      {/* Empty state */}
      {isEmpty && (
        <p
          data-testid="empty-state"
          className="text-sm text-muted-foreground text-center py-8 px-4"
        >
          No hay órdenes con estos filtros
        </p>
      )}

      {/* Order list */}
      {!isLoading && !isEmpty && (
        <MobilePullToRefresh>
          <div className="px-4 space-y-4">
            {visibleGroups.map((priority) => {
              const groupOrders = grouped[priority].slice(
                0,
                // respect the visibleCount across groups by filtering from paginatedOrders
                paginatedOrders.filter((o) => computePriority(o) === priority).length,
              );

              if (groupOrders.length === 0) return null;

              return (
                <div key={priority}>
                  <p
                    data-testid={`group-header-${priority}`}
                    className="text-xs font-semibold text-muted-foreground mb-2"
                  >
                    ── {GROUP_LABELS[priority]} ({grouped[priority].length}) ──
                  </p>
                  <div className="space-y-2">
                    {groupOrders.map((order) => (
                      <MobileOrderCard
                        key={order.id}
                        order={order}
                        priority={priority}
                        onView={() => setSelectedOrderId(order.id)}
                      />
                    ))}
                  </div>
                </div>
              );
            })}

            {/* Load more */}
            {hasMore && (
              <button
                type="button"
                data-testid="load-more-btn"
                onClick={() => setVisibleCount((c) => c + 20)}
                className="w-full py-3 text-sm text-primary font-medium border border-primary rounded-lg hover:bg-primary/10"
              >
                Cargar más pedidos
              </button>
            )}
          </div>
        </MobilePullToRefresh>
      )}

      {/* Modals */}
      <MobileFilterModal
        open={filterModalOpen}
        onClose={() => setFilterModalOpen(false)}
      />

      <OrderDetailModal
        orderId={selectedOrderId}
        onClose={() => setSelectedOrderId(null)}
      />
    </div>
  );
}
