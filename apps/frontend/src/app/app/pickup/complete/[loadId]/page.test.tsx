import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
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

const mockRpc = vi.fn(() => Promise.resolve({ data: [{ out_verified_count: 2 }], error: null }));
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
        };
      },
      rpc: mockRpc,
      auth: {
        getUser: () => Promise.resolve({ data: { user: { id: 'u1' } } }),
      },
    };
  },
}));

vi.mock('@/components/pickup/SignaturePad', () => ({
  SignaturePad: ({
    label,
    onChange,
  }: {
    label: string;
    onChange: (sig: string) => void;
  }) => (
    <button
      type="button"
      data-testid={`signature-pad-${label}`}
      onClick={() => onChange('data:image/png;base64,FAKE')}
    >
      {label}
    </button>
  ),
}));

vi.mock('@/components/pickup/PickupStepBreadcrumb', () => ({
  PickupStepBreadcrumb: () => <div data-testid="breadcrumb" />,
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
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

  it('calls close_manifest RPC (not a raw update) with p_manifest_id and p_signatures on confirm', async () => {
    render(<CompletionPage />);
    const sigPad = await screen.findByTestId('signature-pad-Firma del operador (obligatoria)');
    fireEvent.click(sigPad);

    const submitButton = await screen.findByRole('button', {
      name: /completar y generar recibo/i,
    });
    fireEvent.click(submitButton);

    const confirmButton = await screen.findByRole('button', {
      name: /confirmar y completar/i,
    });
    fireEvent.click(confirmButton);

    await waitFor(() => {
      // H5 (fix round 1): operator_name is no longer sent — the RPC derives
      // the signer's name server-side from the JWT actor. A client-supplied
      // name would be worthless as custody-transfer evidence.
      expect(mockRpc).toHaveBeenCalledWith('close_manifest', {
        p_manifest_id: 'm1',
        p_signatures: {
          operator_signature: 'data:image/png;base64,FAKE',
          client_signature: null,
          client_name: null,
        },
      });
    });
  });

  // F3 (fix round 2): close_manifest raises in English with a sentinel
  // prefix (repo pattern — see app/api/dispatch/routes/[id]/blocks/route.ts
  // reading rpcError.code + message.startsWith(...)). A crew leader on an
  // all-Spanish PWA must never see that raw Postgres text.
  const completeAndSubmit = async () => {
    render(<CompletionPage />);
    const sigPad = await screen.findByTestId('signature-pad-Firma del operador (obligatoria)');
    fireEvent.click(sigPad);

    const submitButton = await screen.findByRole('button', {
      name: /completar y generar recibo/i,
    });
    fireEvent.click(submitButton);

    const confirmButton = await screen.findByRole('button', {
      name: /confirmar y completar/i,
    });
    fireEvent.click(confirmButton);
  };

  it('maps MANIFEST_ALREADY_SIGNED to a Spanish message, not the raw RPC text', async () => {
    mockRpc.mockResolvedValueOnce({
      data: null,
      error: { message: 'MANIFEST_ALREADY_SIGNED: manifest already has an operator signature' },
    });
    const { toast } = await import('sonner');

    await completeAndSubmit();

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith(expect.any(String));
      const [message] = (toast.error as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(message).not.toContain('MANIFEST_ALREADY_SIGNED');
      expect(message).toMatch(/[áéíóúñ]|ya (fue|está)/i);
    });

    // The button must be re-enabled so the operator can retry or investigate
    // instead of being stuck on a spinner forever.
    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: /completar y generar recibo/i })
      ).not.toBeDisabled();
    });
  });

  it('maps MANIFEST_NOT_CLOSABLE to a Spanish message', async () => {
    mockRpc.mockResolvedValueOnce({
      data: null,
      error: { message: 'MANIFEST_NOT_CLOSABLE: manifest is not in a closable state (status: pending)' },
    });
    const { toast } = await import('sonner');

    await completeAndSubmit();

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith(expect.any(String));
      const [message] = (toast.error as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(message).not.toContain('MANIFEST_NOT_CLOSABLE');
      expect(message).toMatch(/[áéíóúñ]/i);
    });
  });

  it('falls back to a generic Spanish message for an unrecognized RPC error', async () => {
    mockRpc.mockResolvedValueOnce({
      data: null,
      error: { message: 'manifest not found' },
    });
    const { toast } = await import('sonner');

    await completeAndSubmit();

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('No se pudo completar el manifiesto');
    });
  });
});
