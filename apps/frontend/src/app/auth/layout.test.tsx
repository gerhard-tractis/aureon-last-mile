import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import AuthLayout from './layout';

// Mock next/link
vi.mock('next/link', () => ({
  default: ({ children, href, ...props }: { children: React.ReactNode; href: string; [key: string]: unknown }) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

// Mock AuthLogo component
vi.mock('@/components/AuthLogo', () => ({
  AuthLogo: ({ productName }: { productName: string }) => (
    // eslint-disable-next-line @next/next/no-img-element
    <img src="/icon.svg" alt={productName} />
  ),
}));

// Mock lucide-react
vi.mock('lucide-react', () => ({
  ArrowLeft: () => <span data-testid="arrow-left-icon" />,
  BarChart3: () => <span data-testid="barchart-icon" />,
  Zap: () => <span data-testid="zap-icon" />,
  FileText: () => <span data-testid="filetext-icon" />,
}));

describe('AuthLayout', () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_PRODUCTNAME = 'Aureon Last Mile';
  });

  it('renders logo image above product name', () => {
    const { container } = render(<AuthLayout><div>child</div></AuthLayout>);
    const logo = container.querySelector('img[alt="Aureon Last Mile"]');
    expect(logo).toBeTruthy();
    expect(logo?.getAttribute('src')).toBe('/icon.svg');
  });

  it('renders product name', () => {
    render(<AuthLayout><div>child</div></AuthLayout>);
    expect(screen.getByText('Aureon Last Mile')).toBeTruthy();
  });

  it('renders logistics-focused headline instead of generic SaaS copy', () => {
    render(<AuthLayout><div>child</div></AuthLayout>);
    // Should NOT have generic copy
    expect(screen.queryByText('Trusted by developers worldwide')).toBeNull();
    // Should have logistics-focused Spanish headline
    expect(screen.getAllByText(/última milla/i).length).toBeGreaterThan(0);
  });

  it('renders feature value cards instead of fake testimonials', () => {
    render(<AuthLayout><div>child</div></AuthLayout>);
    // Should NOT have fake personas
    expect(screen.queryByText('Sarah Chen')).toBeNull();
    expect(screen.queryByText('Michael Roberts')).toBeNull();
    expect(screen.queryByText('Jessica Kim')).toBeNull();
    // Should have logistics feature items
    expect(screen.getByText(/Rendimiento en tiempo real/i)).toBeTruthy();
    expect(screen.getByText(/Automatización de datos/i)).toBeTruthy();
    expect(screen.getByText(/Reportes exportables/i)).toBeTruthy();
  });

  it('renders Tractis footer instead of generic copy', () => {
    render(<AuthLayout><div>child</div></AuthLayout>);
    expect(screen.queryByText(/Join thousands/i)).toBeNull();
    expect(screen.getByText(/Tractis/i)).toBeTruthy();
  });

  it('renders children', () => {
    render(<AuthLayout><div data-testid="child">content</div></AuthLayout>);
    expect(screen.getByTestId('child')).toBeTruthy();
  });
});
