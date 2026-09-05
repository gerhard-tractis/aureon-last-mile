import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('./DispatchRouteDispatchReview', () => ({
  DispatchRouteDispatchReview: (props: { onDispatched: (o: { externalRouteId: string; packagesDispatched: number }) => void }) => (
    <button type="button" onClick={() => props.onDispatched({ externalRouteId: 'DT-1', packagesDispatched: 5 })}>
      stub-review-dispatch
    </button>
  ),
}));

vi.mock('./DispatchRouteAcceptance', () => ({
  DispatchRouteAcceptance: (props: { externalRouteId: string; packagesDispatched: number }) => (
    <div data-testid="stub-acceptance">
      {props.externalRouteId} {props.packagesDispatched}
    </div>
  ),
}));

import userEvent from '@testing-library/user-event';
import { DispatchRouteHandoff, type DispatchRouteHandoffProps } from './DispatchRouteHandoff';

const BASE_PROPS: DispatchRouteHandoffProps = {
  routeId: 'r1',
  operatorId: 'op-1',
  routeCode: 'RUT-0099',
  driverName: 'Mario',
  vehicleExternalId: 'RTHK-72',
  routeDate: '2026-09-05',
  stopsCount: 24,
  packagesCount: 148,
  packagesLeftAtDock: 0,
  splitOrdersCount: 0,
  onBack: vi.fn(),
  onOpenNextLoad: vi.fn(),
};

beforeEach(() => vi.resetAllMocks());

describe('DispatchRouteHandoff', () => {
  it('starts on the review, swaps to the acceptance once dispatched', async () => {
    const user = userEvent.setup();
    render(<DispatchRouteHandoff {...BASE_PROPS} />);
    expect(screen.getByText('stub-review-dispatch')).toBeInTheDocument();
    await user.click(screen.getByText('stub-review-dispatch'));
    expect(screen.getByTestId('stub-acceptance')).toHaveTextContent('DT-1 5');
  });
});
