/**
 * Tests for StatusTimeline component
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StatusTimeline } from './StatusTimeline';
import type { AuditEntry } from '@/hooks/useOrderDetail';

function makeEntry(overrides: Partial<AuditEntry> = {}): AuditEntry {
  return {
    id: 'entry-1',
    action: 'status_updated',
    timestamp: '2026-03-16T10:30:00.000Z',
    changes_json: null,
    ...overrides,
  };
}

describe('StatusTimeline', () => {
  describe('Empty state', () => {
    it('shows empty state message when auditLogs is empty', () => {
      render(<StatusTimeline auditLogs={[]} />);
      expect(screen.getByText('Sin historial de cambios')).toBeTruthy();
    });
  });

  describe('Renders entries', () => {
    it('renders action text for each log entry', () => {
      render(<StatusTimeline auditLogs={[makeEntry({ action: 'status_updated' })]} />);
      expect(screen.getByText('status_updated')).toBeTruthy();
    });

    it('renders formatted timestamp (DD/MM HH:mm)', () => {
      // 2026-03-16T10:30:00.000Z → 16/03 [HH]:30 in local time
      render(<StatusTimeline auditLogs={[makeEntry({ timestamp: '2026-03-16T10:30:00.000Z' })]} />);
      // Time portion depends on timezone; at minimum check for /30 pattern
      const timeEl = screen.getByTestId('timeline-time-entry-1');
      expect(timeEl.textContent).toMatch(/16\/03/);
    });

    it('renders multiple entries', () => {
      const logs = [
        makeEntry({ id: 'e1', action: 'created', timestamp: '2026-03-16T08:00:00.000Z' }),
        makeEntry({ id: 'e2', action: 'status_updated', timestamp: '2026-03-16T10:00:00.000Z' }),
      ];
      render(<StatusTimeline auditLogs={logs} />);
      expect(screen.getByText('created')).toBeTruthy();
      expect(screen.getByText('status_updated')).toBeTruthy();
    });
  });

  describe('Sorted by timestamp ascending', () => {
    it('renders entries sorted by timestamp ascending', () => {
      const logs = [
        makeEntry({ id: 'e2', action: 'second_action', timestamp: '2026-03-16T10:00:00.000Z' }),
        makeEntry({ id: 'e1', action: 'first_action', timestamp: '2026-03-16T08:00:00.000Z' }),
      ];
      render(<StatusTimeline auditLogs={logs} />);
      const items = screen.getAllByRole('listitem');
      expect(items[0].textContent).toContain('first_action');
      expect(items[1].textContent).toContain('second_action');
    });
  });

  describe('Null timestamp', () => {
    it('handles null timestamp gracefully', () => {
      render(<StatusTimeline auditLogs={[makeEntry({ timestamp: null })]} />);
      expect(screen.getByText('status_updated')).toBeTruthy();
    });
  });
});
