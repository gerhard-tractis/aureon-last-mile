import { ScrollReveal } from './scroll-reveal';

import { DEMO_URL, TOPO_PATTERN } from '../constants';

export function CtaSection() {
  return (
    <section aria-label="Agenda una llamada" className="relative py-24 overflow-hidden bg-stone-950">
      {/* Section gradient */}
      <div className="absolute top-0 inset-x-0 h-16 bg-gradient-to-b from-stone-900 to-transparent pointer-events-none" />
      {/* Top gold gradient line */}
      <div
        className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-amber-500/40 to-transparent"
        style={{ backgroundSize: '200% 100%', animation: 'gold-shimmer 4s ease-in-out infinite' }}
      />
      {/* Topo pattern */}
      <div
        className="absolute inset-0 opacity-[0.01] pointer-events-none"
        style={{ backgroundImage: TOPO_PATTERN, backgroundSize: '600px 600px' }}
      />
      {/* Subtle radial tint */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            'radial-gradient(ellipse at 50% 100%, rgba(230,193,92,0.10) 0%, transparent 60%)',
        }}
      />

      <div className="relative z-10 text-center px-6">
        <ScrollReveal>
          <h2 className="text-3xl md:text-4xl font-display text-stone-100">
            Lleva tu última milla al siguiente nivel
          </h2>
          <p className="mt-4 text-lg text-stone-400 max-w-lg mx-auto leading-relaxed">
            Agenda una llamada de 15 minutos. Te mostramos cómo Aureon puede impactar tus KPIs
            desde el primer mes.
          </p>
          <div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-4">
            <a
              href={DEMO_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="px-10 py-4 bg-amber-500 text-stone-950 font-semibold rounded-md hover:bg-amber-400 hover:shadow-[0_0_24px_rgba(230,193,92,0.35)] transition-all text-sm active:scale-[0.98] focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:ring-offset-2 focus-visible:ring-offset-stone-950 outline-none"
            >
              Agenda una llamada →
            </a>
            <a
              href="mailto:gerhard@tractis.ai"
              className="px-8 py-3.5 border border-stone-700 text-stone-300 font-medium rounded-md hover:border-stone-500 hover:text-stone-100 transition-all text-sm active:scale-[0.98] focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:ring-offset-2 focus-visible:ring-offset-stone-950 outline-none"
            >
              Escríbenos directo
            </a>
          </div>
        </ScrollReveal>
      </div>
    </section>
  );
}
