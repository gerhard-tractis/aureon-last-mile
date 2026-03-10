import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import DashboardPage from './page';

const replaceMock = vi.fn();
let searchParams = new URLSearchParams();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: replaceMock }),
  useSearchParams: () => searchParams,
}));

describe('DashboardPage redirect', () => {
  beforeEach(() => {
    replaceMock.mockClear();
    searchParams = new URLSearchParams();
  });

  it('redirects to /app/dashboard/operaciones by default', () => {
    render(<DashboardPage />);
    expect(replaceMock).toHaveBeenCalledWith('/app/dashboard/operaciones');
  });

  it('redirects legacy tab=delivery to /app/dashboard/operaciones?tab=lastmile', () => {
    searchParams = new URLSearchParams('tab=delivery');
    render(<DashboardPage />);
    expect(replaceMock).toHaveBeenCalledWith('/app/dashboard/operaciones?tab=lastmile');
  });

  it('redirects tab=loading to /app/dashboard/operaciones?tab=loading', () => {
    searchParams = new URLSearchParams('tab=loading');
    render(<DashboardPage />);
    expect(replaceMock).toHaveBeenCalledWith('/app/dashboard/operaciones?tab=loading');
  });

  it('redirects tab=analytics_otif to /app/dashboard/analitica?tab=otif', () => {
    searchParams = new URLSearchParams('tab=analytics_otif');
    render(<DashboardPage />);
    expect(replaceMock).toHaveBeenCalledWith('/app/dashboard/analitica?tab=otif');
  });
});
