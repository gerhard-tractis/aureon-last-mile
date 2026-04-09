import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { ConversationThread } from './ConversationThread';
import type { ConversationSession } from '@/lib/conversations/types';

vi.mock('@/hooks/conversations/useConversationMessages', () => ({
  useConversationMessages: () => ({
    data: [
      { id: 'm1', role: 'system', body: 'Hola', wa_status: 'sent', created_at: '2026-04-09T12:00:00Z',
        operator_id: 'op1', session_id: 's1', external_message_id: null, wa_status_at: null,
        template_name: null, action_taken: null },
    ],
    isLoading: false,
  }),
}));

vi.mock('@/hooks/conversations/useSendReply', () => ({
  useSendReply: () => ({ mutate: vi.fn(), isPending: false, error: null }),
}));

vi.mock('@/hooks/conversations/useCloseSession', () => ({
  useCloseSession: () => ({ mutate: vi.fn(), isPending: false }),
}));

const session: ConversationSession = {
  id: 's1', operator_id: 'op1', order_id: 'ord1',
  customer_phone: '+56911111111', customer_name: 'Maria López',
  status: 'escalated', escalated_at: '2026-04-09T16:30:00Z',
  closed_at: null, created_at: '2026-04-09T12:00:00Z',
  updated_at: '2026-04-09T16:30:00Z', order_number: '4521',
};

function wrap(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return React.createElement(QueryClientProvider, { client: qc }, ui);
}

describe('ConversationThread', () => {
  it('shows reply box when session is escalated and user has permission', () => {
    render(wrap(<ConversationThread session={session} canReply={true} />));
    expect(screen.getByPlaceholderText(/Escribir respuesta/)).toBeInTheDocument();
  });

  it('hides reply box when user lacks permission', () => {
    render(wrap(<ConversationThread session={session} canReply={false} />));
    expect(screen.queryByPlaceholderText(/Escribir respuesta/)).toBeNull();
  });

  it('hides reply box when session is not escalated', () => {
    render(wrap(<ConversationThread session={{ ...session, status: 'active' }} canReply={true} />));
    expect(screen.queryByPlaceholderText(/Escribir respuesta/)).toBeNull();
  });

  it('renders messages', () => {
    render(wrap(<ConversationThread session={session} canReply={true} />));
    expect(screen.getByText('Hola')).toBeInTheDocument();
  });
});
