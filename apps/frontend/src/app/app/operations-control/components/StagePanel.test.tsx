import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StagePanel } from './StagePanel';

const KPIS = [
  { label: 'Pendientes', value: '12' },
  { label: 'Vencidas', value: '3' },
  { label: 'Próx. ventana', value: '14:30' },
  { label: 'Avg espera', value: '8m' },
];

describe('StagePanel', () => {
  it('renders title and subtitle', () => {
    render(
      <StagePanel title="Recogida" subtitle="Pickups agrupados" deepLink="/app/pickup" kpis={KPIS} page={1} pageCount={1} onPageChange={() => {}} lastSyncAt={null}>
        <div>content</div>
      </StagePanel>
    );
    expect(screen.getByText('Recogida')).toBeInTheDocument();
    expect(screen.getByText('Pickups agrupados')).toBeInTheDocument();
  });

  it('renders 4 KPI values', () => {
    render(
      <StagePanel title="T" subtitle="S" deepLink={null} kpis={KPIS} page={1} pageCount={1} onPageChange={() => {}} lastSyncAt={null}>
        <div />
      </StagePanel>
    );
    expect(screen.getByText('12')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.getByText('14:30')).toBeInTheDocument();
    expect(screen.getByText('8m')).toBeInTheDocument();
  });

  it('renders deep link when provided', () => {
    render(
      <StagePanel title="T" subtitle="S" deepLink="/app/pickup" deepLinkLabel="Abrir Recogida" kpis={KPIS} page={1} pageCount={1} onPageChange={() => {}} lastSyncAt={null}>
        <div />
      </StagePanel>
    );
    const link = screen.getByText(/Abrir Recogida/);
    expect(link.closest('a')).toHaveAttribute('href', '/app/pickup');
  });

  it('renders Próximamente button when deepLink is null', () => {
    render(
      <StagePanel title="T" subtitle="S" deepLink={null} kpis={KPIS} page={1} pageCount={1} onPageChange={() => {}} lastSyncAt={null}>
        <div />
      </StagePanel>
    );
    expect(screen.getByRole('button', { name: /próximamente/i })).toBeDisabled();
  });

  it('renders children in content area', () => {
    render(
      <StagePanel title="T" subtitle="S" deepLink={null} kpis={KPIS} page={1} pageCount={1} onPageChange={() => {}} lastSyncAt={null}>
        <div data-testid="table-slot">Table here</div>
      </StagePanel>
    );
    expect(screen.getByTestId('table-slot')).toBeInTheDocument();
  });

  it('renders pagination and calls onPageChange', async () => {
    const fn = vi.fn();
    render(
      <StagePanel title="T" subtitle="S" deepLink={null} kpis={KPIS} page={2} pageCount={3} onPageChange={fn} lastSyncAt={null}>
        <div />
      </StagePanel>
    );
    expect(screen.getByText('Página 2 de 3')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /anterior/i }));
    expect(fn).toHaveBeenCalledWith(1);
  });

  it('shows sync time when lastSyncAt provided', () => {
    const syncDate = new Date('2026-04-09T14:30:00');
    render(
      <StagePanel title="T" subtitle="S" deepLink={null} kpis={KPIS} page={1} pageCount={1} onPageChange={() => {}} lastSyncAt={syncDate}>
        <div />
      </StagePanel>
    );
    expect(screen.getByText(/Tiempo real/)).toBeInTheDocument();
  });
});
