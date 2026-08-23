import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ProofOfDelivery } from './ProofOfDelivery';
import type { DossierDispatch } from '@/hooks/useOrderDossier';
import { dossierDispatchFixture } from '@/test/fixtures/dossierDispatch';

function dispatch(overrides: Partial<DossierDispatch> = {}): DossierDispatch {
  return dossierDispatchFixture({
    id: 'dp-1',
    substatus: 'Recibido por cliente',
    substatus_code: '00',
    status: 'delivered',
    completed_at: '2026-08-13T12:41:06',
    latitude: -33.5228,
    longitude: -70.5981,
    ...overrides,
  });
}

describe('ProofOfDelivery — the empty state is the default (0 of 751 QA dispatches have a photo)', () => {
  it('states plainly that no attempt is on record when dispatch is null', () => {
    render(<ProofOfDelivery dispatch={null} />);
    expect(screen.getByText(/Sin intento de entrega registrado/)).toBeInTheDocument();
  });

  it('names the null field when DispatchTrack sent no photo — not a blank', () => {
    render(<ProofOfDelivery dispatch={dispatch({ raw_data: {} })} />);
    expect(screen.getByText(/no envió fotografía/i)).toBeInTheDocument();
    expect(screen.getByText(/photo_url/)).toBeInTheDocument();
  });

  it('names the null field when DispatchTrack sent no signature — not a blank', () => {
    render(<ProofOfDelivery dispatch={dispatch({ raw_data: { signature: null } })} />);
    expect(screen.getByText(/no envió firma/i)).toBeInTheDocument();
    expect(screen.getByText(/signature/)).toBeInTheDocument();
  });

  it('renders the actual photo when photo_url is set, not just a caption', () => {
    render(<ProofOfDelivery dispatch={dispatch({ raw_data: { photo_url: 'https://x/y.jpg' } })} />);
    expect(screen.queryByText(/no envió fotografía/i)).not.toBeInTheDocument();
    const img = screen.getByRole('img', { name: /foto del intento de entrega/i });
    expect(img).toHaveAttribute('src', 'https://x/y.jpg');
  });

  it('shows a signature confirmation when signature is present', () => {
    render(<ProofOfDelivery dispatch={dispatch({ raw_data: { signature: 'data:image/png;base64,abc' } })} />);
    expect(screen.queryByText(/no envió firma/i)).not.toBeInTheDocument();
  });

  // Review round 1 — missing signature previously used the warning palette
  // while missing photo (the common case: 751 of 751 QA rows) used plain
  // text. Warning is reserved for something actionable; "the courier didn't
  // send this field" isn't, on its own, one of those.
  it('renders the missing-signature message in the same plain style as missing-photo, not a warning palette', () => {
    render(<ProofOfDelivery dispatch={dispatch({ raw_data: {} })} />);
    const message = screen.getByText(/no envió firma/i).closest('p')!;
    expect(message.className).not.toMatch(/status-warning/);
  });

  it('renders the tokenized map placeholder with coordinates when lat/lng are present', () => {
    render(<ProofOfDelivery dispatch={dispatch({ latitude: -33.5228, longitude: -70.5981 })} />);
    expect(screen.getByTestId('pod-map-placeholder')).toBeInTheDocument();
    expect(screen.getByText(/-33[.,]5228/)).toBeInTheDocument();
  });

  it('states plainly that there is no geolocation when lat/lng are absent', () => {
    render(<ProofOfDelivery dispatch={dispatch({ latitude: null, longitude: null })} />);
    expect(screen.getByText(/Sin coordenadas registradas/)).toBeInTheDocument();
  });
});
