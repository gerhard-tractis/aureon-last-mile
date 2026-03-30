import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

// Mock ScrollReveal to passthrough
vi.mock('../scroll-reveal', () => ({
  ScrollReveal: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('next/link', () => ({
  default: ({ children, href, ...props }: { children: React.ReactNode; href: string; [key: string]: unknown }) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

import { ValueProps } from '../value-props';
import { MetricsShowcase } from '../metrics-showcase';
import { Features } from '../features';
import { Integrations } from '../integrations';
import { HowItWorks } from '../how-it-works';
import { CtaSection } from '../cta-section';
import { Footer } from '../footer';

describe('ValueProps', () => {
  it('renders section heading', () => {
    render(<ValueProps />);
    expect(screen.getByText('El problema')).toBeInTheDocument();
  });

  it('renders 3 pain point cards', () => {
    render(<ValueProps />);
    expect(screen.getByText('No conoces tu costo real por envío')).toBeInTheDocument();
    expect(screen.getByText('Entregas que fallan sin explicación')).toBeInTheDocument();
    expect(screen.getByText('Tu cliente espera todo el día sin saber nada')).toBeInTheDocument();
  });
});

describe('MetricsShowcase', () => {
  it('renders section heading', () => {
    render(<MetricsShowcase />);
    expect(screen.getByText('Los 3 indicadores que definen si tu última milla es rentable')).toBeInTheDocument();
  });

  it('renders 3 KPI cards with abbreviations', () => {
    render(<MetricsShowcase />);
    expect(screen.getByText('CPO')).toBeInTheDocument();
    expect(screen.getByText('OTIF')).toBeInTheDocument();
    expect(screen.getByText('NPS')).toBeInTheDocument();
  });

  it('renders KPI full names', () => {
    render(<MetricsShowcase />);
    expect(screen.getByText('Costo por envío')).toBeInTheDocument();
    expect(screen.getByText('On time, in full')).toBeInTheDocument();
    expect(screen.getByText('Net Promoter Score')).toBeInTheDocument();
  });
});

describe('Features', () => {
  it('renders section heading', () => {
    render(<Features />);
    expect(screen.getByText(/No es solo un dashboard/)).toBeInTheDocument();
  });

  it('renders all 4 agent features', () => {
    render(<Features />);
    expect(screen.getByText('Coordinación proactiva con cliente')).toBeInTheDocument();
    expect(screen.getByText('Actualización en ruta')).toBeInTheDocument();
    expect(screen.getByText('Post-entrega y reclamos')).toBeInTheDocument();
    expect(screen.getByText('Reagendamiento y cancelaciones')).toBeInTheDocument();
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
    expect(screen.getAllByText('Pickup').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Recepción').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Distribución').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Despacho').length).toBeGreaterThanOrEqual(1);
  });

  it('renders step numbers', () => {
    render(<HowItWorks />);
    expect(screen.getAllByText('1').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('2').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('3').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('4').length).toBeGreaterThanOrEqual(1);
  });
});

describe('CtaSection', () => {
  it('renders headline', () => {
    render(<CtaSection />);
    expect(screen.getByText('Lleva tu última milla al siguiente nivel')).toBeInTheDocument();
  });

  it('renders demo CTA', () => {
    render(<CtaSection />);
    const link = screen.getByRole('link', { name: /agenda una llamada/i });
    expect(link).toHaveAttribute('href', 'https://calendar.app.google/k9siT3q8FuxjGf9v5');
  });
});

describe('Footer', () => {
  it('renders brand', () => {
    render(<Footer />);
    expect(screen.getByText('Intelligence Applied. Results Delivered.')).toBeInTheDocument();
    expect(screen.getByText('Aureon')).toBeInTheDocument();
  });

  it('renders contact email', () => {
    render(<Footer />);
    expect(screen.getAllByText('gerhard@tractis.ai').length).toBeGreaterThan(0);
  });

  it('renders copyright', () => {
    render(<Footer />);
    expect(screen.getByText(/© 2026 Tractis/)).toBeInTheDocument();
  });

  it('renders LinkedIn links', () => {
    render(<Footer />);
    const links = screen.getAllByRole('link');
    const linkedInLinks = links.filter(
      (l) => l.getAttribute('href')?.includes('linkedin.com')
    );
    expect(linkedInLinks).toHaveLength(2);
  });
});
