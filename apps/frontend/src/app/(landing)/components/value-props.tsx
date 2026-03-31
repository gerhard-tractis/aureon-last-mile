import type { LucideIcon } from 'lucide-react';
import { DollarSign, XCircle, Star } from 'lucide-react';
import { ScrollReveal } from './scroll-reveal';

const pains: { icon: LucideIcon; title: string; description: string }[] = [
  {
    icon: DollarSign,
    title: 'No conoces tu costo real por envío',
    description:
      'Sabes cuánto gastas en total, pero no cuánto te cuesta cada entrega incluyendo reintentos, combustible, tiempos muertos y kilómetros vacíos.',
  },
  {
    icon: XCircle,
    title: 'Entregas que fallan sin explicación',
    description:
      'El cliente no estaba, la dirección era incorrecta, llegaron fuera de horario. Pero nadie analiza por qué ni actúa antes de que ocurra.',
  },
  {
    icon: Star,
    title: 'Tu cliente espera todo el día sin saber nada',
    description:
      'No tiene visibilidad de su pedido, no recibe avisos si hay atrasos, y si la entrega no llega, nadie le avisa. Eso destruye tu NPS y te cuesta contratos.',
  },
];

export function ValueProps() {
  return (
    <section id="problema" aria-label="El problema" className="bg-stone-900 pt-20 pb-24 scroll-mt-16">
      <div className="max-w-7xl mx-auto px-6">
        <ScrollReveal>
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-amber-400 mb-4">
            El problema
          </p>
          <h2 className="text-3xl md:text-4xl font-display text-stone-100 max-w-2xl leading-tight">
            Tu app de despacho te dice dónde va el camión.
            <br className="hidden md:block" /> Pero nadie te dice si tu negocio funciona.
          </h2>
          <p className="mt-4 text-lg text-stone-400 max-w-2xl leading-relaxed">
            Las herramientas de última milla están hechas para ejecutar entregas, no para gestionar
            un negocio. Eso te deja con problemas que ningún software operativo resuelve.
          </p>
        </ScrollReveal>

        <div className="grid md:grid-cols-3 gap-6 mt-12">
          {pains.map((pain, i) => (
            <ScrollReveal key={pain.title} delay={i * 100}>
              <div className="border border-stone-800 hover:border-red-500/25 bg-stone-950/50 rounded-xl p-7 transition-all duration-200 h-full">
                <div className="w-10 h-10 rounded-lg bg-red-500/10 border border-red-500/20 flex items-center justify-center text-red-400 text-base font-bold mb-5">
                  <pain.icon className="w-5 h-5" />
                </div>
                <h3 className="text-base font-semibold text-stone-100 mb-3">{pain.title}</h3>
                <p className="text-sm text-stone-400 leading-relaxed">{pain.description}</p>
              </div>
            </ScrollReveal>
          ))}
        </div>
      </div>
    </section>
  );
}
