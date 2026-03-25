import { ScrollReveal } from './scroll-reveal';

const DEMO_URL = 'https://calendar.app.google/k9siT3q8FuxjGf9v5';

export function CtaSection() {
  return (
    <section className="relative bg-stone-950 py-24 overflow-hidden">
      {/* Top gold gradient line */}
      <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-amber-500/40 to-transparent" />

      {/* Subtle radial gradient (bookend symmetry with hero) */}
      <div
        className="absolute inset-0"
        style={{
          background: 'radial-gradient(ellipse at 50% 100%, rgba(230,193,92,0.05) 0%, transparent 60%)',
        }}
      />

      <div className="relative z-10 text-center px-6">
        <ScrollReveal>
          <h2 className="text-3xl md:text-4xl font-bold text-stone-100">
            Lleva tu operación al siguiente nivel
          </h2>
          <p className="mt-4 text-lg text-stone-400 max-w-xl mx-auto">
            Agenda una demo y descubre cómo Aureon puede mejorar tus KPIs desde el primer mes.
          </p>
          <a
            href={DEMO_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-block mt-8 px-10 py-3.5 bg-amber-500 text-stone-950 font-medium rounded-md hover:bg-amber-400 hover:shadow-[0_0_24px_rgba(230,193,92,0.35)] transition-all text-base"
          >
            Solicita una Demo
          </a>
        </ScrollReveal>
      </div>
    </section>
  );
}
