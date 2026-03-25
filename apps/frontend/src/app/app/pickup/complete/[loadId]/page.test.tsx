import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import CompletionPage from './page';

const mockUsePickupScans = vi.fn();
vi.mock('@/hooks/pickup/usePickupScans', () => ({
  usePickupScans: (...args: unknown[]) => mockUsePickupScans(...args),
}));

const mockUseMissingPackages = vi.fn();
vi.mock('@/hooks/pickup/useDiscrepancies', () => ({
  useMissingPackages: (...args: unknown[]) => mockUseMissingPackages(...args),
}));

vi.mock('@/hooks/useOperatorId', () => ({
  useOperatorId: () => ({ operatorId: 'op-1' }),
}));

vi.mock('@/lib/supabase/client', () => ({
  createSPAClient: () => {
    const makeSingle = (data: unknown) => ({
      single: () => Promise.resolve({ data }),
      eq: () => ({ single: () => Promise.resolve({ data }) }),
      is: () => ({ single: () => Promise.resolve({ data }) }),
    });
    const makeEq = (data: unknown) => ({
      eq: () => ({
        eq: () => ({
          is: () => ({ single: () => Promise.resolve({ data }) }),
        }),
        single: () => Promise.resolve({ data }),
      }),
      single: () => Promise.resolve({ data }),
    });
    return {
      from: (table: string) => {
        if (table === 'users') {
          return {
            select: () => makeEq({ full_name: 'Test User' }),
          };
        }
        return {
          select: () => makeEq({ id: 'm1', started_at: new Date().toISOString() }),
          update: () => ({ eq: () => Promise.resolve({ error: null }) }),
        };
      },
      auth: {
        getUser: () => Promise.resolve({ data: { user: { id: 'u1' } } }),
      },
    };
  },
}));

vi.mock('@/components/pickup/SignaturePad', () => ({
  SignaturePad: ({ label }: { label: string }) => <div data-testid="signature-pad">{label}</div>,
}));

vi.mock('@/components/pickup/PickupStepBreadcrumb', () => ({
  PickupStepBreadcrumb: () => <div data-testid="breadcrumb" />,
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn() },
}));

const mockPush = vi.fn();
vi.mock('next/navigation', () => ({
  useParams: () => ({ loadId: 'CARGA-001' }),
  useRouter: () => ({ push: mockPush }),
}));

describe('CompletionPage', () => {
  beforeEach(() => {
    mockUsePickupScans.mockReturnValue({
      data: [
        { id: 's1', scan_result: 'verified' },
        { id: 's2', scan_result: 'verified' },
      ],
    });
    mockUseMissingPackages.mockReturnValue({
      data: [{ id: 'pkg1', label: 'PKG-001' }],
    });
  });

  it('renders Spanish header', async () => {
    render(<CompletionPage />);
    expect(await screen.findByText('Firma y finalización')).toBeInTheDocument();
  });

  it('renders MetricCards with Spanish labels', async () => {
    render(<CompletionPage />);
    expect(await screen.findByText('Verificados')).toBeInTheDocument();
    expect(screen.getByText('Faltantes (con nota)')).toBeInTheDocument();
    expect(screen.getByText('Precisión')).toBeInTheDocument();
    expect(screen.getByText('Duración')).toBeInTheDocument();
  });

  it('renders MetricCards with data-value attributes', async () => {
    const { container } = render(<CompletionPage />);
    await screen.findByText('Verificados');
    const valueEls = container.querySelectorAll('[data-value]');
    expect(valueEls).toHaveLength(4);
    expect(valueEls[0].textContent).toBe('2');  // verified
    expect(valueEls[1].textContent).toBe('1');  // missing
  });

  it('renders Spanish legal notice', async () => {
    render(<CompletionPage />);
    expect(await screen.findByText('Aviso de transferencia de custodia')).toBeInTheDocument();
    expect(screen.getByText(/Al firmar, el operador confirma/)).toBeInTheDocument();
  });

  it('renders Spanish signature labels', async () => {
    render(<CompletionPage />);
    expect(await screen.findByText(/Firma del operador/)).toBeInTheDocument();
  });

  it('renders Spanish checkbox label', async () => {
    render(<CompletionPage />);
    expect(await screen.findByText('Agregar firma del cliente')).toBeInTheDocument();
  });

  it('renders Spanish button text', async () => {
    render(<CompletionPage />);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /completar y generar recibo/i })).toBeInTheDocument();
    });
  });

  it('has responsive padding', async () => {
    const { container } = render(<CompletionPage />);
    const wrapper = container.firstElementChild;
    expect(wrapper?.className).toContain('sm:p-6');
  });
});
