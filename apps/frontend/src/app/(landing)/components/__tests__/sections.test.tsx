import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

// Mock ScrollReveal to passthrough
vi.mock('../scroll-reveal', () => ({
  ScrollReveal: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

import { ValueProps } from '../value-props';
import { MetricsShowcase } from '../metrics-showcase';
import { Features } from '../features';
import { Integrations } from '../integrations';
import { HowItWorks } from '../how-it-works';

describe('ValueProps', () => {
  it('renders section heading', () => {
    render(<ValueProps />);
    expect(screen.getByText('Beneficios')).toBeInTheDocument();
  });

  it('renders 3 value proposition cards', () => {
    render(<ValueProps />);
    expect(screen.getByText('Operaciones más rápidas')).toBeInTheDocument();
    expect(screen.getByText('Menos entregas fallidas')).toBeInTheDocument();
    expect(screen.getByText('Decisiones con datos')).toBeInTheDocument();
  });
});

describe('MetricsShowcase', () => {
  it('renders section heading', () => {
    render(<MetricsShowcase />);
    expect(screen.getByText('Los KPIs que transforman tu operación')).toBeInTheDocument();
  });

  it('renders 3 KPI cards with abbreviations', () => {
    render(<MetricsShowcase />);
    expect(screen.getByText('CPO')).toBeInTheDocument();
    expect(screen.getByText('OTIF')).toBeInTheDocument();
    expect(screen.getByText('NPS')).toBeInTheDocument();
  });

  it('renders KPI full names', () => {
    render(<MetricsShowcase />);
    expect(screen.getByText('Costo por Envío')).toBeInTheDocument();
    expect(screen.getByText('On Time In Full')).toBeInTheDocument();
    expect(screen.getByText('Net Promoter Score')).toBeInTheDocument();
  });
});

describe('Features', () => {
  it('renders section heading', () => {
    render(<Features />);
    expect(screen.getByText('Todo lo que necesitas para tu operación')).toBeInTheDocument();
  });

  it('renders all 8 features', () => {
    render(<Features />);
    expect(screen.getByText('Despacho inteligente')).toBeInTheDocument();
    expect(screen.getByText('Escaneo y verificación')).toBeInTheDocument();
    expect(screen.getByText('Control de operaciones')).toBeInTheDocument();
    expect(screen.getByText('Ingesta con IA')).toBeInTheDocument();
    expect(screen.getByText('KPIs estratégicos')).toBeInTheDocument();
    expect(screen.getByText('Agentes de monitoreo')).toBeInTheDocument();
    expect(screen.getByText('Inteligencia operacional')).toBeInTheDocument();
    expect(screen.getByText('Reportes y auditoría')).toBeInTheDocument();
  });
});

describe('Integrations', () => {
  it('renders section heading', () => {
    render(<Integrations />);
    expect(screen.getByText(/Tu centro de comando/)).toBeInTheDocument();
  });

  it('renders integration partner names', () => {
    render(<Integrations />);
    expect(screen.getByText('DispatchTrack')).toBeInTheDocument();
    expect(screen.getByText('SimpliRoute')).toBeInTheDocument();
    expect(screen.getByText('Driv.in')).toBeInTheDocument();
    expect(screen.getByText('Y más...')).toBeInTheDocument();
  });
});

describe('HowItWorks', () => {
  it('renders all 4 steps', () => {
    render(<HowItWorks />);
    // Each step title appears twice (desktop + mobile layout)
    expect(screen.getAllByText('Carga manifiestos').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Recibe y despacha en tu hub').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Monitorea la última milla').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Mejora cada detalle').length).toBeGreaterThanOrEqual(1);
  });

  it('renders step numbers', () => {
    render(<HowItWorks />);
    expect(screen.getAllByText('1').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('2').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('3').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('4').length).toBeGreaterThanOrEqual(1);
  });
});
