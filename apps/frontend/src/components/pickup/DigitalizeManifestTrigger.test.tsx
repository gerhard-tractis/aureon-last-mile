import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { DigitalizeManifestTrigger } from './DigitalizeManifestTrigger';

/**
 * spec-82 phase 1 (mock 5c) — "Digitalizar manifiesto" placed on the
 * mobile active-route screen. Reuses the exact OCR intake flow spec-47
 * already built for desktop's "Nuevo Manifiesto" (CameraIntake /
 * useCameraIntake) — no new capability, only a new place to trigger it
 * from. CameraIntake itself is unit-tested in CameraIntake.test.tsx; these
 * tests only cover the trigger button + dialog wiring around it.
 */

// ── CameraIntake's own hook dependencies, mocked minimally so the dialog
// can mount without hitting Supabase. ──────────────────────────────────────
vi.mock('@/hooks/pickup/useCameraIntake', () => ({
  useCameraIntake: () => ({
    submit: vi.fn(),
    reset: vi.fn(),
    status: 'idle',
    result: null,
    error: null,
    uploadProgress: null,
  }),
}));

vi.mock('@/hooks/useTenantClients', () => ({
  useTenantClients: () => ({ data: [{ id: 'client-1', name: 'Easy' }], isLoading: false }),
}));

vi.mock('@/hooks/pickup/usePickupPointsByClient', () => ({
  usePickupPointsByClient: () => ({ data: [], isLoading: false }),
}));

vi.mock('@/hooks/useOperatorId', () => ({
  useOperatorId: () => ({ operatorId: 'op-123' }),
}));

function renderTrigger() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    React.createElement(
      QueryClientProvider,
      { client: queryClient },
      React.createElement(DigitalizeManifestTrigger),
    ),
  );
}

describe('DigitalizeManifestTrigger', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders a "Digitalizar manifiesto" button', () => {
    renderTrigger();
    expect(
      screen.getByRole('button', { name: /digitalizar manifiesto/i }),
    ).toBeInTheDocument();
  });

  it('the intake dialog is closed until the button is pressed', () => {
    renderTrigger();
    expect(screen.queryByTestId('client-select')).not.toBeInTheDocument();
  });

  it('opens the OCR intake flow on tap', () => {
    renderTrigger();
    fireEvent.click(screen.getByRole('button', { name: /digitalizar manifiesto/i }));
    expect(screen.getByTestId('client-select')).toBeInTheDocument();
  });

  it('closes the dialog when CameraIntake calls onClose (Cancelar)', () => {
    renderTrigger();
    fireEvent.click(screen.getByRole('button', { name: /digitalizar manifiesto/i }));
    fireEvent.click(screen.getByText('Cancelar'));
    expect(screen.queryByTestId('client-select')).not.toBeInTheDocument();
  });

  // spec-82 fase 1 ronda 2 — digitalizar desde la ruta activa y luego pulsar
  // "+" para agregarlo no mostraba el manifiesto recién creado:
  // useUnassignedManifests (staleTime 10s) está montada a nivel de página y
  // no se remonta al abrir el AddManifestSheet. Sin invalidación, el
  // conductor no puede recargar la lista sin perder el contexto de la ruta.
  it('invalidates the unassigned-manifests query when the intake dialog closes', () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
    render(
      React.createElement(
        QueryClientProvider,
        { client: queryClient },
        React.createElement(DigitalizeManifestTrigger),
      ),
    );
    fireEvent.click(screen.getByRole('button', { name: /digitalizar manifiesto/i }));
    fireEvent.click(screen.getByText('Cancelar'));
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ['pickup', 'unassigned-manifests'],
    });
  });

  // spec-82 fase 1 ronda 2, review round 2 — the invalidation above only
  // fired through CameraIntake's own onClose (its "Cancelar" button). A
  // driver who sees "N órdenes creadas" and dismisses the dialog with Esc
  // or the dialog's own X (Radix's built-in close control, not routed
  // through CameraIntake at all) hit the exact same stale-list bug through
  // the door next door: `onOpenChange={setOpen}` skipped `handleClose`
  // entirely for that exit path.
  it('invalidates the unassigned-manifests query when the dialog is dismissed via its own close control (Esc/X), not just via CameraIntake onClose', () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
    render(
      React.createElement(
        QueryClientProvider,
        { client: queryClient },
        React.createElement(DigitalizeManifestTrigger),
      ),
    );
    fireEvent.click(screen.getByRole('button', { name: /digitalizar manifiesto/i }));
    // Radix Dialog's built-in close control (top-right X, sr-only "Close"),
    // wired to onOpenChange(false) directly — never touches CameraIntake.
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ['pickup', 'unassigned-manifests'],
    });
  });

  // spec-95 fase 2 — el mock mueve este botón a la fila fija del pie, donde
  // necesita `flex-1` en vez de `w-full`. Se asierta la clase real, no sólo
  // que el botón exista: un `className` que se concatenara en vez de
  // reemplazar dejaría `w-full` conviviendo con `flex-1` y rompería la fila.
  it('defaults to a full-width button when no className is given', () => {
    renderTrigger();
    const button = screen.getByRole('button', { name: /digitalizar manifiesto/i });
    expect(button.className).toContain('w-full');
    expect(button.className).not.toContain('flex-1');
  });

  it('replaces the default width class with the given className', () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      React.createElement(
        QueryClientProvider,
        { client: queryClient },
        React.createElement(DigitalizeManifestTrigger, { className: 'flex-1' }),
      ),
    );
    const button = screen.getByRole('button', { name: /digitalizar manifiesto/i });
    expect(button.className).toContain('flex-1');
    expect(button.className).not.toContain('w-full');
  });

  // L2 (review) — un `className` de override no puede tumbar el objetivo
  // táctil mínimo (44px) del botón: eso pasaba antes, cuando `className`
  // reemplazaba el string COMPLETO en vez de sólo la parte de ancho.
  it('conserva min-h-[44px] aunque se pase un className de override', () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      React.createElement(
        QueryClientProvider,
        { client: queryClient },
        React.createElement(DigitalizeManifestTrigger, { className: 'flex-1' }),
      ),
    );
    const button = screen.getByRole('button', { name: /digitalizar manifiesto/i });
    expect(button.className).toContain('min-h-[44px]');
  });
});
