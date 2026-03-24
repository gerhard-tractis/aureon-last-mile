import {
  Route, ScanLine, Monitor, BrainCircuit,
  Target, Bot, TrendingUp, FileBarChart,
  type LucideIcon,
} from 'lucide-react';
import { ScrollReveal } from './scroll-reveal';

const features: { title: string; description: string; Icon: LucideIcon }[] = [
  { title: 'Despacho inteligente', description: 'Rutas optimizadas por zona y capacidad, con GPS y monitoreo de distancia recorrida', Icon: Route },
  { title: 'Escaneo y verificación', description: 'QR y código de barras en cada punto — recepción, carga, entrega', Icon: ScanLine },
  { title: 'Control de operaciones', description: 'Panel en tiempo real con el estado de cada orden y conductor', Icon: Monitor },
  { title: 'Ingesta con IA', description: 'Carga manifiestos desde cualquier formato — CSV, PDF, fotos — sin integraciones complejas', Icon: BrainCircuit },
  { title: 'KPIs estratégicos', description: 'CPO, OTIF y NPS en un solo dashboard — los tres indicadores que definen tu operación', Icon: Target },
  { title: 'Agentes de monitoreo', description: 'Contacto proactivo con clientes antes de la entrega para reducir entregas fallidas y mejorar NPS', Icon: Bot },
  { title: 'Inteligencia operacional', description: 'FADR, eficiencia de combustible, dwell time, desglose de causas de fallo', Icon: TrendingUp },
  { title: 'Reportes y auditoría', description: 'Exporta datos a CSV/PDF, trazabilidad completa para auditorías', Icon: FileBarChart },
];

export function Features() {
  return (
    <section id="funcionalidades" className="bg-stone-900 py-24 scroll-mt-16">
      <div className="max-w-7xl mx-auto px-6">
        <ScrollReveal>
          <h2 className="text-3xl md:text-4xl font-bold text-stone-100">
            Todo lo que necesitas para tu operación
          </h2>
        </ScrollReveal>

        <div className="grid sm:grid-cols-2 gap-6 mt-12">
          {features.map((f, i) => (
            <ScrollReveal key={f.title} delay={i * 75}>
              <div className="flex gap-4 p-5 rounded-lg hover:bg-stone-800/40 transition-colors duration-200 group">
                <div className="w-10 h-10 rounded-lg bg-stone-800 border border-stone-700/50 group-hover:border-amber-500/40 flex items-center justify-center flex-shrink-0 transition-colors">
                  <f.Icon className="w-5 h-5 text-stone-400 group-hover:text-amber-400 transition-colors" />
                </div>
                <div>
                  <h3 className="text-base font-semibold text-stone-200">{f.title}</h3>
                  <p className="mt-1 text-sm text-stone-400 leading-relaxed">{f.description}</p>
                </div>
              </div>
            </ScrollReveal>
          ))}
        </div>
      </div>
    </section>
  );
}
