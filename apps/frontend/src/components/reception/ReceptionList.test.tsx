import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ReceptionList } from './ReceptionList';
import type { ReceptionManifest } from '@/hooks/reception/useReceptionManifests';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

describe('ReceptionList', () => {
  const mockManifests: ReceptionManifest[] = [
    {
      id: 'manifest-1',
      external_load_id: 'CARGA-001',
      retailer_name: 'Easy',
      total_packages: 25,
      completed_at: '2026-03-18T10:00:00Z',
      reception_status: 'awaiting_reception',
      assigned_to_user_id: 'user-1',
      hub_receptions: [],
    },
    {
      id: 'manifest-2',
      external_load_id: 'CARGA-002',
      retailer_name: 'Sodimac',
      total_packages: 50,
      completed_at: '2026-03-18T11:00:00Z',
      reception_status: 'reception_in_progress',
      assigned_to_user_id: 'user-2',
      hub_receptions: [
        {
          id: 'reception-1',
          expected_count: 50,
          received_count: 30,
          status: 'in_progress',
        },
      ],
    },
  ];

  it('renders a card for each manifest', () => {
    render(<ReceptionList manifests={mockManifests} />);
    expect(screen.getByText('Easy')).toBeInTheDocument();
    expect(screen.getByText('Sodimac')).toBeInTheDocument();
  });

  it('shows empty state when no manifests', () => {
    render(<ReceptionList manifests={[]} />);
    expect(
      screen.getByText('No hay cargas pendientes de recepción')
    ).toBeInTheDocument();
  });

  it('renders correct number of cards', () => {
    render(<ReceptionList manifests={mockManifests} />);
    const cards = screen.getAllByRole('button');
    expect(cards).toHaveLength(2);
  });
});
