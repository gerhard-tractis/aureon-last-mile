import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { EnRutaMetricsRow } from './EnRutaMetricsRow';

describe('EnRutaMetricsRow', () => {
  it('renders entregadas/pendientes/fallidas and OTIF when computable', () => {
    render(<EnRutaMetricsRow metrics={{ entregadas: 184, pendientes: 71, fallidas: 13, otifPct: 94.2 }} />);
    expect(screen.getByText('184')).toBeInTheDocument();
    expect(screen.getByText('71')).toBeInTheDocument();
    expect(screen.getByText('13')).toBeInTheDocument();
    expect(screen.getByText('94,2 %')).toBeInTheDocument();
  });

  it('renders no OTIF card at all when it is not computable — never a fabricated figure', () => {
    render(<EnRutaMetricsRow metrics={{ entregadas: 0, pendientes: 0, fallidas: 0, otifPct: null }} />);
    expect(screen.queryByText(/OTIF/)).not.toBeInTheDocument();
  });
});
