import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PickupMobileNoRoute } from './PickupMobileNoRoute';

describe('PickupMobileNoRoute', () => {
  it('says no route is open and who opens it', () => {
    render(<PickupMobileNoRoute />);
    expect(screen.getByText(/no hay una ruta abierta/i)).toBeInTheDocument();
    // The message must be ACTIONABLE — naming the leader is the whole point.
    // A generic "sin ruta activa" would pass the line above and still leave
    // the picker with nothing to do, so this is a separate assertion.
    expect(screen.getByText(/líder/i)).toBeInTheDocument();
  });

  // The whole reason this component exists (spec-61): a crew member must
  // never be shown a control they cannot use. start_pickup_route refuses
  // them (migration 20260820000003), so a start button here could only ever
  // produce an error toast.
  //
  // HONEST NOTE: this is a REGRESSION GUARD, not a discriminating test — it
  // passes against any implementation that has never had a start button.
  // The falsifiable half of the pair lives in PickupMobileView.test.tsx,
  // where deleting the branch really does put 3j's button back on screen.
  it('offers no vehicle selector and no start button', () => {
    render(<PickupMobileNoRoute />);
    expect(screen.queryByRole('button', { name: /iniciar ruta/i })).toBeNull();
    expect(screen.queryByRole('combobox')).toBeNull();
  });
});
