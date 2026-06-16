import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ModuleCard } from './ModuleCard';
import { ModuleKey, MODULES } from '@/lib/modules/registry';

vi.mock('./actions', () => ({
  enableModule: vi.fn(),
  disableModule: vi.fn(),
  fetchAudit: vi.fn(async () => []),
}));

describe('ModuleCard (spec-45)', () => {
  it('renders label and description', () => {
    render(
      <ModuleCard
        operatorId="op-1"
        moduleKey={ModuleKey.PICKUP}
        meta={MODULES[ModuleKey.PICKUP]}
        enabled={false}
      />,
    );
    expect(screen.getByText(MODULES[ModuleKey.PICKUP].label)).toBeInTheDocument();
  });

  it('clicking the toggle opens the reason dialog', () => {
    render(
      <ModuleCard
        operatorId="op-1"
        moduleKey={ModuleKey.PICKUP}
        meta={MODULES[ModuleKey.PICKUP]}
        enabled={false}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /enable/i }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
});
