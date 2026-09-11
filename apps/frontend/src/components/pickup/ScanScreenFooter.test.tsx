import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ScanScreenFooter } from './ScanScreenFooter';

describe('ScanScreenFooter', () => {
  it('renders the primary "Continuar a revisión" action', () => {
    render(<ScanScreenFooter onContinue={vi.fn()} onManualEntryRequested={vi.fn()} />);
    expect(screen.getByRole('button', { name: /continuar a revisión/i })).toBeInTheDocument();
  });

  it('calls onContinue when the primary button is clicked', () => {
    const onContinue = vi.fn();
    render(<ScanScreenFooter onContinue={onContinue} onManualEntryRequested={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /continuar a revisión/i }));
    expect(onContinue).toHaveBeenCalled();
  });

  // fase 5 (ronda 2 del mock, 5d) — el pie lleva, junto al primario,
  // "Ingresar código a mano". No abre un segundo campo: le devuelve el foco
  // al `ScannerInput` que ya cubre la entrada manual.
  it('renders "Ingresar código a mano" as the only secondary control', () => {
    render(<ScanScreenFooter onContinue={vi.fn()} onManualEntryRequested={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Ingresar código a mano' })).toBeInTheDocument();
  });

  it('calls onManualEntryRequested when the manual-entry control is clicked', () => {
    const onManualEntryRequested = vi.fn();
    render(<ScanScreenFooter onContinue={vi.fn()} onManualEntryRequested={onManualEntryRequested} />);
    fireEvent.click(screen.getByRole('button', { name: 'Ingresar código a mano' }));
    expect(onManualEntryRequested).toHaveBeenCalled();
  });
});
