import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { AuditDrawer } from './AuditDrawer';
import { ModuleKey } from '@/lib/modules/registry';

const rows = [
  {
    id: '1',
    module_key: 'pickup',
    action: 'enable',
    actor_user_id: 'u1',
    at: '2026-06-16T10:00:00Z',
    reason: 'phase-1 go-live',
  },
  {
    id: '2',
    module_key: 'pickup',
    action: 'disable',
    actor_user_id: 'u1',
    at: '2026-06-15T10:00:00Z',
    reason: 'pre-launch test',
  },
];
vi.mock('./actions', () => ({ fetchAudit: vi.fn(async () => rows) }));

describe('AuditDrawer (spec-45)', () => {
  it('renders entries in reverse chronological order', async () => {
    render(
      <AuditDrawer
        operatorId="op-1"
        moduleKey={ModuleKey.PICKUP}
        onClose={() => {}}
      />,
    );
    await waitFor(() =>
      expect(screen.getByText('phase-1 go-live')).toBeInTheDocument(),
    );
    const entries = screen.getAllByTestId('audit-entry');
    expect(entries[0]).toHaveTextContent('enable');
    expect(entries[1]).toHaveTextContent('disable');
  });

  it('filters by the supplied moduleKey', async () => {
    const { container } = render(
      <AuditDrawer
        operatorId="op-1"
        moduleKey={ModuleKey.DISPATCH}
        onClose={() => {}}
      />,
    );
    await waitFor(() =>
      expect(
        container.querySelectorAll('[data-testid="audit-entry"]').length,
      ).toBe(0),
    );
  });
});
