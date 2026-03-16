import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import AuditLogDetailRow from './AuditLogDetailRow';

const baseEntry = {
  id: 'entry-1',
  operator_id: 'op-1',
  user_id: 'user-1',
  action: 'UPDATE',
  resource_type: 'orders',
  resource_id: 'order-123',
  changes_json: {
    before: { status: 'ingresado' },
    after: { status: 'verificado' },
  },
  ip_address: '192.168.1.1',
  timestamp: '2026-03-13T14:23:00.000Z',
};

describe('AuditLogDetailRow', () => {
  it('renders before and after sections for UPDATE', () => {
    render(<AuditLogDetailRow entry={baseEntry} />);
    expect(screen.getByText(/before/i)).toBeDefined();
    expect(screen.getByText(/after/i)).toBeDefined();
  });

  it('shows changes_json content', () => {
    render(<AuditLogDetailRow entry={baseEntry} />);
    expect(screen.getByText(/ingresado/)).toBeDefined();
    expect(screen.getByText(/verificado/)).toBeDefined();
  });

  it('renders only after section for INSERT', () => {
    const entry = {
      ...baseEntry,
      action: 'INSERT',
      changes_json: { after: { status: 'ingresado' } },
    };
    render(<AuditLogDetailRow entry={entry} />);
    expect(screen.queryByText(/before/i)).toBeNull();
    expect(screen.getByText(/after/i)).toBeDefined();
  });

  it('renders only before section for DELETE', () => {
    const entry = {
      ...baseEntry,
      action: 'DELETE',
      changes_json: { before: { status: 'verificado' } },
    };
    render(<AuditLogDetailRow entry={entry} />);
    expect(screen.getByText(/before/i)).toBeDefined();
    expect(screen.queryByText(/after/i)).toBeNull();
  });

  it('handles null changes_json gracefully', () => {
    const entry = { ...baseEntry, changes_json: null };
    render(<AuditLogDetailRow entry={entry} />);
    expect(screen.getByText(/sin datos/i)).toBeDefined();
  });
});
