import type { Metadata } from 'next';
import { createSSRClient } from '@/lib/supabase/server';

import { Navbar } from './(landing)/components/navbar';
import { Hero } from './(landing)/components/hero';
import { ValueProps } from './(landing)/components/value-props';
import { MetricsShowcase } from './(landing)/components/metrics-showcase';
import { Features } from './(landing)/components/features';
import { HowItWorks } from './(landing)/components/how-it-works';
import { Integrations } from './(landing)/components/integrations';
import { FounderSection } from './(landing)/components/founder-section';
import { CtaSection } from './(landing)/components/cta-section';
import { Footer } from './(landing)/components/footer';

export const metadata: Metadata = {
  title: 'Aureon OS — El sistema de gestión para última milla',
  description:
    'Aureon OS te muestra dónde pierdes plata, coordina con tu cliente de forma autónoma, y conecta toda tu operación en un solo lugar.',
  openGraph: {
    title: 'Aureon OS — El sistema de gestión para última milla',
    description:
      'Aureon OS te muestra dónde pierdes plata, coordina con tu cliente de forma autónoma, y conecta toda tu operación en un solo lugar.',
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
    <main className="bg-stone-950 text-stone-100 overflow-x-hidden landing-noise">
      <Navbar isAuthenticated={isAuthenticated} />
      <Hero isAuthenticated={isAuthenticated} />
      <ValueProps />
      <MetricsShowcase />
      <Features />
      <HowItWorks />
      <Integrations />
      <FounderSection />
      <CtaSection />
      <Footer />
    </main>
  );
}
