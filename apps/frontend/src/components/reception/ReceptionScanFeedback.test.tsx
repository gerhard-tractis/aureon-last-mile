import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ReceptionScanFeedback } from './ReceptionScanFeedback';
import { timeLabel } from '@/lib/reception/reception-mobile-helpers';

/** Extracts "HH:MM" from an ISO timestamp using the same formatter the
 *  component uses, so tests don't hardcode a timezone-shifted string.
 *  Throws (rather than casting away the nullability) if the input can't
 *  produce a label — a thrown error fails the test loudly instead of
 *  silently asserting against `undefined`. */
function expectedHourMinute(iso: string): string {
  const label = timeLabel(iso);
  if (label === null) throw new Error(`timeLabel(${iso}) returned null`);
  const match = label.match(/\d{2}:\d{2}/);
  if (match === null) throw new Error(`no HH:MM found in "${label}"`);
  return match[0];
}

describe('ReceptionScanFeedback', () => {
  it('shows a received package as success with the received count and its barcode', () => {
    render(
      <ReceptionScanFeedback
        result={{ scanResult: 'received', packageId: 'p1', packageLabel: 'CL7742891088' }}
        receivedCount={61}
      />,
    );
    expect(screen.getByText(/RECIBIDO/)).toBeInTheDocument();
    expect(screen.getByText('61')).toBeInTheDocument();
    expect(screen.getByText('CL7742891088')).toBeInTheDocument();
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
    expect(screen.getByText('62')).toBeInTheDocument();
    expect(screen.getByText('CL774')).toBeInTheDocument();
    expect(screen.getByTestId('scan-result-icon-warn')).toBeInTheDocument();
  });

  it('a duplicate scan is a warning, not an error, and shows when it was first read', () => {
    // Least obvious tone in the table — a repeat scan reads as a failure at
    // a glance, but it is a warn, not an error. Pinned explicitly so a wrong
    // mapping to "error" cannot slip through unnoticed.
    const firstScanAt = '2026-08-20T12:58:00Z';
    render(
      <ReceptionScanFeedback
        result={{ scanResult: 'duplicate', packageId: 'p1', packageLabel: 'CL774' }}
        receivedCount={61}
        firstScanAt={firstScanAt}
      />,
    );
    expect(screen.getByText(/YA ESCANEADO/)).toBeInTheDocument();
    expect(screen.getByText('CL774')).toBeInTheDocument();
    expect(screen.getByTestId('scan-result-icon-warn')).toBeInTheDocument();
    // Duplicate never moves `received_count`, so `code` is omitted — the
    // counter would otherwise read as a second increment.
    expect(screen.queryByTestId('scan-result-code')).not.toBeInTheDocument();
    expect(
      screen.getByText(new RegExp(expectedHourMinute(firstScanAt))),
    ).toBeInTheDocument();
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

  it('not-found and route-mismatch are distinct errors with no counter', () => {
    const { rerender } = render(
      <ReceptionScanFeedback
        result={{ scanResult: 'not_found', packageId: null, packageLabel: 'CL774' }}
        receivedCount={61}
      />,
    );
    expect(screen.getByText(/NO ESTÁ EN LA RUTA/)).toBeInTheDocument();
    expect(screen.getByText('CL774')).toBeInTheDocument();
    expect(screen.getByTestId('scan-result-icon-error')).toBeInTheDocument();
    expect(screen.queryByTestId('scan-result-code')).not.toBeInTheDocument();

    rerender(
      <ReceptionScanFeedback
        result={{ scanResult: 'route_mismatch', packageId: null, packageLabel: 'CL774' }}
        receivedCount={61}
      />,
    );
    expect(screen.getByText(/ES DE OTRA RUTA/)).toBeInTheDocument();
    expect(screen.queryByText(/NO ESTÁ EN LA RUTA/)).not.toBeInTheDocument();
    expect(screen.getByTestId('scan-result-icon-error')).toBeInTheDocument();
    expect(screen.queryByTestId('scan-result-code')).not.toBeInTheDocument();
  });

  it('renders nothing before the first scan of the session', () => {
    const { container } = render(<ReceptionScanFeedback result={null} receivedCount={0} />);
    expect(container).toBeEmptyDOMElement();
  });
});
