import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { BatchOverview } from './BatchOverview';
import type { ZoneGroup } from '@/hooks/distribution/usePendingSectorization';

const groups: ZoneGroup[] = [
  {
    zone: {
      id: 'z1',
      name: 'Andén 1',
      code: 'DOCK-001',
      is_consolidation: false,
      comunas: ['las condes'],
      is_active: true,
    },
    matchResult: {
      zone_id: 'z1',
      zone_name: 'Andén 1',
      zone_code: 'DOCK-001',
      is_consolidation: false,
      reason: 'matched',
      flagged: false,
    },
    packages: [
      { id: 'p1', label: 'PKG-001', order_id: 'o1', comuna: 'las condes', delivery_date: '2026-03-18' },
    ],
  },
];

describe('BatchOverview', () => {
  it('renders a card per zone group', () => {
    render(<BatchOverview groups={groups} onStartBatch={vi.fn()} />);
    expect(screen.getByText('Andén 1')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /iniciar lote/i })).toBeInTheDocument();
  });

  it('shows zone code', () => {
    render(<BatchOverview groups={groups} onStartBatch={vi.fn()} />);
    expect(screen.getByText('DOCK-001')).toBeInTheDocument();
  });

  it('shows package count', () => {
    render(<BatchOverview groups={groups} onStartBatch={vi.fn()} />);
    expect(screen.getByText(/1\s*paquete/i)).toBeInTheDocument();
  });

  it('calls onStartBatch with zone id when button clicked', () => {
    const onStartBatch = vi.fn();
    render(<BatchOverview groups={groups} onStartBatch={onStartBatch} />);
    fireEvent.click(screen.getByRole('button', { name: /iniciar lote/i }));
    expect(onStartBatch).toHaveBeenCalledWith('z1');
  });

  it('shows empty state when no groups', () => {
    render(<BatchOverview groups={[]} onStartBatch={vi.fn()} />);
    expect(screen.getByText(/no hay paquetes/i)).toBeInTheDocument();
  });

  it('renders multiple zone cards', () => {
    const multiGroups: ZoneGroup[] = [
      ...groups,
      {
        zone: { id: 'z2', name: 'Andén 2', code: 'DOCK-002', is_consolidation: false, comunas: ['providencia'], is_active: true },
        matchResult: { zone_id: 'z2', zone_name: 'Andén 2', zone_code: 'DOCK-002', is_consolidation: false, reason: 'matched', flagged: false },
        packages: [
          { id: 'p2', label: 'PKG-002', order_id: 'o2', comuna: 'providencia', delivery_date: '2026-03-18' },
          { id: 'p3', label: 'PKG-003', order_id: 'o3', comuna: 'providencia', delivery_date: '2026-03-18' },
        ],
      },
    ];
    render(<BatchOverview groups={multiGroups} onStartBatch={vi.fn()} />);
    expect(screen.getByText('Andén 1')).toBeInTheDocument();
    expect(screen.getByText('Andén 2')).toBeInTheDocument();
    expect(screen.getByText(/2\s*paquetes/i)).toBeInTheDocument();
  });
});
