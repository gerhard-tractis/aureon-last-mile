import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DrillDownPanel } from './DrillDownPanel';

const defaultProps = {
  title: 'Reparto',
  subtitle: 'Órdenes en reparto activo',
  deepLink: '/app/delivery',
  deepLinkLabel: 'Abrir en Reparto →',
  kpis: [
    { label: 'Total', value: '42' },
    { label: 'En ruta', value: '30' },
    { label: 'Atrasados', value: '5', trend: '↑' },
    { label: 'Sin GPS', value: '2' },
  ],
  children: <div data-testid="table-slot">Tabla</div>,
  page: 1,
  pageCount: 3,
  onPageChange: vi.fn(),
  lastSyncAt: new Date('2026-04-06T14:00:00'),
};

describe('DrillDownPanel', () => {
  it('renders the title in display font', () => {
    render(<DrillDownPanel {...defaultProps} />);
    const title = screen.getByTestId('drilldown-title');
    expect(title.textContent).toBe('Reparto');
  });

  it('renders subtitle text', () => {
    render(<DrillDownPanel {...defaultProps} />);
    expect(screen.getByText('Órdenes en reparto activo')).toBeDefined();
  });

  it('renders "Abrir en X →" button when deepLink is a string', () => {
    render(<DrillDownPanel {...defaultProps} />);
    expect(screen.getByText('Abrir en Reparto →')).toBeDefined();
    const btn = screen.getByText('Abrir en Reparto →').closest('a') ??
                screen.getByText('Abrir en Reparto →').closest('button');
    expect(btn).toBeDefined();
  });

  it('renders a disabled button with text "Próximamente" when deepLink is null', () => {
    render(<DrillDownPanel {...defaultProps} deepLink={null} />);
    expect(screen.getByText('Próximamente')).toBeDefined();
  });

  it('"Próximamente" button has the disabled attribute', () => {
    render(<DrillDownPanel {...defaultProps} deepLink={null} />);
    const btn = screen.getByText('Próximamente').closest('button');
    expect(btn).toBeDefined();
    expect((btn as HTMLButtonElement).disabled).toBe(true);
  });

  it('renders 4 KPI slots', () => {
    render(<DrillDownPanel {...defaultProps} />);
    expect(screen.getByText('Total')).toBeDefined();
    expect(screen.getByText('En ruta')).toBeDefined();
    expect(screen.getByText('Atrasados')).toBeDefined();
    expect(screen.getByText('Sin GPS')).toBeDefined();
    expect(screen.getByText('42')).toBeDefined();
    expect(screen.getByText('30')).toBeDefined();
  });

  it('renders children (table slot)', () => {
    render(<DrillDownPanel {...defaultProps} />);
    expect(screen.getByTestId('table-slot')).toBeDefined();
  });

  it('renders pagination: "Página N de M"', () => {
    render(<DrillDownPanel {...defaultProps} page={2} pageCount={5} />);
    expect(screen.getByText('Página 2 de 5')).toBeDefined();
  });

  it('"Anterior" is disabled on page 1', () => {
    render(<DrillDownPanel {...defaultProps} page={1} pageCount={3} />);
    const btn = screen.getByText('Anterior').closest('button') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  it('"Siguiente" is disabled on last page', () => {
    render(<DrillDownPanel {...defaultProps} page={3} pageCount={3} />);
    const btn = screen.getByText('Siguiente').closest('button') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  it('"Anterior" calls onPageChange(page - 1)', () => {
    const onPageChange = vi.fn();
    render(<DrillDownPanel {...defaultProps} page={2} pageCount={3} onPageChange={onPageChange} />);
    fireEvent.click(screen.getByText('Anterior'));
    expect(onPageChange).toHaveBeenCalledWith(1);
  });

  it('"Siguiente" calls onPageChange(page + 1)', () => {
    const onPageChange = vi.fn();
    render(<DrillDownPanel {...defaultProps} page={1} pageCount={3} onPageChange={onPageChange} />);
    fireEvent.click(screen.getByText('Siguiente'));
    expect(onPageChange).toHaveBeenCalledWith(2);
  });

  it('footer shows "Tiempo real · Supabase Realtime" text', () => {
    render(<DrillDownPanel {...defaultProps} />);
    expect(screen.getByText(/Tiempo real/)).toBeDefined();
    expect(screen.getByText(/Supabase Realtime/)).toBeDefined();
  });
});
