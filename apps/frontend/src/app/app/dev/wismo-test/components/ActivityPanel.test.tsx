import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { ActivityPanel } from './ActivityPanel';

const mockEvent = {
  id: 'evt-1',
  event_type: 'agent_reply',
  meta: { tool: 'send_message', summary: 'Sent ETA update' },
  created_at: new Date().toISOString(),
};

describe('ActivityPanel', () => {
  it('shows empty state when no events and no cost/model', () => {
    render(<ActivityPanel agentEvents={[]} estimatedCostUsd={null} modelUsed={null} />);
    expect(screen.getByText(/No activity yet/i)).toBeInTheDocument();
  });

  it('shows empty state text when events list is empty but model/cost present', () => {
    render(<ActivityPanel agentEvents={[]} estimatedCostUsd={0.0012} modelUsed="meta-llama/llama-3.3-70b-instruct" />);
    expect(screen.getByText(/No activity yet/i)).toBeInTheDocument();
    expect(screen.getByText(/Cost: ~\$0\.0012/)).toBeInTheDocument();
    expect(screen.getByText(/Model:/)).toBeInTheDocument();
  });

  it('renders event rows', () => {
    render(<ActivityPanel agentEvents={[mockEvent]} estimatedCostUsd={null} modelUsed={null} />);
    expect(screen.getByText('agent_reply')).toBeInTheDocument();
    expect(screen.getByText('send_message')).toBeInTheDocument();
    expect(screen.getByText('Sent ETA update')).toBeInTheDocument();
  });

  it('shows cost when estimatedCostUsd is non-null', () => {
    render(<ActivityPanel agentEvents={[mockEvent]} estimatedCostUsd={0.0025} modelUsed={null} />);
    expect(screen.getByText(/Cost: ~\$0\.0025/)).toBeInTheDocument();
  });

  it('does not show cost when estimatedCostUsd is null', () => {
    render(<ActivityPanel agentEvents={[mockEvent]} estimatedCostUsd={null} modelUsed={null} />);
    expect(screen.queryByText(/Cost:/)).toBeNull();
  });

  it('shows model when modelUsed is non-null', () => {
    render(<ActivityPanel agentEvents={[]} estimatedCostUsd={null} modelUsed="openai/gpt-4o-mini" />);
    expect(screen.getByText(/Model: openai\/gpt-4o-mini/)).toBeInTheDocument();
  });
});
