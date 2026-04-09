import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { ConversationList } from './ConversationList';
import type { ConversationSession, ConversationFilters } from '@/lib/conversations/types';

const sessions: ConversationSession[] = [
  { id: 's1', operator_id: 'op1', order_id: 'o1', customer_phone: '+56911111111',
    customer_name: 'Maria López', status: 'escalated', escalated_at: '2026-04-09T16:30:00Z',
    closed_at: null, created_at: '2026-04-09T12:00:00Z', updated_at: '2026-04-09T16:30:00Z',
    order_number: '4521' },
  { id: 's2', operator_id: 'op1', order_id: 'o2', customer_phone: '+56922222222',
    customer_name: 'Juan Pérez', status: 'active', escalated_at: null,
    closed_at: null, created_at: '2026-04-09T11:00:00Z', updated_at: '2026-04-09T14:27:00Z',
    order_number: '4498' },
];

describe('ConversationList', () => {
  it('renders session cards', () => {
    render(
      <ConversationList
        sessions={sessions} isLoading={false}
        selectedId={null} unreadIds={new Set()}
        onSelect={() => {}} filters={{ statuses: [], dateFrom: null, dateTo: null, search: '' }}
        onFiltersChange={() => {}}
      />,
    );
    expect(screen.getByText('Maria López')).toBeInTheDocument();
    expect(screen.getByText('Juan Pérez')).toBeInTheDocument();
  });

  it('renders search input', () => {
    render(
      <ConversationList
        sessions={[]} isLoading={false}
        selectedId={null} unreadIds={new Set()}
        onSelect={() => {}} filters={{ statuses: [], dateFrom: null, dateTo: null, search: '' }}
        onFiltersChange={() => {}}
      />,
    );
    expect(screen.getByPlaceholderText(/Buscar/)).toBeInTheDocument();
  });

  it('toggles status filter on click', () => {
    const onChange = vi.fn();
    render(
      <ConversationList
        sessions={[]} isLoading={false}
        selectedId={null} unreadIds={new Set()}
        onSelect={() => {}} filters={{ statuses: [], dateFrom: null, dateTo: null, search: '' }}
        onFiltersChange={onChange}
      />,
    );
    fireEvent.click(screen.getByText('Escalado'));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ statuses: ['escalated'] }));
  });
});
