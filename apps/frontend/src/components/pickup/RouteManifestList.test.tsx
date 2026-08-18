import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { RouteManifestList } from './RouteManifestList';

describe('RouteManifestList', () => {
  it('shows empty state when no manifests', () => {
    render(<RouteManifestList manifests={[]} onManifestClick={() => {}} />);
    expect(screen.getByText(/Sin manifiestos en la ruta/i)).toBeInTheDocument();
  });

  it('renders each manifest with verified/expected counts', () => {
    render(
      <RouteManifestList
        manifests={[
          {
            id: 'm1',
            external_load_id: 'LOAD-1',
            retailer_name: 'Retailer A',
            pickup_location: null,
            total_orders: 4,
            total_packages: 10,
            verified_count: 7,
          },
        ]}
        onManifestClick={() => {}}
      />
    );
    expect(screen.getByText('Retailer A')).toBeInTheDocument();
    expect(screen.getByText('LOAD-1')).toBeInTheDocument();
    expect(screen.getByText('7/10')).toBeInTheDocument();
  });

  it('fires onManifestClick with external_load_id', () => {
    const onClick = vi.fn();
    render(
      <RouteManifestList
        manifests={[
          {
            id: 'm1',
            external_load_id: 'LOAD-1',
            retailer_name: 'A',
            pickup_location: null,
            total_orders: 1,
            total_packages: 1,
            verified_count: 1,
          },
        ]}
        onManifestClick={onClick}
      />
    );
    fireEvent.click(screen.getByText('A').closest('button')!);
    expect(onClick).toHaveBeenCalledWith('LOAD-1');
  });

  // spec-54 phase 4.6 fix: `verified_count < (total_packages ?? 0)` read a
  // null total as zero, so a manifest intake never recorded a count for
  // silently rendered as "Verificación completa".
  it('shows an unknown total as "N/—" and never claims it is complete', () => {
    render(
      <RouteManifestList
        manifests={[
          {
            id: 'm1',
            external_load_id: 'LOAD-1',
            retailer_name: 'A',
            pickup_location: null,
            total_orders: 1,
            total_packages: null,
            verified_count: 3,
          },
        ]}
        onManifestClick={() => {}}
      />
    );
    expect(screen.getByText('3/—')).toBeInTheDocument();
    expect(screen.queryByText('Verificación completa')).toBeNull();
  });
});
