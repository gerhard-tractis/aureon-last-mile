import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ReceptionScanFeedback } from './ReceptionScanFeedback';
import { timeLabel } from '@/lib/reception/reception-mobile-helpers';

describe('ReceptionScanFeedback', () => {
  it('shows a received package as success with the received count', () => {
    render(
      <ReceptionScanFeedback
        result={{ scanResult: 'received', packageId: 'p1', packageLabel: 'CL7742891088' }}
        receivedCount={61}
      />,
    );
    expect(screen.getByText(/RECIBIDO/)).toBeInTheDocument();
    expect(screen.getByText('61')).toBeInTheDocument();
    expect(screen.getByTestId('scan-result-icon-ok')).toBeInTheDocument();
  });

  it('flags an unexpected package without blocking it: it is still received', () => {
    // spec-52: a package with no verified pickup scan on this route is still
    // accepted — rejecting it would force the receiver to lie to the system.
    // It counts toward `received` AND `unexpected`; review happens at
    // closing, not mid-unload.
    render(
      <ReceptionScanFeedback
        result={{ scanResult: 'received', packageId: 'p1', packageLabel: 'CL774', unexpected: true }}
        receivedCount={62}
      />,
    );
    expect(screen.getByText(/AJENO/)).toBeInTheDocument();
    expect(screen.getByTestId('scan-result-icon-warn')).toBeInTheDocument();
  });

  it('a duplicate scan shows when the package was first read', () => {
    const firstScanAt = '2026-08-20T12:58:00Z';
    render(
      <ReceptionScanFeedback
        result={{ scanResult: 'duplicate', packageId: 'p1', packageLabel: 'CL774' }}
        receivedCount={61}
        firstScanAt={firstScanAt}
      />,
    );
    expect(screen.getByText(/YA ESCANEADO/)).toBeInTheDocument();
    // Timezone-independent: derive the expected "HH:MM" from the same
    // formatter the component uses rather than hardcoding a locale-shifted
    // string (toLocaleTimeString also inserts a non-breaking space before
    // "a. m."/"p. m.", so only the digits are asserted here).
    const expectedHourMinute = (timeLabel(firstScanAt) as string).match(/\d{2}:\d{2}/)?.[0];
    expect(expectedHourMinute).toBeDefined();
    expect(screen.getByText(new RegExp(expectedHourMinute as string))).toBeInTheDocument();
  });

  it('a duplicate scan without a first-scan time does not fabricate one', () => {
    // The validator's duplicate branch selects only `id` — no timestamp. The
    // time comes from the snapshot lookup (Task 18) or not at all.
    render(
      <ReceptionScanFeedback
        result={{ scanResult: 'duplicate', packageId: 'p1', packageLabel: 'CL774' }}
        receivedCount={61}
        firstScanAt={null}
      />,
    );
    expect(screen.getByText(/YA ESCANEADO/)).toBeInTheDocument();
    expect(screen.queryByText(/NaN|Invalid/)).not.toBeInTheDocument();
  });

  it('not-found and route-mismatch are distinct errors', () => {
    const { rerender } = render(
      <ReceptionScanFeedback
        result={{ scanResult: 'not_found', packageId: null, packageLabel: null }}
        receivedCount={61}
      />,
    );
    expect(screen.getByText(/NO ESTÁ EN LA RUTA/)).toBeInTheDocument();
    expect(screen.getByTestId('scan-result-icon-error')).toBeInTheDocument();

    rerender(
      <ReceptionScanFeedback
        result={{ scanResult: 'route_mismatch', packageId: null, packageLabel: null }}
        receivedCount={61}
      />,
    );
    expect(screen.getByText(/ES DE OTRA RUTA/)).toBeInTheDocument();
    expect(screen.queryByText(/NO ESTÁ EN LA RUTA/)).not.toBeInTheDocument();
    expect(screen.getByTestId('scan-result-icon-error')).toBeInTheDocument();
  });

  it('renders nothing before the first scan of the session', () => {
    const { container } = render(<ReceptionScanFeedback result={null} receivedCount={0} />);
    expect(container).toBeEmptyDOMElement();
  });
});
