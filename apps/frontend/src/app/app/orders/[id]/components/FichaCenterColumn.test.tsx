import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FichaCenterColumn } from './FichaCenterColumn';
import type { AuditEntry } from '@/hooks/useOrderDetail';
import { dossierDispatchFixture as dispatch } from '@/test/fixtures/dossierDispatch';

const mockUnifiedEventLog = vi.fn();
vi.mock('@/components/orders/UnifiedEventLog', () => ({
  UnifiedEventLog: (props: { auditLogs: unknown[]; dispatches: unknown[]; sourceFilter?: string }) => {
    mockUnifiedEventLog(props);
    return <div data-testid="unified-event-log">{props.sourceFilter}</div>;
  },
}));

function auditEntry(overrides: Partial<AuditEntry> = {}): AuditEntry {
  return { id: 'a-1', action: 'STATUS_CHANGED', timestamp: '2026-08-13T12:00:00', changes_json: null, ...overrides };
}


describe('FichaCenterColumn', () => {
  it('shows the total event count across both sources, unaffected by the active filter', () => {
    render(<FichaCenterColumn auditLogs={[auditEntry(), auditEntry({ id: 'a-2' })]} dispatches={[dispatch()]} />);
    expect(screen.getByText(/3 eventos/)).toBeInTheDocument();
  });

  it('passes the full, unfiltered auditLogs/dispatches through to UnifiedEventLog — filtering is its job now', () => {
    render(<FichaCenterColumn auditLogs={[auditEntry()]} dispatches={[dispatch()]} />);
    expect(mockUnifiedEventLog).toHaveBeenCalledWith(
      expect.objectContaining({ auditLogs: [expect.objectContaining({ id: 'a-1' })], dispatches: [expect.objectContaining({ id: 'd-1' })] }),
    );
  });

  it('defaults to sourceFilter "all"', () => {
    render(<FichaCenterColumn auditLogs={[auditEntry()]} dispatches={[dispatch()]} />);
    expect(screen.getByTestId('unified-event-log')).toHaveTextContent('all');
  });

  it('passes sourceFilter "aureon" to UnifiedEventLog when "Aureon" is selected', async () => {
    const user = userEvent.setup();
    render(<FichaCenterColumn auditLogs={[auditEntry()]} dispatches={[dispatch()]} />);
    await user.click(screen.getByRole('button', { name: 'Aureon' }));
    expect(screen.getByTestId('unified-event-log')).toHaveTextContent('aureon');
  });

  it('passes sourceFilter "dispatchtrack" to UnifiedEventLog when "DispatchTrack" is selected', async () => {
    const user = userEvent.setup();
    render(<FichaCenterColumn auditLogs={[auditEntry()]} dispatches={[dispatch()]} />);
    await user.click(screen.getByRole('button', { name: 'DispatchTrack' }));
    expect(screen.getByTestId('unified-event-log')).toHaveTextContent('dispatchtrack');
  });

  it('returns to sourceFilter "all" when "Todo" is re-selected', async () => {
    const user = userEvent.setup();
    render(<FichaCenterColumn auditLogs={[auditEntry()]} dispatches={[dispatch()]} />);
    await user.click(screen.getByRole('button', { name: 'DispatchTrack' }));
    await user.click(screen.getByRole('button', { name: 'Todo' }));
    expect(screen.getByTestId('unified-event-log')).toHaveTextContent('all');
  });

  it('keeps auditLogs/dispatches identical (unfiltered) across every filter selection', async () => {
    const user = userEvent.setup();
    render(<FichaCenterColumn auditLogs={[auditEntry()]} dispatches={[dispatch()]} />);
    await user.click(screen.getByRole('button', { name: 'Aureon' }));
    const lastCall = mockUnifiedEventLog.mock.calls.at(-1)![0];
    expect(lastCall.auditLogs).toHaveLength(1);
    expect(lastCall.dispatches).toHaveLength(1);
  });

  // Controller review, round 3 � every other ruled-out mock element has a
  // negative test; this one only had a header-component regex covering a
  // DIFFERENT component (FichaHeader). "Eventos recibidos N de M" implies
  // an expected total that doesn't exist anywhere in the schema.
  it('does not render an "eventos recibidos N de M" style counter', () => {
    render(<FichaCenterColumn auditLogs={[auditEntry(), auditEntry({ id: 'a-2' })]} dispatches={[dispatch()]} />);
    expect(screen.queryByText(/eventos recibidos/i)).toBeNull();
    expect(screen.queryByText(/\d+\s+de\s+\d+/)).toBeNull();
  });

  describe('accessibility', () => {
    it('groups the source filter buttons under a labelled role="group"', () => {
      render(<FichaCenterColumn auditLogs={[]} dispatches={[]} />);
      expect(screen.getByRole('group', { name: /fuente/i })).toBeInTheDocument();
    });

    it('marks the active filter button aria-pressed=true and the others false', async () => {
      const user = userEvent.setup();
      render(<FichaCenterColumn auditLogs={[]} dispatches={[]} />);
      expect(screen.getByRole('button', { name: 'Todo' })).toHaveAttribute('aria-pressed', 'true');
      expect(screen.getByRole('button', { name: 'Aureon' })).toHaveAttribute('aria-pressed', 'false');
      expect(screen.getByRole('button', { name: 'DispatchTrack' })).toHaveAttribute('aria-pressed', 'false');

      await user.click(screen.getByRole('button', { name: 'Aureon' }));

      expect(screen.getByRole('button', { name: 'Todo' })).toHaveAttribute('aria-pressed', 'false');
      expect(screen.getByRole('button', { name: 'Aureon' })).toHaveAttribute('aria-pressed', 'true');
      expect(screen.getByRole('button', { name: 'DispatchTrack' })).toHaveAttribute('aria-pressed', 'false');
    });
  });
});
