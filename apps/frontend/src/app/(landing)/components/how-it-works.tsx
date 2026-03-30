import { ScrollReveal } from './scroll-reveal';

const steps = [
  {
    title: 'Pickup',
    description: 'App móvil con escaneo y validación de carga en punto de retiro',
  },
  {
    title: 'Recepción',
    description: 'Verificación en bodega. Pedidos a ruta o a consolidado según fecha',
  },
  {
    title: 'Distribución',
    description: 'Sectorización automática y orden de carga por ruta',
  },
  {
    title: 'Despacho',
    description: 'La ruta se crea en tu app de delivery. El conductor sigue operando igual',
  },
];

const feats = [
  {
    icon: '📄',
    title: 'Ingesta inteligente',
    description:
      'API, CSV, PDF o incluso una foto del manifiesto. El agente OCR extrae la data y la carga en Aureon.',
  },
  {
    icon: '📱',
    title: 'PWA para operadores',
    description:
      'Tus operadores ejecutan desde su tablet. Escaneo de etiquetas, verificación y cuadratura en cada punto.',
  },
  {
    icon: '🔗',
    title: 'Se integra, no reemplaza',
    description:
      'Compatible con DispatchTrack, SimpliRoute, Driv.in. Las novedades de ruta alimentan Aureon vía API.',
  },
  {
    icon: '📊',
    title: 'KPIs operativos',
    description:
      'Nada duerme en bodega. Sabes exactamente qué está pendiente, qué salió a ruta y qué se entregó.',
  },
];

const integrations = ['DispatchTrack', 'SimpliRoute', 'Driv.in'];

export function HowItWorks() {
  return (
    <section id="operacion" className="bg-stone-900 py-24 scroll-mt-16">
      <div className="max-w-7xl mx-auto px-6">
        <ScrollReveal>
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-amber-400 mb-4">
            Operación completa
          </p>
          <h2 className="text-3xl md:text-4xl font-bold text-stone-100">
            Gestiona toda tu cadena desde un solo sistema
          </h2>
          <p className="mt-4 text-lg text-stone-400 max-w-2xl leading-relaxed">
            Los eslabones que tu app de delivery no cubre. Desde el pickup hasta el despacho, con
            trazabilidad en cada punto.
          </p>
        </ScrollReveal>

        {/* Desktop: horizontal flow */}
        <div className="hidden md:flex items-center justify-center mt-14">
          {steps.map((step, i) => (
            <div key={step.title} className="flex items-center">
              <div className="bg-stone-950/60 border border-stone-800 hover:border-amber-500/30 rounded-xl p-6 text-center w-44 transition-all duration-200 flex-shrink-0">
                <div className="w-7 h-7 rounded-full bg-amber-500 flex items-center justify-center mx-auto mb-3 text-stone-950 text-xs font-bold flex-shrink-0">
                  {i + 1}
                </div>
                <h4 className="text-sm font-semibold text-stone-100 mb-1">{step.title}</h4>
                <p className="text-xs text-stone-400 leading-snug">{step.description}</p>
              </div>
              {i < steps.length - 1 && (
                <div className="text-stone-700 text-xl mx-3 flex-shrink-0">→</div>
              )}
            </div>
          ))}
        </div>

        {/* Mobile: vertical stepper */}
        <div className="md:hidden mt-12 relative pl-12">
          <div className="absolute left-[19px] top-0 bottom-0 w-0.5 bg-gradient-to-b from-amber-500/60 via-amber-500/30 to-amber-500/60" />
          <div className="space-y-10">
            {steps.map((step, i) => (
              <ScrollReveal key={step.title} delay={i * 100}>
                <div className="relative">
                  <div className="absolute -left-12 w-10 h-10 rounded-full border-2 border-amber-500/50 flex items-center justify-center bg-stone-900">
                    <span className="font-mono text-sm font-bold text-amber-400">{i + 1}</span>
                  </div>
                  <h3 className="text-base font-semibold text-stone-200">{step.title}</h3>
                  <p className="mt-1 text-sm text-stone-400 leading-relaxed">{step.description}</p>
                </div>
              </ScrollReveal>
            ))}
          </div>
        </div>

        {/* Feature grid */}
        <div className="grid sm:grid-cols-2 md:grid-cols-4 gap-6 mt-14">
          {feats.map((feat, i) => (
            <ScrollReveal key={feat.title} delay={i * 75}>
              <div className="flex gap-3 items-start">
                <div className="w-8 h-8 min-w-[32px] rounded-lg bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-sm flex-shrink-0">
                  {feat.icon}
                </div>
                <div>
                  <h4 className="text-sm font-semibold text-stone-200 mb-1">{feat.title}</h4>
                  <p className="text-xs text-stone-400 leading-relaxed">{feat.description}</p>
                </div>
              </div>
            </ScrollReveal>
          ))}
        </div>

        {/* Integration bar */}
        <ScrollReveal delay={200}>
          <div className="mt-10 flex flex-wrap items-center justify-center gap-6 py-5 border-t border-stone-800">
            {integrations.map((name) => (
              <span key={name} className="text-sm font-medium text-stone-400">
                {name}
              </span>
            ))}
            <span className="text-sm text-stone-600">+ otras vía API</span>
          </div>
          <p className="text-center text-xs text-stone-500 mt-1">
            Mantén la app que ya usan tus conductores. Aureon se conecta y centraliza la
            inteligencia.
          </p>
        </ScrollReveal>
      </div>
    </section>
  );
}
