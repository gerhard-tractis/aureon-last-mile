import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PackageReprintLinks } from './PackageReprintLinks';

const PACKAGES = [
  { id: 'pkg-1', label: 'CL7742891003' },
  { id: 'pkg-2', label: 'CL7742891004' },
];

/**
 * spec-65 Task 8 — `OrderPackageList` (Task 7) has no reprint affordance;
 * the per-package label reprint link (spec-53) is preserved here instead,
 * so `packageLabelsEnabled` keeps reaching real UI without OrderInspector
 * reimplementing OrderPackageList's own display logic.
 */
describe('PackageReprintLinks', () => {
  it('renders nothing when labelsEnabled is false, even with a manifest', () => {
    const { container } = render(
      <PackageReprintLinks packages={PACKAGES} manifestId="m-1" labelsEnabled={false} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing when manifestId is null, even when labels are enabled', () => {
    const { container } = render(
      <PackageReprintLinks packages={PACKAGES} manifestId={null} labelsEnabled={true} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('renders one reprint link per package pointing at that package id', () => {
    render(<PackageReprintLinks packages={PACKAGES} manifestId="m-1" labelsEnabled={true} />);
    const link1 = screen.getByRole('link', { name: /CL7742891003/i });
    const link2 = screen.getByRole('link', { name: /CL7742891004/i });
    expect(link1).toHaveAttribute('href', '/app/pickup/manifests/m-1/labels/print?packageId=pkg-1');
    expect(link2).toHaveAttribute('href', '/app/pickup/manifests/m-1/labels/print?packageId=pkg-2');
  });

  it('renders nothing when there are no packages', () => {
    const { container } = render(
      <PackageReprintLinks packages={[]} manifestId="m-1" labelsEnabled={true} />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
