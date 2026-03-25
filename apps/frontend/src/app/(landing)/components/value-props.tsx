import { Zap, ShieldCheck, BarChart3, type LucideIcon } from 'lucide-react';
import { ScrollReveal } from './scroll-reveal';

const props: { title: string; description: string; Icon: LucideIcon }[] = [
  {
    title: 'Operaciones más rápidas',
    description:
      'Digitaliza tu flujo completo — desde la recepción hasta la entrega — y elimina los cuellos de botella manuales.',
    Icon: Zap,
  },
  {
    title: 'Menos entregas fallidas',
    description:
      'Verificación en cada punto de contacto. Escaneo, firma, foto — trazabilidad completa que reduce errores.',
    Icon: ShieldCheck,
  },
  {
    title: 'Decisiones con datos',
    description:
      'Métricas en tiempo real sobre tu operación. Sabe exactamente dónde optimizar y cuánto estás ahorrando.',
    Icon: BarChart3,
  },
];

export function ValueProps() {
  return (
    <section id="beneficios" className="bg-stone-900 py-24 scroll-mt-16">
      <div className="max-w-7xl mx-auto px-6">
        <ScrollReveal>
          <p className="text-sm font-medium tracking-widest uppercase text-amber-400 mb-4">Beneficios</p>
        </ScrollReveal>
        <div className="grid md:grid-cols-3 gap-8 mt-8">
          {props.map((p, i) => (
            <ScrollReveal key={p.title} delay={i * 100}>
              <div className="border-l-2 border-amber-500/40 hover:border-amber-500/60 bg-stone-800/50 rounded-r-lg p-6 hover:-translate-y-0.5 transition-all duration-200">
                <div className="w-10 h-10 rounded-lg bg-stone-800 border border-stone-700/50 flex items-center justify-center mb-4">
                  <p.Icon className="w-5 h-5 text-amber-400" />
                </div>
                <h3 className="text-lg font-semibold text-stone-200">{p.title}</h3>
                <p className="mt-2 text-sm text-stone-400 leading-relaxed">{p.description}</p>
              </div>
            </ScrollReveal>
          ))}
        </div>
      </div>
    </section>
  );
}
