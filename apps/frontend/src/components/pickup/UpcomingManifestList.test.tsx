import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { UpcomingManifestList } from './UpcomingManifestList';
import type { RouteManifestRow } from './RouteManifestList';

function manifest(
  id: string,
  retailer: string,
  totalPackages: number | null = 4,
): RouteManifestRow {
  return {
    id,
    external_load_id: `LOAD-${id}`,
    retailer_name: retailer,
    pickup_location: null,
    total_orders: 2,
    total_packages: totalPackages,
    verified_count: 0,
  };
}

describe('UpcomingManifestList', () => {
  it('renders nothing when there are no upcoming manifests', () => {
    const { container } = render(<UpcomingManifestList manifests={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders the "LUEGO" heading and each manifest in compact rows', () => {
    render(
      <UpcomingManifestList
        manifests={[manifest('2', 'Ripley'), manifest('3', 'Paris')]}
      />,
    );
    expect(screen.getByText('Luego')).toBeInTheDocument();
    expect(screen.getByText('Ripley')).toBeInTheDocument();
    expect(screen.getByText('Paris')).toBeInTheDocument();
  });

  it('shows at most 3 upcoming manifests', () => {
    render(
      <UpcomingManifestList
        manifests={[
          manifest('2', 'Ripley'),
          manifest('3', 'Paris'),
          manifest('4', 'Falabella'),
          manifest('5', 'Sodimac'),
        ]}
      />,
    );
    expect(screen.getByText('Falabella')).toBeInTheDocument();
    expect(screen.queryByText('Sodimac')).toBeNull();
  });

  it('shows an unknown total as "0/—" rather than reading null as zero', () => {
    render(<UpcomingManifestList manifests={[manifest('2', 'Ripley', null)]} />);
    expect(screen.getByText('0/—')).toBeInTheDocument();
  });
});
