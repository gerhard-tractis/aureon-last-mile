import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { RouteQRView } from './RouteQRView';

describe('RouteQRView', () => {
  it('renders code, counts and a QR with routeId', () => {
    render(
      <RouteQRView
        routeId="route-uuid-1"
        code="PR-2026-0042"
        manifestCount={2}
        packageCount={9}
        onDismiss={() => {}}
      />
    );
    expect(screen.getByTestId('route-code')).toHaveTextContent('PR-2026-0042');
    expect(screen.getByText(/2 manifiestos/i)).toBeInTheDocument();
    expect(screen.getByText(/9 paquetes/i)).toBeInTheDocument();
    const qr = screen.getByTestId('route-qr');
    expect(qr).toBeInTheDocument();
  });

  it('fires onDismiss', () => {
    const onDismiss = vi.fn();
    render(
      <RouteQRView
        routeId="r1"
        code="PR-X"
        manifestCount={1}
        packageCount={1}
        onDismiss={onDismiss}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: /Volver/i }));
    expect(onDismiss).toHaveBeenCalled();
  });
});
