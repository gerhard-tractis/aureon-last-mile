import type { Metadata } from 'next';
import { createSSRClient } from '@/lib/supabase/server';

import { Navbar } from './(landing)/components/navbar';
import { Hero } from './(landing)/components/hero';
import { ValueProps } from './(landing)/components/value-props';
import { MetricsShowcase } from './(landing)/components/metrics-showcase';
import { Features } from './(landing)/components/features';
import { Integrations } from './(landing)/components/integrations';
import { HowItWorks } from './(landing)/components/how-it-works';
import { CtaSection } from './(landing)/components/cta-section';
import { Footer } from './(landing)/components/footer';

export const metadata: Metadata = {
  title: 'Aureon — Tu última milla, bajo control',
  description:
    'Plataforma inteligente para operaciones logísticas de última milla. Menos entregas fallidas, rutas más eficientes, datos en tiempo real.',
  openGraph: {
    title: 'Aureon — Tu última milla, bajo control',
    description:
      'Plataforma inteligente para operaciones logísticas de última milla. Menos entregas fallidas, rutas más eficientes, datos en tiempo real.',
    siteName: 'Aureon',
  },
};

export default async function LandingPage() {
  const supabase = await createSSRClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const isAuthenticated = !!user;

  return (
    <main className="bg-stone-950 text-stone-100 overflow-x-hidden" style={{ scrollBehavior: 'smooth' }}>
      <Navbar isAuthenticated={isAuthenticated} />
      <Hero isAuthenticated={isAuthenticated} />
      <ValueProps />
      <MetricsShowcase />
      <Features />
      <Integrations />
      <HowItWorks />
      <CtaSection />
      <Footer />
    </main>
  );
}
