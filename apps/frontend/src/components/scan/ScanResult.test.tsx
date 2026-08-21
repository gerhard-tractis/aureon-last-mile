import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ScanResult } from './ScanResult';

describe('ScanResult', () => {
  it('renders the destination, context and the oversized code', () => {
    render(
      <ScanResult
        status="ok"
        title="ANDÉN 3 · SUR ORIENTE"
        context="ORD-48213 · La Florida · Falabella · paquete 2 de 3"
        code="A3"
        timestamp="CONFIRMADO 12:41:07"
      />,
    );
    expect(screen.getByText('ANDÉN 3 · SUR ORIENTE')).toBeInTheDocument();
    expect(screen.getByText(/paquete 2 de 3/)).toBeInTheDocument();
    expect(screen.getByText('A3')).toBeInTheDocument();
    expect(screen.getByText('CONFIRMADO 12:41:07')).toBeInTheDocument();
  });

  it('renders the code large enough to read across a warehouse', () => {
    render(<ScanResult status="ok" title="ANDÉN 3" code="A3" />);
    // 34px Archivo is the whole point of the block — it is read at three
    // metres, by an operator whose hands are full.
    expect(screen.getByText('A3').className).toContain('text-[34px]');
  });

  it('changes colour AND icon together on error', () => {
    // Rule from the handoff: every state is carried by two channels, never
    // colour alone.
    const { container } = render(
      <ScanResult status="error" title="NO ESTÁ EN EL MANIFIESTO" context="Código CL7742119008" />,
    );
    const block = container.firstElementChild!;
    expect(block.className).toContain('bg-status-error-bg');
    expect(screen.getByTestId('scan-result-icon-error')).toBeInTheDocument();
    expect(screen.queryByTestId('scan-result-icon-ok')).toBeNull();
  });

  it('uses the success palette and check icon on ok', () => {
    const { container } = render(<ScanResult status="ok" title="ANDÉN 3" />);
    expect(container.firstElementChild!.className).toContain('bg-status-success-bg');
    expect(screen.getByTestId('scan-result-icon-ok')).toBeInTheDocument();
  });

  it('announces itself to assistive tech without stealing focus', () => {
    render(<ScanResult status="ok" title="ANDÉN 3" />);
    const region = screen.getByRole('status');
    expect(region).toBeInTheDocument();
    expect(region.getAttribute('aria-live')).toBe('polite');
  });

  it('omits the code column entirely when there is no code', () => {
    // The error case has no dock to show; leaving an empty 34px slot reads as
    // a rendering fault.
    render(<ScanResult status="error" title="NO ESTÁ EN EL MANIFIESTO" />);
    expect(screen.queryByTestId('scan-result-code')).toBeNull();
  });

  it('el tono warn cambia color e icono a la vez', () => {
    // Misma regla que ya cubre ok/error: cada estado por dos canales. Un tercer
    // tono que reusara el check de ok sería indistinguible en una foto en
    // escala de grises.
    render(<ScanResult status="warn" title="YA ESCANEADO" timestamp="12:58" />);
    expect(screen.getByText('YA ESCANEADO')).toBeInTheDocument();
    expect(screen.getByTestId('scan-result-icon-warn')).toBeInTheDocument();
    expect(screen.queryByTestId('scan-result-icon-ok')).not.toBeInTheDocument();
    expect(screen.queryByTestId('scan-result-icon-error')).not.toBeInTheDocument();
  });
});
