import { Lightbulb } from 'lucide-react';
import { ScrollReveal } from './scroll-reveal';
import { TOPO_PATTERN } from '../constants';

const kpis = [
  {
    abbr: 'CPO',
    name: 'Costo por envío',
    description:
      'El indicador que define tu rentabilidad. Cada reintento, cada kilómetro vacío, cada minuto de espera lo sube. Aureon lo desglosa para que sepas exactamente qué atacar.',
    drivers: ['FADR', 'Km entre pedidos', 'Km por ruta', 'Combustible', 'Tiempos de descarga', 'Reintentos'],
  },
  {
    abbr: 'OTIF',
    name: 'On time, in full',
    description:
      '¿Llegó completo y a tiempo? Este es el indicador que mide la calidad real de tu servicio. Si no lo mides, compites a ciegas.',
    drivers: ['% a tiempo', '% completo', 'Ventana cumplida', 'Entregas al primer intento'],
  },
  {
    abbr: 'NPS',
    name: 'Net Promoter Score',
    description:
      '¿Tu cliente te recomendaría? Entregas puntuales y comunicación proactiva construyen la experiencia que te hace ganar contratos — o perderlos.',
    drivers: ['Satisfacción post-entrega', 'Reclamos', 'Comunicación proactiva'],
  },
];

export function MetricsShowcase() {
  return (
    <section id="inteligencia" aria-label="Inteligencia estrategica" className="relative bg-stone-950 py-24 scroll-mt-16">
      {/* Topo pattern */}
      <div
        className="absolute inset-0 opacity-[0.015] pointer-events-none"
        style={{ backgroundImage: TOPO_PATTERN, backgroundSize: '600px 600px' }}
      />
      {/* Section gradient */}
      <div className="absolute top-0 inset-x-0 h-16 bg-gradient-to-b from-stone-900 to-transparent pointer-events-none" />
      <div className="max-w-7xl mx-auto px-6">
        <ScrollReveal direction="right">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-amber-400 mb-4">
            Inteligencia estratégica
          </p>
          <h2 className="text-3xl md:text-4xl font-display text-stone-100">
            Los 3 indicadores que definen si tu última milla es rentable
          </h2>
          <p className="mt-4 text-lg text-stone-400 max-w-2xl leading-relaxed">
            Cada KPI tiene aperturas tácticas para que sepas exactamente dónde actuar. No es un
            dashboard bonito — es la herramienta que necesitas para tomar decisiones.
          </p>
        </ScrollReveal>

        <div className="grid md:grid-cols-3 gap-6 mt-12">
          {kpis.map((kpi, i) => (
            <ScrollReveal key={kpi.abbr} delay={i * 100} className={i === 0 ? 'md:col-span-2' : ''}>
              <div className="group h-full bg-stone-900 border border-stone-800 rounded-xl overflow-hidden hover:border-amber-500/30 hover:-translate-y-0.5 transition-all duration-200 flex flex-col">
                {/* Gold top accent bar */}
                <div className="h-0.5 group-hover:h-1 transition-all duration-200 w-full bg-amber-500" />
                <div className={`p-8 flex flex-col flex-1 ${i === 0 ? 'md:flex-row md:gap-8' : ''}`}>
                  <div className={i === 0 ? 'md:flex-1' : ''}>
                    <span className="font-mono text-3xl font-bold text-amber-400">{kpi.abbr}</span>
                    <h3 className="mt-1 text-xs font-semibold uppercase tracking-[0.1em] text-stone-500">
                      {kpi.name}
                    </h3>
                    <p className="mt-4 text-sm text-stone-400 leading-relaxed flex-1">
                      {kpi.description}
                    </p>
                  </div>
                  <div className={`${i === 0 ? 'md:w-64 md:border-l md:border-stone-800 md:pl-8 mt-6 md:mt-0' : 'mt-6'} pt-5 border-t md:border-t-0 border-stone-800`}>
                    <p className="text-xs font-semibold uppercase tracking-[0.1em] text-stone-600 mb-3">
                      Aperturas tácticas
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {kpi.drivers.map((d) => (
                        <span
                          key={d}
                          className="text-xs bg-amber-500/10 text-amber-400/80 border border-amber-500/20 px-2.5 py-1 rounded-md font-medium"
                        >
                          {d}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </ScrollReveal>
          ))}
        </div>

        {/* Case study insight */}
        <ScrollReveal delay={300}>
          <div className="mt-6 bg-stone-900 border border-stone-800 border-l-2 border-l-amber-500 rounded-r-xl p-6 flex gap-4 items-start">
            <div className="w-9 h-9 min-w-[36px] rounded-lg bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-base flex-shrink-0">
              <Lightbulb className="w-5 h-5 text-amber-400" />
            </div>
            <p className="text-sm text-stone-400 leading-relaxed">
              <strong className="text-stone-200">Caso real:</strong>{' '}
              En nuestro primer piloto descubrimos que el FADR del operador estaba destruido por
              carga adelantada que el retail le entregaba antes de la fecha de entrega. Se sacaba a
              ruta en cualquier momento y el cliente no estaba en la casa. Nadie lo había detectado
              porque no había inteligencia para medirlo. Aureon lo vio en la primera semana.
            </p>
          </div>
        </ScrollReveal>
      </div>
    </section>
  );
}
