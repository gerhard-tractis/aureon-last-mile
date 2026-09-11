import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ScanResultPopup } from './ScanResultPopup';

describe('ScanResultPopup', () => {
  // Review de fase 5, B2 — el título en español usa la frase canónica del
  // mock (`5d`) y de `ScanHistoryList.tsx:53` — antes, el historial decía
  // "NO ESTÁ EN LA CARGA" y este popup, encima, decía "Package Not
  // Included" en inglés para el mismo evento.
  it('renders when visible', () => {
    render(<ScanResultPopup visible={true} onDismiss={vi.fn()} />);
    expect(screen.getByText('NO ESTÁ EN LA CARGA')).toBeInTheDocument();
  });

  it('does not render when not visible', () => {
    render(<ScanResultPopup visible={false} onDismiss={vi.fn()} />);
    expect(
      screen.queryByText('NO ESTÁ EN LA CARGA')
    ).not.toBeInTheDocument();
  });

  it('calls onDismiss when clicked', () => {
    const onDismiss = vi.fn();
    render(<ScanResultPopup visible={true} onDismiss={onDismiss} />);
    fireEvent.click(screen.getByRole('alert'));
    expect(onDismiss).toHaveBeenCalled();
  });

  it('has alert role for accessibility', () => {
    render(<ScanResultPopup visible={true} onDismiss={vi.fn()} />);
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });
});
