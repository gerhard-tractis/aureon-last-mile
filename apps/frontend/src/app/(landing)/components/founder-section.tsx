import { ScrollReveal } from './scroll-reveal';

const creds = [
  { role: 'Gerente Última Milla', company: 'Easy (Cencosud)' },
  { role: 'Gerente Desarrollo Home Delivery', company: 'Cencosud Corporativo' },
  { role: '+10 años en logística, ecommerce y supply chain', company: 'Retail alto volumen' },
];

export function FounderSection() {
  return (
    <section aria-label="Quien esta detras" className="bg-stone-950 py-24 border-t border-stone-900">
      <div className="max-w-3xl mx-auto px-6 text-center">
        <ScrollReveal>
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-amber-400 mb-6">
            Quién está detrás
          </p>
          <h2 className="text-3xl md:text-4xl font-display text-stone-100 mb-8 leading-tight">
            Construido por alguien que vivió tus mismos desafíos
          </h2>
          <blockquote className="text-lg text-stone-400 leading-relaxed italic mb-8 max-w-2xl mx-auto">
            &ldquo;Sé lo que se siente gestionar una operación de última milla bajo presión: la carga que
            se acumula, las entregas que fallan, los KPIs que no cuadran. Viví esos problemas
            durante más de 5 años liderando operaciones logísticas de alto volumen en retail. Aureon
            nace de esa experiencia — está pensado para que tu equipo deje de apagar incendios y
            pueda enfocarse en hacer crecer el negocio.&rdquo;
          </blockquote>
          <p className="text-stone-100 font-semibold">Gerhard Neumann</p>
          <p className="text-stone-500 text-sm mt-1 mb-10">Founder & CEO — Tractis</p>
        </ScrollReveal>

        <ScrollReveal delay={150}>
          <div className="flex flex-wrap justify-center gap-3">
            {creds.map((cred) => (
              <div
                key={cred.role}
                className="bg-stone-900/60 border border-stone-800 rounded-xl px-5 py-4 text-left"
              >
                <p className="text-xs font-semibold text-amber-400 mb-1">{cred.role}</p>
                <p className="text-sm text-stone-400">{cred.company}</p>
              </div>
            ))}
          </div>
        </ScrollReveal>
      </div>
    </section>
  );
}
