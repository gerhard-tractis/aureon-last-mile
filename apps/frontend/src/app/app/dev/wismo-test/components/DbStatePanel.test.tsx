import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { DbStatePanel } from './DbStatePanel';
import type { TestOrderSnapshot } from '../hooks/types';

const mockSnapshot: TestOrderSnapshot = {
  order: { id: 'ord-1', customer_name: 'Jane Doe', status: 'pending' },
  assignment: { id: 'asgn-1', status: 'in_transit' },
  dispatch: { id: 'dsp-1', estimated_at: '2026-04-23T14:00:00Z' },
  session: { id: 'sess-1', channel: 'sms' },
  messages: [],
  reschedules: [{ id: 'rsc-1', new_date: '2026-04-25' }],
  recent_agent_events: [],
};

const snapshotNoSession: TestOrderSnapshot = {
  ...mockSnapshot,
  session: null,
  reschedules: [],
};

describe('DbStatePanel', () => {
  it('shows empty state when snapshot is null', () => {
    render(<DbStatePanel snapshot={null} />);
    expect(screen.getByText(/Select a test order to view DB state/i)).toBeInTheDocument();
  });

  it('renders order data when snapshot is provided', () => {
    render(<DbStatePanel snapshot={mockSnapshot} />);
    expect(screen.getByText('Order')).toBeInTheDocument();
    // JSON content should appear in a pre block
    expect(screen.getByText(/Jane Doe/)).toBeInTheDocument();
  });

  it('renders assignment and dispatch sections', () => {
    render(<DbStatePanel snapshot={mockSnapshot} />);
    expect(screen.getByText('Latest Assignment')).toBeInTheDocument();
    expect(screen.getByText('Latest Dispatch')).toBeInTheDocument();
    expect(screen.getByText(/in_transit/)).toBeInTheDocument();
  });

  it('shows "No active session" when session is null', () => {
    render(<DbStatePanel snapshot={snapshotNoSession} />);
    expect(screen.getByText('No active session')).toBeInTheDocument();
  });

  it('renders session data when session is present', () => {
    render(<DbStatePanel snapshot={mockSnapshot} />);
    expect(screen.getByText(/sess-1/)).toBeInTheDocument();
  });

  it('renders reschedules list', () => {
    render(<DbStatePanel snapshot={mockSnapshot} />);
    expect(screen.getByText(/Order Reschedules \(1\)/)).toBeInTheDocument();
    expect(screen.getByText(/rsc-1/)).toBeInTheDocument();
  });

  it('shows None when no reschedules', () => {
    render(<DbStatePanel snapshot={snapshotNoSession} />);
    expect(screen.getByText('None')).toBeInTheDocument();
  });
});
