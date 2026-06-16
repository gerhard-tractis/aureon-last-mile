import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ModulesAdminPage } from './ModulesAdminPage';

vi.mock('./actions', () => ({
  enableModule: vi.fn(),
  disableModule: vi.fn(),
  fetchAudit: vi.fn(async () => []),
}));

const ops = [
  {
    operator_id: 'op-1',
    operator_name: 'Tenant One',
    operator_slug: 't1',
    enabled_modules: ['ops_control'],
  },
  {
    operator_id: 'op-2',
    operator_name: 'Tenant Two',
    operator_slug: 't2',
    enabled_modules: [],
  },
];

describe('ModulesAdminPage (spec-45)', () => {
  it('renders operator picker', () => {
    render(<ModulesAdminPage operators={ops} />);
    expect(screen.getByRole('combobox', { name: /operator/i })).toBeInTheDocument();
  });

  it('shows a card per ModuleKey for the selected operator', () => {
    render(<ModulesAdminPage operators={ops} />);
    expect(
      document.querySelectorAll('[data-card="module-card"]').length,
    ).toBeGreaterThanOrEqual(9);
  });

  it('shows enabled state for ops_control when selected operator has it', () => {
    render(<ModulesAdminPage operators={ops} />);
    expect(screen.getByTestId('module-card-ops_control')).toHaveAttribute(
      'data-enabled',
      'true',
    );
  });
});
