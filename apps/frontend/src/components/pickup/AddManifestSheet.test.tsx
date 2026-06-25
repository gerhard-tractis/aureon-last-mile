import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AddManifestSheet } from './AddManifestSheet';

describe('AddManifestSheet', () => {
  it('renders manifests and fires onPick', () => {
    const onPick = vi.fn();
    render(
      <AddManifestSheet
        open
        onOpenChange={() => {}}
        manifests={[
          { id: 'm1', external_load_id: 'LOAD-1', retailer_name: 'A', total_packages: 5 },
        ]}
        onPick={onPick}
      />
    );
    fireEvent.click(screen.getByText('A'));
    expect(onPick).toHaveBeenCalledWith('m1');
  });

  it('renders empty state', () => {
    render(
      <AddManifestSheet open onOpenChange={() => {}} manifests={[]} onPick={() => {}} />
    );
    expect(screen.getByText(/Sin manifiestos disponibles/i)).toBeInTheDocument();
  });

  it('renders loading spinner', () => {
    render(
      <AddManifestSheet
        open onOpenChange={() => {}} manifests={[]} isLoading onPick={() => {}} />
    );
    expect(document.querySelector('.animate-spin')).not.toBeNull();
  });
});
