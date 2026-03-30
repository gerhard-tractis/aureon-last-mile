import { Plug } from 'lucide-react';
import { ScrollReveal } from './scroll-reveal';

const partners = [
  { name: 'DispatchTrack' },
  { name: 'SimpliRoute' },
  { name: 'Driv.in' },
];

export function Integrations() {
  return (
    <section aria-label="Integraciones" className="bg-stone-950 py-24">
      <div className="max-w-7xl mx-auto px-6 text-center">
        <ScrollReveal>
          <h2 className="text-3xl md:text-4xl font-display text-stone-100">
            Tu centro de comando — compatible con tus herramientas
          </h2>
          <p className="mt-4 text-lg text-stone-400 max-w-2xl mx-auto">
            Mantén la app que ya usan tus conductores. Aureon se integra con tu operación actual
            y centraliza todo en un solo lugar.
          </p>
        </ScrollReveal>

        <ScrollReveal delay={200}>
          <div className="flex flex-wrap items-center justify-center gap-6 mt-12">
            {partners.map((p) => (
              <div
                key={p.name}
                className="bg-stone-900/50 border border-stone-800 rounded-xl px-8 py-4 text-stone-300 font-semibold hover:border-stone-700 transition-colors"
              >
                {p.name}
              </div>
            ))}
            <div className="bg-stone-900/50 border border-stone-800 rounded-xl px-8 py-4 flex items-center gap-2 text-stone-500">
              <Plug className="w-4 h-4" />
              <span className="font-medium">Y más...</span>
            </div>
          </div>
        </ScrollReveal>
      </div>
    </section>
  );
}
