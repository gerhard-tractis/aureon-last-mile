import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { ConversationSessionCard } from './ConversationSessionCard';
import type { ConversationSession } from '@/lib/conversations/types';

const session: ConversationSession = {
  id: 's1', operator_id: 'op1', order_id: 'ord1',
  customer_phone: '+56911111111', customer_name: 'Maria López',
  status: 'escalated', escalated_at: '2026-04-09T16:30:00Z',
  closed_at: null, created_at: '2026-04-09T12:00:00Z',
  updated_at: '2026-04-09T16:30:00Z', order_number: '4521',
};

describe('ConversationSessionCard', () => {
  it('renders customer name and order number', () => {
    render(<ConversationSessionCard session={session} isSelected={false} isUnread={false} onClick={() => {}} />);
    expect(screen.getByText('Maria López')).toBeInTheDocument();
    expect(screen.getByText(/#4521/)).toBeInTheDocument();
  });

  it('shows escalated badge with amber border', () => {
    const { container } = render(
      <ConversationSessionCard session={session} isSelected={false} isUnread={false} onClick={() => {}} />,
    );
    expect(container.firstChild).toHaveClass('border-l-amber-500');
  });

  it('shows unread dot when isUnread is true', () => {
    render(<ConversationSessionCard session={session} isSelected={false} isUnread={true} onClick={() => {}} />);
    expect(screen.getByTestId('unread-dot')).toBeInTheDocument();
  });

  it('calls onClick when clicked', () => {
    const onClick = vi.fn();
    render(<ConversationSessionCard session={session} isSelected={false} isUnread={false} onClick={onClick} />);
    fireEvent.click(screen.getByText('Maria López'));
    expect(onClick).toHaveBeenCalled();
  });
});
