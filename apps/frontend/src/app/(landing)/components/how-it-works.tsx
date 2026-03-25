import { ScrollReveal } from './scroll-reveal';

const steps = [
  {
    title: 'Carga manifiestos',
    description: 'Integración directa o deja que el agente IA los procese desde cualquier formato.',
  },
  {
    title: 'Recibe y despacha en tu hub',
    description: 'Recepción, distribución y carga verificada con escaneo en cada punto.',
  },
  {
    title: 'Monitorea la última milla',
    description: 'Seguimiento GPS, agentes proactivos y verificación de entrega en tiempo real.',
  },
  {
    title: 'Mejora cada detalle',
    description: 'FADR, OTIF, NPS, costos — analítica que te dice exactamente dónde optimizar.',
  },
];

export function HowItWorks() {
  return (
    <section id="como-funciona" className="bg-stone-900 py-24 scroll-mt-16">
      <div className="max-w-7xl mx-auto px-6">
        <ScrollReveal>
          <h2 className="text-3xl md:text-4xl font-bold text-stone-100">Cómo Funciona</h2>
        </ScrollReveal>

        {/* Desktop: horizontal stepper */}
        <div className="hidden md:grid grid-cols-4 gap-8 mt-12 relative">
          {/* Gold connecting line */}
          <div className="absolute top-5 left-[calc(12.5%+20px)] right-[calc(12.5%+20px)] h-0.5 bg-gradient-to-r from-amber-500/60 via-amber-500/30 to-amber-500/60" />

          {steps.map((step, i) => (
            <ScrollReveal key={step.title} delay={i * 150}>
              <div className="relative text-center">
                <div className="w-10 h-10 rounded-full border-2 border-amber-500/50 flex items-center justify-center mx-auto bg-stone-900 relative z-10">
                  <span className="font-mono text-lg font-bold text-amber-400">{i + 1}</span>
                </div>
                <h3 className="mt-4 text-base font-semibold text-stone-200">{step.title}</h3>
                <p className="mt-2 text-sm text-stone-400 leading-relaxed">{step.description}</p>
              </div>
            </ScrollReveal>
          ))}
        </div>

        {/* Mobile: vertical stepper */}
        <div className="md:hidden mt-12 relative pl-12">
          {/* Gold vertical line */}
          <div className="absolute left-[19px] top-0 bottom-0 w-0.5 bg-gradient-to-b from-amber-500/60 via-amber-500/30 to-amber-500/60" />

          <div className="space-y-10">
            {steps.map((step, i) => (
              <ScrollReveal key={step.title} delay={i * 100}>
                <div className="relative">
                  <div className="absolute -left-12 w-10 h-10 rounded-full border-2 border-amber-500/50 flex items-center justify-center bg-stone-900">
                    <span className="font-mono text-lg font-bold text-amber-400">{i + 1}</span>
                  </div>
                  <h3 className="text-base font-semibold text-stone-200">{step.title}</h3>
                  <p className="mt-1 text-sm text-stone-400 leading-relaxed">{step.description}</p>
                </div>
              </ScrollReveal>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
