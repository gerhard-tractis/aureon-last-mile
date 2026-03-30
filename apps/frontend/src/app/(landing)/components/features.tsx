import { ScrollReveal } from './scroll-reveal';

const agents = [
  {
    title: 'Coordinación proactiva con cliente',
    description:
      'Cuando llega carga adelantada o un pedido está listo antes de lo previsto, el agente contacta al cliente para confirmar disponibilidad, definir ventanas de entrega y evitar que el primer intento falle.',
    example:
      '"Hola María, tu pedido #4521 está disponible antes de lo esperado. ¿Estarás en casa mañana entre 10:00 y 13:00 para recibirlo?"',
  },
  {
    title: 'Actualización en ruta',
    description:
      'Si hay un atraso, cambio de rango horario o cualquier novedad en ruta, el agente informa al cliente automáticamente. Sin llamadas, sin WhatsApps manuales.',
    example:
      '"Hola Juan, tu entrega está en camino pero con un leve retraso. El nuevo rango estimado es entre 15:00 y 17:00. Te avisamos cuando esté cerca."',
  },
  {
    title: 'Post-entrega y reclamos',
    description:
      'Después de la entrega, el cliente tiene una ventana de 24 horas para reportar problemas: producto dañado, equivocado, faltante. El agente lo gestiona directo.',
    example: null,
  },
  {
    title: 'Reagendamiento y cancelaciones',
    description:
      'Si el cliente no puede recibir, el agente reagenda directamente en Aureon. Gestiona cancelaciones, devoluciones al origen y coordinación sin intervención del equipo de ops.',
    example: null,
  },
];

export function Features() {
  return (
    <section id="agentes" aria-label="Agentes autonomos" className="bg-stone-900 py-24 scroll-mt-16">
      <div className="max-w-7xl mx-auto px-6">
        <ScrollReveal>
          <h2 className="text-3xl md:text-4xl font-display text-stone-100">
            No es solo un dashboard.
            <br className="hidden md:block" /> Aureon actúa por ti.
          </h2>
          <p className="mt-4 text-lg text-stone-400 max-w-2xl leading-relaxed">
            Agentes autónomos que coordinan con tu cliente, comunican actualizaciones y gestionan
            incidencias — sin que nadie tenga que levantar el teléfono.
          </p>
        </ScrollReveal>

        <div className="grid sm:grid-cols-2 gap-6 mt-12">
          {agents.map((agent, i) => (
            <ScrollReveal key={agent.title} delay={i * 100}>
              <div className="border border-stone-800 hover:border-amber-500/30 bg-stone-950/40 rounded-xl p-7 transition-all duration-200 h-full flex flex-col">
                {/* Agent badge */}
                <div className="inline-flex items-center gap-2 self-start bg-stone-950 border border-stone-800 text-amber-400 text-xs font-semibold uppercase tracking-[0.08em] px-3 py-1.5 rounded-md mb-5">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  Agente activo
                </div>
                <h3 className="text-base font-semibold text-stone-100 mb-3">{agent.title}</h3>
                <p className="text-sm text-stone-400 leading-relaxed flex-1">{agent.description}</p>
                {agent.example && (
                  <div className="mt-5 bg-stone-900 border border-stone-800 rounded-lg p-4">
                    <p className="text-xs font-semibold uppercase tracking-[0.08em] text-stone-500 mb-2">
                      Ejemplo de mensaje
                    </p>
                    <p className="text-sm text-stone-300 leading-relaxed italic">{agent.example}</p>
                  </div>
                )}
              </div>
            </ScrollReveal>
          ))}
        </div>
      </div>
    </section>
  );
}
