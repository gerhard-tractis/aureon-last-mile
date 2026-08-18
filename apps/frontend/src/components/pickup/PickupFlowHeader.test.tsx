import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PickupFlowHeader } from './PickupFlowHeader';

describe('PickupFlowHeader', () => {
  it('renders load ID', () => {
    render(
      <PickupFlowHeader
        loadId="CARGA-001"
        retailerName={null}
        pickupPoint={null}
        scanned={5}
        total={18}
        queuedCount={0}
      />
    );
    expect(screen.getByText('CARGA-001')).toBeInTheDocument();
  });

  it('renders retailer and pickup point together when both are known', () => {
    render(
      <PickupFlowHeader
        loadId="CARGA-001"
        retailerName="Falabella"
        pickupPoint="Mall Plaza Vespucio"
        scanned={5}
        total={18}
        queuedCount={0}
      />
    );
    expect(screen.getByText('Falabella · Mall Plaza Vespucio')).toBeInTheDocument();
  });

  it('omits the subtitle line entirely when neither retailer nor pickup point is known', () => {
    // Data honesty: no fabricated placeholder text when the manifest hasn't
    // loaded yet or the columns are null.
    render(
      <PickupFlowHeader
        loadId="CARGA-001"
        retailerName={null}
        pickupPoint={null}
        scanned={5}
        total={18}
        queuedCount={0}
      />
    );
    expect(screen.queryByTestId('flow-header-subtitle')).not.toBeInTheDocument();
  });

  it('renders the scanned count and "de N paquetes"', () => {
    render(
      <PickupFlowHeader
        loadId="CARGA-001"
        retailerName={null}
        pickupPoint={null}
        scanned={12}
        total={18}
        queuedCount={0}
      />
    );
    expect(screen.getByText('12')).toBeInTheDocument();
    expect(screen.getByText('de 18 paquetes')).toBeInTheDocument();
  });

  it('renders the percentage complete', () => {
    render(
      <PickupFlowHeader
        loadId="CARGA-001"
        retailerName={null}
        pickupPoint={null}
        scanned={9}
        total={18}
        queuedCount={0}
      />
    );
    expect(screen.getByText('50%')).toBeInTheDocument();
  });

  it('renders a progress bar element', () => {
    render(
      <PickupFlowHeader
        loadId="CARGA-001"
        retailerName={null}
        pickupPoint={null}
        scanned={9}
        total={18}
        queuedCount={0}
      />
    );
    expect(screen.getByRole('progressbar')).toBeInTheDocument();
  });

  it('sets progress bar width to 50% when scanned is half of total', () => {
    render(
      <PickupFlowHeader
        loadId="CARGA-001"
        retailerName={null}
        pickupPoint={null}
        scanned={9}
        total={18}
        queuedCount={0}
      />
    );
    const bar = screen.getByRole('progressbar');
    expect(bar).toHaveStyle({ width: '50%' });
  });

  it('clamps progress bar to 100% when scanned exceeds total', () => {
    render(
      <PickupFlowHeader
        loadId="CARGA-001"
        retailerName={null}
        pickupPoint={null}
        scanned={20}
        total={18}
        queuedCount={0}
      />
    );
    const bar = screen.getByRole('progressbar');
    expect(bar).toHaveStyle({ width: '100%' });
  });

  it('renders 0% progress when total is 0', () => {
    render(
      <PickupFlowHeader
        loadId="CARGA-001"
        retailerName={null}
        pickupPoint={null}
        scanned={0}
        total={0}
        queuedCount={0}
      />
    );
    const bar = screen.getByRole('progressbar');
    expect(bar).toHaveStyle({ width: '0%' });
  });

  it('floors instead of rounds, so a single missing package never reads as 100%', () => {
    // 199/200 rounds to 100% but must not claim completion while a package
    // is still outstanding.
    render(
      <PickupFlowHeader
        loadId="CARGA-001"
        retailerName={null}
        pickupPoint={null}
        scanned={199}
        total={200}
        queuedCount={0}
      />
    );
    expect(screen.getByText('99%')).toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toHaveStyle({ width: '99%' });
  });

  describe('queue badge', () => {
    it('shows "COLA N" when there are queued scans', () => {
      render(
        <PickupFlowHeader
          loadId="CARGA-001"
          retailerName={null}
          pickupPoint={null}
          scanned={5}
          total={18}
          queuedCount={27}
        />
      );
      expect(screen.getByText('COLA 27')).toBeInTheDocument();
    });

    it('hides the badge entirely when the queue is empty', () => {
      // Data honesty: "COLA 0" would still be a claim about state; the
      // handoff rule is to neutralise/hide it, not show a zero.
      render(
        <PickupFlowHeader
          loadId="CARGA-001"
          retailerName={null}
          pickupPoint={null}
          scanned={5}
          total={18}
          queuedCount={0}
        />
      );
      expect(screen.queryByTestId('queue-badge')).not.toBeInTheDocument();
    });
  });
});
