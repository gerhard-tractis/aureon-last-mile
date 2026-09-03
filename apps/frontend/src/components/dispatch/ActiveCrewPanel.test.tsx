import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ActiveCrewPanel } from './ActiveCrewPanel';
import type { CrewMember } from '@/hooks/dispatch/useLoadingMonitor';

const NOW = new Date('2026-09-03T12:00:00Z').getTime();

function makeCrew(overrides: Partial<CrewMember> = {}): CrewMember {
  return {
    userId: 'u1',
    fullName: 'Ana Soto',
    routeId: 'r1',
    loadPositionLabel: 'A3 Sur Oriente',
    scanCount: 24,
    lastScanAtIso: new Date(NOW - 8_000).toISOString(),
    ...overrides,
  };
}

describe('ActiveCrewPanel', () => {
  it('renders the section title', () => {
    render(<ActiveCrewPanel crew={[makeCrew()]} now={NOW} />);
    expect(screen.getByText('Cuadrillas activas')).toBeInTheDocument();
  });

  it('shows initials, name, andén, and scan count for each crew member', () => {
    render(<ActiveCrewPanel crew={[makeCrew()]} now={NOW} />);
    expect(screen.getByText('AS')).toBeInTheDocument();
    expect(screen.getByText('Ana Soto')).toBeInTheDocument();
    expect(screen.getByText('A3 Sur Oriente')).toBeInTheDocument();
    expect(screen.getByText('24')).toBeInTheDocument();
  });

  it('shows EN RITMO for a crew member who scanned within the stall threshold', () => {
    render(<ActiveCrewPanel crew={[makeCrew({ lastScanAtIso: new Date(NOW - 30_000).toISOString() })]} now={NOW} />);
    expect(screen.getByText('EN RITMO')).toBeInTheDocument();
  });

  it('shows DETENIDA for a crew member whose last scan is older than the stall threshold', () => {
    render(<ActiveCrewPanel crew={[makeCrew({ lastScanAtIso: new Date(NOW - 14 * 60_000).toISOString() })]} now={NOW} />);
    expect(screen.getByText('DETENIDA')).toBeInTheDocument();
  });

  it('renders no andén for a crew member whose route has none assigned', () => {
    render(<ActiveCrewPanel crew={[makeCrew({ loadPositionLabel: null })]} now={NOW} />);
    expect(screen.queryByText('A3 Sur Oriente')).not.toBeInTheDocument();
  });

  it('renders nothing (no empty-state chrome) when there is no active crew — the panel is optional context, not a primary view', () => {
    const { container } = render(<ActiveCrewPanel crew={[]} now={NOW} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders one row per distinct crew member', () => {
    render(
      <ActiveCrewPanel
        crew={[makeCrew({ userId: 'u1', fullName: 'Ana Soto' }), makeCrew({ userId: 'u2', fullName: 'Pedro Ruiz' })]}
        now={NOW}
      />,
    );
    expect(screen.getByText('Ana Soto')).toBeInTheDocument();
    expect(screen.getByText('Pedro Ruiz')).toBeInTheDocument();
  });
});
