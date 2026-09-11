import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CustodyConfirmationSheet } from './CustodyConfirmationSheet';

/**
 * spec-95 fase 7, mock `5f2` — "Móvil · confirmación irreversible de la
 * transferencia de custodia (entre 5f y 5i)". Radix's `Dialog`/`Sheet`
 * portals its content to `document.body` on open, and unmounts it (removes
 * it from the DOM entirely, not just visually) on close — `queryByText`
 * (not `getByText`) is what lets a "closed" assertion pass without
 * throwing.
 */
function baseProps(overrides: Partial<React.ComponentProps<typeof CustodyConfirmationSheet>> = {}) {
  return {
    open: true,
    onOpenChange: vi.fn(),
    verifiedCount: 39,
    missingCount: 3,
    operatorName: 'Jorge Aliaga',
    clientName: null as string | null,
    serverPhotosCount: 2,
    queuedPhotosCount: 0,
    onConfirm: vi.fn(),
    isSubmitting: false,
    ...overrides,
  };
}

describe('CustodyConfirmationSheet', () => {
  it('renders nothing when closed', () => {
    render(<CustodyConfirmationSheet {...baseProps({ open: false })} />);
    expect(screen.queryByText('¿Confirmar transferencia de custodia?')).not.toBeInTheDocument();
  });

  it('renders the title and the mock’s one-sentence custody copy with the real counts', () => {
    render(<CustodyConfirmationSheet {...baseProps()} />);
    expect(screen.getByText('¿Confirmar transferencia de custodia?')).toBeInTheDocument();
    expect(
      screen.getByText(
        '39 paquetes pasan a custodia de Aureon y 3 quedan registrados como faltantes. Esta acción es irreversible.'
      )
    ).toBeInTheDocument();
  });

  // B3 de spec-95 fase 6 (mismo defecto, mismo remedio): cifras DISTINTAS de
  // las de arriba para que un string quemado en el componente no pueda
  // colar en las dos pruebas a la vez.
  it('tracks different counts, not a fixed pair (kills the hardcoded-string mutation)', () => {
    render(<CustodyConfirmationSheet {...baseProps({ verifiedCount: 7, missingCount: 5 })} />);
    expect(
      screen.getByText(
        '7 paquetes pasan a custodia de Aureon y 5 quedan registrados como faltantes. Esta acción es irreversible.'
      )
    ).toBeInTheDocument();
  });

  it('renders a decorative drag handle (tirador), not a dialog close X — the mock draws a bottom sheet', () => {
    render(<CustodyConfirmationSheet {...baseProps()} />);
    const handle = screen.getByTestId('custody-sheet-grip');
    expect(handle).toHaveAttribute('aria-hidden', 'true');
  });

  it('shows only the operator under "Firmas" when there is no client signature', () => {
    render(<CustodyConfirmationSheet {...baseProps({ operatorName: 'Jorge Aliaga', clientName: null })} />);
    const row = screen.getByTestId('custody-sheet-signers');
    expect(within(row).getByText('Jorge Aliaga')).toBeInTheDocument();
  });

  it('shows both names under "Firmas" when the client also signed, per the mock ("Jorge Aliaga · Marcela Rojas")', () => {
    render(
      <CustodyConfirmationSheet
        {...baseProps({ operatorName: 'Jorge Aliaga', clientName: 'Marcela Rojas' })}
      />
    );
    const row = screen.getByTestId('custody-sheet-signers');
    expect(within(row).getByText('Jorge Aliaga · Marcela Rojas')).toBeInTheDocument();
  });

  it('shows the photo backup count under "Respaldo", via the same backupPhotosLabel formatting as 5i', () => {
    render(<CustodyConfirmationSheet {...baseProps({ serverPhotosCount: 2, queuedPhotosCount: 0 })} />);
    const row = screen.getByTestId('custody-sheet-backup');
    expect(within(row).getByText('2 fotos')).toBeInTheDocument();
  });

  // Trampa 1 del encargo — un `serverPhotosCount` sin cargar (`null`, sin
  // nada en cola) no debe leerse como "0 fotos" en la pantalla que
  // TRANSFIERE CUSTODIA. `backupPhotosLabel` ya resuelve esto (ver
  // `manifestCloseSummary.test.ts`); esta prueba ancla que el componente no
  // lo deshace con un `?? 0` propio.
  it('does not turn an unread server photo count into "0 fotos" — reuses backupPhotosLabel’s "—"', () => {
    render(<CustodyConfirmationSheet {...baseProps({ serverPhotosCount: null, queuedPhotosCount: 0 })} />);
    const row = screen.getByTestId('custody-sheet-backup');
    expect(within(row).getByText('—')).toBeInTheDocument();
    expect(within(row).queryByText(/0 fotos/)).not.toBeInTheDocument();
  });

  it('confirms and closes when "Sí, cerrar la carga" is pressed', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    const onOpenChange = vi.fn();
    render(<CustodyConfirmationSheet {...baseProps({ onConfirm, onOpenChange })} />);

    await user.click(screen.getByRole('button', { name: 'Sí, cerrar la carga' }));

    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('closes WITHOUT confirming when "Volver a revisar" is pressed', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    const onOpenChange = vi.fn();
    render(<CustodyConfirmationSheet {...baseProps({ onConfirm, onOpenChange })} />);

    await user.click(screen.getByRole('button', { name: 'Volver a revisar' }));

    expect(onConfirm).not.toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
