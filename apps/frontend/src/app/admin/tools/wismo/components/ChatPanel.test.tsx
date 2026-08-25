import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { ChatPanel } from './ChatPanel';

const userMessage = {
  id: '1',
  role: 'user',
  body: 'Where is my order?',
  created_at: new Date().toISOString(),
};

const agentMessage = {
  id: '2',
  role: 'assistant',
  body: 'Your order is on the way!',
  created_at: new Date().toISOString(),
};

const systemMessage = {
  id: '3',
  role: 'system',
  body: 'Session started.',
  created_at: new Date().toISOString(),
};

describe('ChatPanel', () => {
  it('shows empty state when no messages', () => {
    render(<ChatPanel messages={[]} />);
    expect(
      screen.getByText(/No messages yet/i),
    ).toBeInTheDocument();
  });

  it('renders user message with right-alignment class', () => {
    render(<ChatPanel messages={[userMessage]} />);
    // The wrapper div for user messages should have self-end
    const text = screen.getByText('Where is my order?');
    const wrapper = text.closest('[class*="self-end"]');
    expect(wrapper).not.toBeNull();
  });

  it('renders assistant message with left-alignment class', () => {
    render(<ChatPanel messages={[agentMessage]} />);
    const text = screen.getByText('Your order is on the way!');
    const wrapper = text.closest('[class*="self-start"]');
    expect(wrapper).not.toBeNull();
  });

  it('renders system message with left-alignment class', () => {
    render(<ChatPanel messages={[systemMessage]} />);
    const text = screen.getByText('Session started.');
    const wrapper = text.closest('[class*="self-start"]');
    expect(wrapper).not.toBeNull();
  });

  it('renders multiple messages', () => {
    render(<ChatPanel messages={[userMessage, agentMessage]} />);
    expect(screen.getByText('Where is my order?')).toBeInTheDocument();
    expect(screen.getByText('Your order is on the way!')).toBeInTheDocument();
  });
});
