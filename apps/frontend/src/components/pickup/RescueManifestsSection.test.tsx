import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RescueManifestsSection } from './RescueManifestsSection';
import type { RouteManifestRow } from './RouteManifestList';

function manifest(overrides: Partial<RouteManifestRow>): RouteManifestRow {
  return {
    id: 'm1',
    external_load_id: 'CARGA-RESCUE',
    retailer_name: 'Falabella',
    pickup_location: 'Mall Plaza Vespucio',
    total_orders: 10,
    total_packages: 20,
    verified_count: 0,
    status: 'completed',
    signature_operator: null,
    ...overrides,
  };
}

function byFullText(text: string) {
  return (_content: string, node: Element | null) => node?.textContent === text;
}

describe('RescueManifestsSection', () => {
  it('renders nothing when there are no rescue manifests', () => {
    const { container } = render(<RescueManifestsSection manifests={[]} onOpen={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the section title and each manifest as a FALTA FIRMA row', () => {
    render(
      <RescueManifestsSection
        manifests={[manifest({ id: 'a', external_load_id: 'CARGA-RESCUE' })]}
        onOpen={vi.fn()}
      />,
    );
    expect(screen.getByText('Pendientes de firma')).toBeInTheDocument();
    expect(screen.getByText('FALTA FIRMA')).toBeInTheDocument();
    expect(screen.getByText(byFullText('CARGA-RESCUE'))).toBeInTheDocument();
  });

  it('calls onOpen with the external_load_id on tap', async () => {
    const onOpen = vi.fn();
    render(
      <RescueManifestsSection
        manifests={[manifest({ id: 'a', external_load_id: 'CARGA-RESCUE' })]}
        onOpen={onOpen}
      />,
    );
    await userEvent.click(screen.getByText(byFullText('CARGA-RESCUE')).closest('button')!);
    expect(onOpen).toHaveBeenCalledWith('CARGA-RESCUE');
  });

  // Asymmetric fixture — two rows, so a bug that always opens the first one
  // (or always the last) cannot pass by coincidence.
  it('opens the correct manifest when there is more than one', async () => {
    const onOpen = vi.fn();
    render(
      <RescueManifestsSection
        manifests={[
          manifest({ id: 'a', external_load_id: 'CARGA-A' }),
          manifest({ id: 'b', external_load_id: 'CARGA-B' }),
        ]}
        onOpen={onOpen}
      />,
    );
    await userEvent.click(screen.getByText(byFullText('CARGA-B')).closest('button')!);
    expect(onOpen).toHaveBeenCalledWith('CARGA-B');
    expect(onOpen).not.toHaveBeenCalledWith('CARGA-A');
  });
});
