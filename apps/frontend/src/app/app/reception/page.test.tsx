import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import ReceptionPage from './page';

const mockActive = [
  {
    id: 'm1', external_load_id: 'CARGA-001', retailer_name: 'Easy',
    total_packages: 20, completed_at: '2026-03-25T10:00:00Z',
    reception_status: 'awaiting_reception', assigned_to_user_id: 'u1',
    hub_receptions: [{ id: 'r1', expected_count: 20, received_count: 0, status: 'pending',
      delivered_by_user: { full_name: 'Carlos López' } }],
  },
  {
    id: 'm2', external_load_id: 'CARGA-002', retailer_name: 'Sodimac',
    total_packages: 15, completed_at: '2026-03-25T11:00:00Z',
    reception_status: 'reception_in_progress', assigned_to_user_id: 'u1',
    hub_receptions: [{ id: 'r2', expected_count: 15, received_count: 8, status: 'in_progress',
      delivered_by_user: { full_name: 'Ana Ruiz' } }],
  },
];

const mockCompleted = [
  {
    id: 'm3', external_load_id: 'CARGA-000', retailer_name: 'Easy',
    total_packages: 10, completed_at: new Date().toISOString(),
    reception_status: 'received', assigned_to_user_id: 'u1',
    hub_receptions: [{ id: 'r3', expected_count: 10, received_count: 10, status: 'completed',
      completed_at: new Date().toISOString() }],
  },
];

const mockUseReceptionManifests = vi.fn();
const mockUseCompletedReceptions = vi.fn();

vi.mock('@/hooks/reception/useReceptionManifests', () => ({
  useReceptionManifests: (...args: unknown[]) => mockUseReceptionManifests(...args),
}));
vi.mock('@/hooks/reception/useCompletedReceptions', () => ({
  useCompletedReceptions: (...args: unknown[]) => mockUseCompletedReceptions(...args),
}));
vi.mock('@/hooks/useOperatorId', () => ({
  useOperatorId: () => ({ operatorId: 'op-1' }),
}));
vi.mock('@/components/reception/QRScanner', () => ({
  QRScanner: () => <div data-testid="qr-scanner" />,
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

describe('ReceptionPage', () => {
  beforeEach(() => {
    mockUseReceptionManifests.mockReturnValue({ data: mockActive, isLoading: false });
    mockUseCompletedReceptions.mockReturnValue({ data: mockCompleted, isLoading: false });
  });

  it('renders 4 MetricCards with correct values', () => {
    const { container } = render(<ReceptionPage />);
    const valueEls = container.querySelectorAll('[data-value]');
    expect(valueEls).toHaveLength(4);
    expect(valueEls[0].textContent).toBe('1');  // en tránsito
    expect(valueEls[1].textContent).toBe('1');  // en progreso
    expect(valueEls[2].textContent).toBe('1');  // completados hoy
    expect(valueEls[3].textContent).toBe('35'); // paquetes esperados
  });

  it('renders KPI labels in Spanish', () => {
    render(<ReceptionPage />);
    expect(screen.getByText('En tránsito')).toBeInTheDocument();
    expect(screen.getByText('En progreso')).toBeInTheDocument();
    expect(screen.getByText('Completados hoy')).toBeInTheDocument();
    expect(screen.getByText('Paquetes esperados')).toBeInTheDocument();
  });

  it('renders tab triggers', () => {
    render(<ReceptionPage />);
    expect(screen.getByRole('tab', { name: 'Activos' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Completados' })).toBeInTheDocument();
  });

  it('shows EmptyState when no active manifests', () => {
    mockUseReceptionManifests.mockReturnValue({ data: [], isLoading: false });
    render(<ReceptionPage />);
    expect(screen.getByText('Sin cargas pendientes')).toBeInTheDocument();
  });

  it('renders active manifest cards', () => {
    render(<ReceptionPage />);
    expect(screen.getByText('Easy')).toBeInTheDocument();
    expect(screen.getByText('Sodimac')).toBeInTheDocument();
  });

  it('has max-w constraint and responsive padding', () => {
    const { container } = render(<ReceptionPage />);
    expect(container.querySelector('.max-w-4xl')).toBeTruthy();
  });

  it('renders shadcn Button for QR scan', () => {
    render(<ReceptionPage />);
    expect(screen.getByRole('button', { name: /escanear qr/i })).toBeInTheDocument();
  });
});
