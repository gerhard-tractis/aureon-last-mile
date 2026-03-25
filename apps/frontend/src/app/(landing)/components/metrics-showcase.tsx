import { ScrollReveal } from './scroll-reveal';

const kpis = [
  {
    abbr: 'CPO',
    name: 'Costo por Envío',
    description:
      'El indicador que define tu rentabilidad. Cada reintento, cada ruta ineficiente, cada minuto de espera lo sube. Nuestros agentes optimizan rutas, reducen reintentos y eliminan tiempos muertos.',
  },
  {
    abbr: 'OTIF',
    name: 'On Time In Full',
    description:
      '¿Llegó completo y a tiempo? Agentes de monitoreo contactan a tus clientes antes de la entrega y verifican disponibilidad para que el primer intento sea el definitivo.',
  },
  {
    abbr: 'NPS',
    name: 'Net Promoter Score',
    description:
      '¿Tu cliente te recomendaría? Entregas puntuales y comunicación proactiva construyen la experiencia que genera lealtad.',
  },
];

export function MetricsShowcase() {
  return (
    <section id="metricas" className="bg-stone-950 py-24 scroll-mt-16">
      <div className="max-w-7xl mx-auto px-6">
        <ScrollReveal>
          <h2 className="text-3xl md:text-4xl font-bold text-stone-100">
            Los KPIs que transforman tu operación
          </h2>
          <p className="mt-4 text-lg text-stone-400">
            Nuestra inteligencia agentic trabaja continuamente para mejorar cada uno.
          </p>
        </ScrollReveal>

        <div className="grid md:grid-cols-3 gap-8 mt-12">
          {kpis.map((kpi, i) => (
            <ScrollReveal key={kpi.abbr} delay={i * 100}>
              <div className="h-full bg-stone-900 border border-stone-800 rounded-xl p-8 hover:border-amber-500/30 hover:-translate-y-0.5 transition-all duration-200 shadow-[inset_0_1px_0_rgba(230,193,92,0.1)]">
                <span className="font-mono text-3xl font-bold text-amber-400">{kpi.abbr}</span>
                <h3 className="mt-2 text-lg font-semibold text-stone-200">{kpi.name}</h3>
                <p className="mt-3 text-sm text-stone-400 leading-relaxed">{kpi.description}</p>
              </div>
            </ScrollReveal>
          ))}
        </div>
      </div>
    </section>
  );
}
