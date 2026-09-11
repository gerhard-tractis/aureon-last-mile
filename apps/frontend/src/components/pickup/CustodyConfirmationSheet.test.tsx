import { describe, it, expect, vi } from 'vitest';
import { render, screen, within, waitFor } from '@testing-library/react';
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

  it('renders a decorative drag handle (tirador)', () => {
    render(<CustodyConfirmationSheet {...baseProps()} />);
    const handle = screen.getByTestId('custody-sheet-grip');
    expect(handle).toHaveAttribute('aria-hidden', 'true');
  });

  // Ronda 2 de review (hallazgo 1c) — el nombre del test de arriba afirmaba
  // "not a dialog close X" sin comprobarlo: `SheetContent` monta ese botón
  // SIEMPRE por defecto (`ui/sheet.tsx`), y el mock no dibuja ninguna X. Esta
  // es la aserción que faltaba.
  it('does NOT render a "Close" control — the mock draws no X, and the sheet already has two explicit buttons', () => {
    render(<CustodyConfirmationSheet {...baseProps()} />);
    expect(screen.queryByRole('button', { name: 'Close' })).not.toBeInTheDocument();
  });

  // Ronda 2 de review (hallazgo 1b) — `role="alertdialog"` es el rol ARIA
  // para confirmaciones destructivas: hace que el lector interrumpa y lea
  // título+descripción. Se perdió al migrar de `AlertDialog` a `Sheet`
  // (`Dialog` pelado, `role="dialog"` por defecto).
  it('exposes role="alertdialog" — the ARIA role for an irreversible confirmation, not a plain dialog', () => {
    render(<CustodyConfirmationSheet {...baseProps()} />);
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
  });

  // Ronda 2 de review (hallazgo 1a, mayor) — verificado montando el
  // componente: sin este manejo, el foco inicial aterrizaba en el botón que
  // TRANSFIERE CUSTODIA (primer tabulable del DOM). Con teclado externo o
  // lector de pantalla, un Enter reflejo tras abrir la hoja la confirmaba
  // en vez de cancelarla. `AlertDialog` de Radix ya resolvía esto por
  // defecto (enfoca el cancel); `Sheet` no, y hay que restaurarlo a mano.
  it('moves initial focus to "Volver a revisar", NOT to the button that transfers custody', async () => {
    render(<CustodyConfirmationSheet {...baseProps()} />);
    await waitFor(() => {
      expect(document.activeElement).toBe(
        screen.getByRole('button', { name: 'Volver a revisar' })
      );
    });
  });

  // Ronda 2 de review (hallazgo 2, mayor) — mutación real que sobrevivió:
  // `side="bottom"` → `side="right"` pasaba 56/56 en verde. El primer
  // checkbox de esta fase es "hoja inferior con tirador, no diálogo
  // centrado" — mismo patrón que `DrillSheet.test.tsx:74-80`.
  it('renders as a BOTTOM sheet, not a side drawer — the mock draws a bottom sheet, not a right-side panel', () => {
    render(<CustodyConfirmationSheet {...baseProps()} />);
    const dialog = screen.getByRole('alertdialog');
    expect(dialog.className).toMatch(/inset-x-0 bottom-0|slide-out-to-bottom/);
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

  it('disables "Sí, cerrar la carga" while a previous confirm is still in flight', () => {
    render(<CustodyConfirmationSheet {...baseProps({ isSubmitting: true })} />);
    expect(screen.getByRole('button', { name: 'Sí, cerrar la carga' })).toBeDisabled();
  });
});
