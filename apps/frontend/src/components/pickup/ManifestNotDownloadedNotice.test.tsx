import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ManifestNotDownloadedNotice } from './ManifestNotDownloadedNotice';

describe('ManifestNotDownloadedNotice', () => {
  it('names the carga and says it needs a connection', () => {
    render(<ManifestNotDownloadedNotice externalLoadId="CARGA-99820" onBack={() => {}} />);
    expect(screen.getByText(/CARGA-99820/)).toBeInTheDocument();
    expect(screen.getByText(/no.*descargad/i)).toBeInTheDocument();
    expect(screen.getByText(/conex/i)).toBeInTheDocument();
  });

  it('never claims the carga can be scanned', () => {
    render(<ManifestNotDownloadedNotice externalLoadId="CARGA-99820" onBack={() => {}} />);
    expect(screen.queryByRole('button', { name: /escanear/i })).toBeNull();
  });

  // spec-82 fase 2, revisión B1 — la versión anterior de este texto decía
  // "Necesitas conexión para traerla antes de poder escanear sin red",
  // que afirma justo lo contrario de la realidad: descargar NUNCA habilita
  // escanear sin red (useScanMutation sigue yendo directo a Supabase). El
  // texto no puede prometer eso ni aquí ni implícitamente.
  it('never promises that downloading enables scanning without a connection', () => {
    render(<ManifestNotDownloadedNotice externalLoadId="CARGA-99820" onBack={() => {}} />);
    expect(screen.queryByText(/escanear sin red/i)).toBeNull();
    expect(screen.queryByText(/podrás escanear/i)).toBeNull();
  });

  it('calls onBack when the back action is pressed', async () => {
    const onBack = vi.fn();
    render(<ManifestNotDownloadedNotice externalLoadId="CARGA-99820" onBack={onBack} />);
    await userEvent.click(screen.getByRole('button', { name: /volver/i }));
    expect(onBack).toHaveBeenCalled();
  });
});
