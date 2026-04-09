import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { MessageBubble } from './MessageBubble';
import type { SessionMessage } from '@/lib/conversations/types';

const base: SessionMessage = {
  id: 'm1', operator_id: 'op1', session_id: 's1',
  role: 'user', body: 'Hola, dónde está mi paquete?',
  external_message_id: null, wa_status: null, wa_status_at: null,
  template_name: null, action_taken: null, created_at: '2026-04-09T12:00:00Z',
};

describe('MessageBubble', () => {
  it('renders customer message left-aligned', () => {
    render(<MessageBubble message={base} />);
    expect(screen.getByText(/Hola, dónde/)).toBeInTheDocument();
    expect(screen.getByTestId('bubble-m1').className).toContain('items-start');
  });

  it('renders agent message right-aligned in blue', () => {
    render(<MessageBubble message={{ ...base, id: 'm2', role: 'system', body: 'En camino' }} />);
    expect(screen.getByTestId('bubble-m2').className).toContain('items-end');
  });

  it('renders operator message right-aligned in purple', () => {
    render(<MessageBubble message={{ ...base, id: 'm3', role: 'operator', body: 'Disculpe' }} />);
    const bubble = screen.getByTestId('bubble-m3');
    expect(bubble.className).toContain('items-end');
  });

  it('shows wa_status icon for outbound messages', () => {
    render(<MessageBubble message={{ ...base, role: 'system', wa_status: 'delivered' }} />);
    expect(screen.getByText('✓✓')).toBeInTheDocument();
  });
});
