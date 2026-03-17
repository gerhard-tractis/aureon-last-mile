import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('sonner', () => ({
  toast: {
    warning: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
  },
}));

// Provide URL.createObjectURL globally since jsdom doesn't include it
beforeEach(() => {
  if (!URL.createObjectURL) {
    URL.createObjectURL = vi.fn(() => 'blob:mock-url');
  }
  if (!URL.revokeObjectURL) {
    URL.revokeObjectURL = vi.fn();
  }
});

import AuditLogExport from './AuditLogExport';

const mockLogs = [
  {
    id: 'e-1',
    operator_id: 'op-1',
    user_id: 'u-1',
    action: 'UPDATE',
    resource_type: 'orders',
    resource_id: 'order-123',
    changes_json: null,
    ip_address: '10.0.0.1',
    timestamp: '2026-03-13T14:23:00.000Z',
  },
];

const mockUserMap = { 'u-1': 'Alice' };

describe('AuditLogExport', () => {
  it('renders export button', () => {
    render(<AuditLogExport logs={mockLogs} userMap={mockUserMap} />);
    expect(screen.getByRole('button', { name: /exportar csv/i })).toBeDefined();
  });

  it('renders export button again after cleanup', () => {
    render(<AuditLogExport logs={mockLogs} userMap={mockUserMap} />);
    expect(screen.getByRole('button', { name: /exportar csv/i })).toBeDefined();
  });

  it('renders with empty logs without crashing', () => {
    render(<AuditLogExport logs={[]} userMap={{}} />);
    expect(screen.getByRole('button', { name: /exportar csv/i })).toBeDefined();
  });
});
