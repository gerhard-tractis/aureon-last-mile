'use client';

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';

// ── Next.js navigation mocks ───────────────────────────────────────────────────
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn() }),
  useSearchParams: () => ({ get: vi.fn().mockReturnValue(null), toString: vi.fn().mockReturnValue('') }),
}));

// ── hook mocks ─────────────────────────────────────────────────────────────────
const mockCreate = vi.fn();
const mockPurge = vi.fn();
const mockSnapshotRefresh = vi.fn();
const mockSimulate = vi.fn();

vi.mock('./hooks/useTestOrders', () => ({
  useTestOrders: vi.fn(() => ({
    orders: [
      {
        id: 'order-1',
        customer_name: 'Alice',
        customer_phone: '+56900000001',
        delivery_date: '2026-05-01',
        status: 'pending',
        created_at: '2026-04-23T00:00:00Z',
      },
    ],
    loading: false,
    error: null,
    refresh: vi.fn(),
    create: mockCreate,
    purge: mockPurge,
  })),
}));

vi.mock('./hooks/useOrderSnapshot', () => ({
  useOrderSnapshot: vi.fn(() => ({
    snapshot: null,
    loading: false,
    error: null,
    refresh: mockSnapshotRefresh,
  })),
}));

vi.mock('./hooks/useSimulateEvent', () => ({
  useSimulateEvent: vi.fn(() => ({
    loading: false,
    error: null,
    simulate: mockSimulate,
  })),
}));

// ── component mocks ────────────────────────────────────────────────────────────
vi.mock('./components/EventsPanel', () => ({
  EventsPanel: ({ orderId }: { orderId: string | null }) => (
    <div data-testid="events-panel" data-order-id={orderId ?? ''} />
  ),
}));

vi.mock('./components/ChatPanel', () => ({
  ChatPanel: () => <div data-testid="chat-panel" />,
}));

vi.mock('./components/ActivityPanel', () => ({
  ActivityPanel: () => <div data-testid="activity-panel" />,
}));

vi.mock('./components/DbStatePanel', () => ({
  DbStatePanel: () => <div data-testid="db-state-panel" />,
}));

vi.mock('./components/ModelSelector', () => ({
  ModelSelector: ({ value, onChange }: { value: string; onChange: (v: string) => void }) => (
    <select
      data-testid="model-selector"
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      <option value="meta-llama/llama-3.3-70b-instruct">Default model</option>
    </select>
  ),
}));

vi.mock('./components/NewOrderModal', () => ({
  NewOrderModal: ({ onClose }: { onClose: () => void; onCreate: (input: unknown) => Promise<void> }) => (
    <div data-testid="new-order-modal">
      <button onClick={onClose}>Close Modal</button>
    </div>
  ),
}));

import WismoTestClient from './WismoTestClient';

// ── tests ──────────────────────────────────────────────────────────────────────
describe('WismoTestClient', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders top bar elements: order selector, New button, Clear all button, ModelSelector', () => {
    render(<WismoTestClient operatorId="op-1" />);

    expect(screen.getByRole('combobox', { name: /order selector/i })).toBeInTheDocument();
    expect(screen.getByText('+ New test order')).toBeInTheDocument();
    expect(screen.getByText('Clear all test orders')).toBeInTheDocument();
    expect(screen.getByTestId('model-selector')).toBeInTheDocument();
  });

  it('new order modal is hidden by default', () => {
    render(<WismoTestClient operatorId="op-1" />);
    expect(screen.queryByTestId('new-order-modal')).not.toBeInTheDocument();
  });

  it('clicking "+ New test order" shows the new order modal', () => {
    render(<WismoTestClient operatorId="op-1" />);

    const newButton = screen.getByText('+ New test order');
    fireEvent.click(newButton);

    expect(screen.getByTestId('new-order-modal')).toBeInTheDocument();
  });

  it('renders three panel columns: EventsPanel, ChatPanel, and right tabs panel', () => {
    render(<WismoTestClient operatorId="op-1" />);

    expect(screen.getByTestId('events-panel')).toBeInTheDocument();
    expect(screen.getByTestId('chat-panel')).toBeInTheDocument();
    // Activity tab is shown by default
    expect(screen.getByTestId('activity-panel')).toBeInTheDocument();
  });

  it('shows Activity tab content by default', () => {
    render(<WismoTestClient operatorId="op-1" />);
    expect(screen.getByTestId('activity-panel')).toBeInTheDocument();
    expect(screen.queryByTestId('db-state-panel')).not.toBeInTheDocument();
  });

  it('switches to DB State panel when DB State tab is clicked', () => {
    render(<WismoTestClient operatorId="op-1" />);

    const dbTab = screen.getByText('DB State');
    fireEvent.click(dbTab);

    expect(screen.getByTestId('db-state-panel')).toBeInTheDocument();
    expect(screen.queryByTestId('activity-panel')).not.toBeInTheDocument();
  });
});
