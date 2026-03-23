import Link from 'next/link';
import { ArrowLeft, BarChart3, Zap, FileText } from 'lucide-react';

export default function AuthLayout({
                                       children,
                                   }: {
    children: React.ReactNode;
}) {
    const productName = process.env.NEXT_PUBLIC_PRODUCTNAME || 'Aureon Last Mile';

    const features = [
        {
            title: "Rendimiento en tiempo real",
            description: "SLA, FADR y métricas operacionales clave",
            Icon: BarChart3,
        },
        {
            title: "Automatización de datos",
            description: "DispatchTrack, Easy CSV — sin intervención manual",
            Icon: Zap,
        },
        {
            title: "Reportes exportables",
            description: "CSV y PDF para negociaciones contractuales",
            Icon: FileText,
        },
    ];

    return (
        <div className="flex min-h-screen">
            {/* Left panel — form area */}
            <div className="w-full lg:w-[45%] flex flex-col justify-center py-12 px-6 sm:px-12 lg:px-16 bg-muted relative">
                <Link
                    href="/"
                    className="absolute left-6 top-6 sm:left-8 sm:top-8 flex items-center text-xs font-medium tracking-wide uppercase text-muted-foreground hover:text-foreground transition-colors"
                >
                    <ArrowLeft className="w-3.5 h-3.5 mr-1.5" />
                    Volver
                </Link>

                <div className="w-full max-w-sm mx-auto">
                    {/* Brand mark — T-symbol + product name */}
                    <div className="flex items-center gap-3 mb-10">
                        {/* Tractis T-symbol — raw, no container */}
                        <svg width="28" height="26" viewBox="0 0 110 104" fill="#e6c15c" className="flex-shrink-0">
                            <polygon points="0 41.766 30.817 57.54 30.817 93.694 51 104 51 67.846 51 45.08 0 19"/>
                            <polygon points="59 45.08 59 67.846 59 104 79.183 93.694 79.183 57.54 110 41.766 110 19"/>
                            <polygon points="105 11.955 85.674 0 54.017 14.451 22.326 0 3 11.955 54.017 38"/>
                        </svg>
                        <div className="w-px h-7 bg-border" />
                        <div>
                            <h1 className="text-[15px] font-semibold tracking-tight text-foreground leading-none">
                                {productName}
                            </h1>
                            <p className="text-[10px] text-muted-foreground tracking-widest uppercase mt-1">
                                by Tractis
                            </p>
                        </div>
                    </div>

                    {children}
                </div>
            </div>

            {/* Right panel — brand showcase (desktop only) */}
            <div className="hidden lg:flex lg:w-[55%] bg-stone-900 relative overflow-hidden">
                {/* Subtle geometric pattern overlay */}
                <div
                    className="absolute inset-0 opacity-[0.03]"
                    style={{
                        backgroundImage: `url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%23ffffff' fill-opacity='1'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")`,
                    }}
                />

                {/* Gold accent line */}
                <div className="absolute left-0 top-0 bottom-0 w-px bg-gradient-to-b from-transparent via-accent/40 to-transparent" />

                <div className="relative w-full flex flex-col justify-center px-16 xl:px-24">
                    <div className="max-w-md">
                        {/* Tagline */}
                        <div className="mb-12">
                            <div className="inline-block px-3 py-1 rounded-full border border-accent/20 bg-accent/5 mb-6">
                                <span className="text-[11px] font-medium tracking-widest uppercase text-accent">
                                    Plataforma logística
                                </span>
                            </div>
                            <h2 className="text-3xl xl:text-4xl font-bold text-white leading-tight tracking-tight">
                                Gestión de última milla{' '}
                                <span className="text-accent">inteligente</span>
                            </h2>
                            <p className="mt-4 text-stone-400 text-sm leading-relaxed">
                                Visibilidad completa de tu operación logística.
                                Métricas, automatización y reportes en una sola plataforma.
                            </p>
                        </div>

                        {/* Feature list */}
                        <div className="space-y-5">
                            {features.map((feature, index) => (
                                <div
                                    key={index}
                                    className="group flex items-start gap-4"
                                >
                                    <div className="flex-shrink-0 w-9 h-9 rounded-lg bg-stone-800 border border-stone-700/50 flex items-center justify-center group-hover:border-accent/30 transition-colors">
                                        <feature.Icon className="w-4 h-4 text-accent" />
                                    </div>
                                    <div className="pt-0.5">
                                        <p className="text-sm font-medium text-stone-200">
                                            {feature.title}
                                        </p>
                                        <p className="text-xs text-stone-500 mt-0.5">
                                            {feature.description}
                                        </p>
                                    </div>
                                </div>
                            ))}
                        </div>

                        {/* Footer */}
                        <div className="mt-16 pt-6 border-t border-stone-800">
                            <div className="inline-flex items-center gap-2.5 px-3.5 py-2 rounded-full bg-stone-800/60 border border-stone-700/40">
                                <svg width="14" height="14" viewBox="0 0 110 104" fill="#e6c15c" className="flex-shrink-0">
                                    <polygon points="0 41.766 30.817 57.54 30.817 93.694 51 104 51 67.846 51 45.08 0 19"/>
                                    <polygon points="59 45.08 59 67.846 59 104 79.183 93.694 79.183 57.54 110 41.766 110 19"/>
                                    <polygon points="105 11.955 85.674 0 54.017 14.451 22.326 0 3 11.955 54.017 38"/>
                                </svg>
                                <span className="text-[10px] text-stone-500">Powered by</span>
                                <span className="text-[11px] font-semibold tracking-wide text-stone-300">Tractis</span>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
