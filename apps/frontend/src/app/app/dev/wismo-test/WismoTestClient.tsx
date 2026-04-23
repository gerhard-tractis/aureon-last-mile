'use client';

import { useState } from 'react';
import { DEFAULT_WISMO_MODEL } from '@/lib/dev/wismo-models';
import { useTestOrders } from './hooks/useTestOrders';
import { useOrderSnapshot } from './hooks/useOrderSnapshot';
import { useSimulateEvent } from './hooks/useSimulateEvent';
import { EventsPanel } from './components/EventsPanel';
import { ChatPanel } from './components/ChatPanel';
import { ActivityPanel } from './components/ActivityPanel';
import { DbStatePanel } from './components/DbStatePanel';
import { ModelSelector } from './components/ModelSelector';
import { NewOrderModal } from './components/NewOrderModal';
import type { SimulateEventResult, CreateTestOrderInput } from './hooks/types';

interface Props {
  operatorId: string;
}

type RightTab = 'activity' | 'db';

export default function WismoTestClient({ operatorId: _operatorId }: Props) {
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const [selectedModel, setSelectedModel] = useState<string>(DEFAULT_WISMO_MODEL);
  const [showNewOrderModal, setShowNewOrderModal] = useState(false);
  const [lastResult, setLastResult] = useState<SimulateEventResult | null>(null);
  const [rightTab, setRightTab] = useState<RightTab>('activity');

  const { orders, create, purge } = useTestOrders();
  const { snapshot, refresh: snapshotRefresh } = useOrderSnapshot(selectedOrderId);
  const { simulate, loading: simulateLoading } = useSimulateEvent(selectedOrderId);

  async function handleSimulate(event_type: string, payload?: Record<string, unknown>) {
    const result = await simulate({ event_type, payload, model: selectedModel });
    setLastResult(result);
    await snapshotRefresh();
  }

  async function handleStateEdit(table: string, fields: Record<string, unknown>) {
    if (!selectedOrderId) return;
    await fetch(`/api/dev/wismo-test/test-orders/${selectedOrderId}/state`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ table, fields }),
    });
    await snapshotRefresh();
  }

  async function handleCreate(input: CreateTestOrderInput) {
    const result = await create(input);
    setSelectedOrderId(result.order_id);
  }

  async function handlePurge() {
    await purge();
    setSelectedOrderId(null);
  }

  return (
    <div className="flex flex-col h-screen bg-background text-foreground">
      {/* Top bar */}
      <div className="flex items-center gap-3 px-4 py-2 border-b border-border bg-card flex-wrap">
        {/* Order selector */}
        <select
          aria-label="Order selector"
          value={selectedOrderId ?? ''}
          onChange={(e) => setSelectedOrderId(e.target.value || null)}
          className="rounded-md border border-border bg-background text-foreground text-sm px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-ring min-w-[220px]"
        >
          <option value="">— select order —</option>
          {orders.map((o) => (
            <option key={o.id} value={o.id}>
              {o.customer_name} ({o.delivery_date})
            </option>
          ))}
        </select>

        <button
          onClick={() => setShowNewOrderModal(true)}
          className="px-3 py-1.5 text-sm rounded-md border border-border bg-card text-foreground hover:bg-muted transition-colors whitespace-nowrap"
        >
          + New test order
        </button>

        <button
          onClick={handlePurge}
          className="px-3 py-1.5 text-sm rounded-md border border-destructive text-destructive hover:bg-destructive/10 transition-colors whitespace-nowrap"
        >
          Clear all test orders
        </button>

        <div className="ml-auto">
          <ModelSelector value={selectedModel} onChange={setSelectedModel} />
        </div>
      </div>

      {/* Three-column panel area */}
      <div className="grid grid-cols-[240px_1fr_320px] h-[calc(100vh-80px)] overflow-hidden">
        {/* Left: EventsPanel */}
        <div className="border-r border-border overflow-y-auto">
          <EventsPanel
            orderId={selectedOrderId}
            onSimulate={handleSimulate}
            onStateEdit={handleStateEdit}
            loading={simulateLoading}
          />
        </div>

        {/* Center: ChatPanel */}
        <div className="border-r border-border overflow-y-auto flex flex-col">
          <ChatPanel messages={snapshot?.messages ?? []} />
        </div>

        {/* Right: Activity | DB State tabs */}
        <div className="flex flex-col overflow-hidden">
          <div className="flex border-b border-border bg-card">
            <button
              onClick={() => setRightTab('activity')}
              className={`px-4 py-2 text-sm font-medium transition-colors ${
                rightTab === 'activity'
                  ? 'border-b-2 border-primary text-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              Activity
            </button>
            <button
              onClick={() => setRightTab('db')}
              className={`px-4 py-2 text-sm font-medium transition-colors ${
                rightTab === 'db'
                  ? 'border-b-2 border-primary text-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              DB State
            </button>
          </div>

          <div className="flex-1 overflow-hidden">
            {rightTab === 'activity' ? (
              <ActivityPanel
                agentEvents={snapshot?.recent_agent_events ?? []}
                estimatedCostUsd={lastResult?.estimated_cost_usd ?? null}
                modelUsed={lastResult?.model_used ?? null}
              />
            ) : (
              <DbStatePanel snapshot={snapshot ?? null} />
            )}
          </div>
        </div>
      </div>

      {/* Modals */}
      {showNewOrderModal && (
        <NewOrderModal
          onCreate={handleCreate}
          onClose={() => setShowNewOrderModal(false)}
        />
      )}
    </div>
  );
}
