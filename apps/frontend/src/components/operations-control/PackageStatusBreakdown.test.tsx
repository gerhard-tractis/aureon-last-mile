/**
 * Tests for PackageStatusBreakdown component
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PackageStatusBreakdown } from './PackageStatusBreakdown';
import type { PackageDetail } from '@/hooks/useOrderDetail';

vi.mock('@/components/StatusBadge', () => ({
  StatusBadge: ({ status }: { status: string }) => <span data-testid="status-badge">{status}</span>,
}));

function makePackage(overrides: Partial<PackageDetail> = {}): PackageDetail {
  return {
    id: 'pkg-1',
    label: 'ABC123',
    package_number: 'P-001',
    status: 'en_ruta',
    status_updated_at: new Date(Date.now() - 15 * 60000).toISOString(), // 15 min ago
    ...overrides,
  };
}

describe('PackageStatusBreakdown', () => {
  describe('Empty state', () => {
    it('shows empty state message when packages is empty', () => {
      render(<PackageStatusBreakdown packages={[]} />);
      expect(screen.getByText('No hay paquetes registrados')).toBeTruthy();
    });
  });

  describe('Package label and number', () => {
    it('renders package label', () => {
      render(<PackageStatusBreakdown packages={[makePackage({ label: 'ABC123' })]} />);
      expect(screen.getByText('ABC123')).toBeTruthy();
    });

    it('renders package number', () => {
      render(<PackageStatusBreakdown packages={[makePackage({ package_number: 'P-001' })]} />);
      expect(screen.getByText('P-001')).toBeTruthy();
    });

    it('shows "\u2014" when package_number is null', () => {
      render(<PackageStatusBreakdown packages={[makePackage({ package_number: null })]} />);
      const cells = screen.getAllByText('\u2014');
      expect(cells.length).toBeGreaterThan(0);
    });
  });

  describe('Status badge', () => {
    it('shows status text in badge', () => {
      render(<PackageStatusBreakdown packages={[makePackage({ status: 'en_ruta' })]} />);
      expect(screen.getByTestId('pkg-status-badge-pkg-1')).toHaveTextContent('en_ruta');
    });

    it('shows "pending" when status is null (fallback via StatusBadge)', () => {
      render(<PackageStatusBreakdown packages={[makePackage({ status: null, id: 'pkg-null' })]} />);
      expect(screen.getByTestId('pkg-status-badge-pkg-null')).toHaveTextContent('pending');
    });

    it('passes correct status to StatusBadge for known status', () => {
      render(<PackageStatusBreakdown packages={[makePackage({ status: 'entregado' })]} />);
      const badge = screen.getByTestId('pkg-status-badge-pkg-1');
      expect(badge).toHaveTextContent('entregado');
    });
  });

  describe('Updated column (time-ago)', () => {
    it('shows "\u2014" when status_updated_at is null', () => {
      render(<PackageStatusBreakdown packages={[makePackage({ status_updated_at: null })]} />);
      const cells = screen.getAllByText('\u2014');
      expect(cells.length).toBeGreaterThan(0);
    });

    it('shows time-ago for recent update', () => {
      const recentTs = new Date(Date.now() - 15 * 60000).toISOString(); // 15 min ago
      render(<PackageStatusBreakdown packages={[makePackage({ status_updated_at: recentTs })]} />);
      expect(screen.getByText('hace 15m')).toBeTruthy();
    });

    it('shows hours for update over 1 hour ago', () => {
      const twoHoursAgo = new Date(Date.now() - 2 * 3600000).toISOString();
      render(<PackageStatusBreakdown packages={[makePackage({ status_updated_at: twoHoursAgo })]} />);
      expect(screen.getByText('hace 2h')).toBeTruthy();
    });
  });

  describe('spec-53 reprint icon', () => {
    it('hides the reprint icon when labelsEnabled is false', () => {
      render(<PackageStatusBreakdown packages={[makePackage()]} manifestId="m-1" labelsEnabled={false} />);
      expect(screen.queryByLabelText(/reimprimir etiqueta/i)).not.toBeInTheDocument();
    });

    it('hides the reprint icon when manifestId is null', () => {
      render(<PackageStatusBreakdown packages={[makePackage()]} manifestId={null} labelsEnabled />);
      expect(screen.queryByLabelText(/reimprimir etiqueta/i)).not.toBeInTheDocument();
    });

    it('shows a reprint link to the print route with ?packageId= when enabled', () => {
      render(
        <PackageStatusBreakdown
          packages={[makePackage({ id: 'pkg-1', label: 'ABC123' })]}
          manifestId="m-1"
          labelsEnabled
        />,
      );
      const link = screen.getByLabelText('Reimprimir etiqueta de ABC123');
      expect(link).toHaveAttribute('href', '/app/pickup/manifests/m-1/labels/print?packageId=pkg-1');
    });
  });

  describe('Multiple packages', () => {
    it('renders all packages', () => {
      const packages = [
        makePackage({ id: 'pkg-1', label: 'ABC123', package_number: 'P-001' }),
        makePackage({ id: 'pkg-2', label: 'ABC124', package_number: 'P-002' }),
      ];
      render(<PackageStatusBreakdown packages={packages} />);
      expect(screen.getByText('ABC123')).toBeTruthy();
      expect(screen.getByText('ABC124')).toBeTruthy();
      expect(screen.getByText('P-001')).toBeTruthy();
      expect(screen.getByText('P-002')).toBeTruthy();
    });
  });
});
