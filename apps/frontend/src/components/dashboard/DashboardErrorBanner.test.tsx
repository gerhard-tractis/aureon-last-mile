import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import DashboardErrorBanner from './DashboardErrorBanner';

vi.mock('sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn() },
}));

function renderWithClient(client: QueryClient) {
  return render(
    <QueryClientProvider client={client}>
      <DashboardErrorBanner />
    </QueryClientProvider>
  );
}

describe('DashboardErrorBanner', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    vi.clearAllMocks();
  });

  afterEach(() => {
    queryClient.clear();
  });

  it('renders the default error message', () => {
    renderWithClient(queryClient);
    expect(screen.getByText('Los datos pueden estar desactualizados')).toBeDefined();
  });

  it('renders a custom error message', () => {
    render(
      <QueryClientProvider client={queryClient}>
        <DashboardErrorBanner message="Custom error" />
      </QueryClientProvider>
    );
    expect(screen.getByText('Custom error')).toBeDefined();
  });

  it('renders a Reintentar button', () => {
    renderWithClient(queryClient);
    expect(screen.getByText('Reintentar')).toBeDefined();
  });

  it('calls toast.error on mount', async () => {
    const { toast } = await import('sonner');
    renderWithClient(queryClient);
    expect(toast.error).toHaveBeenCalledWith('Los datos pueden estar desactualizados');
  });

  it('calls refetchQueries with dashboard key on retry click', () => {
    const refetchSpy = vi.spyOn(queryClient, 'refetchQueries').mockResolvedValue();
    renderWithClient(queryClient);
    fireEvent.click(screen.getByText('Reintentar'));
    expect(refetchSpy).toHaveBeenCalledWith({ queryKey: ['dashboard'], type: 'active' });
  });
});
