import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DispatchScanRejectionSummary } from './DispatchScanRejectionSummary';

describe('DispatchScanRejectionSummary', () => {
  it('renders nothing before the first rejection — never "0 RECHAZOS"', () => {
    const { container } = render(<DispatchScanRejectionSummary rejectionCount={0} tally={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the shift counter and the reason breakdown', () => {
    render(
      <DispatchScanRejectionSummary
        rejectionCount={6}
        tally={[
          { code: 'NOT_FOUND', label: 'CÓDIGO NO ENCONTRADO', count: 4 },
          { code: 'IN_CONSOLIDATION', label: 'RETENIDO EN CONSOLIDACIÓN', count: 2 },
        ]}
      />,
    );
    expect(screen.getByText('6 RECHAZOS')).toBeInTheDocument();
    expect(screen.getByText('CÓDIGO NO ENCONTRADO')).toBeInTheDocument();
    expect(screen.getByText('4')).toBeInTheDocument();
  });

  it('spec-76 review — scoped honestly to this session, not "en este turno" (a turno can span more than this one tab)', () => {
    render(<DispatchScanRejectionSummary rejectionCount={1} tally={[]} />);
    expect(screen.getByText('en esta sesión')).toBeInTheDocument();
    expect(screen.queryByText(/en este turno/i)).not.toBeInTheDocument();
  });

  it('singularizes for one rejection', () => {
    render(<DispatchScanRejectionSummary rejectionCount={1} tally={[]} />);
    expect(screen.getByText('1 RECHAZO')).toBeInTheDocument();
  });
});
