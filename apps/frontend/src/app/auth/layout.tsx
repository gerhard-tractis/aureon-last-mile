import Link from 'next/link';
import { ArrowLeft, BarChart3, Zap, FileText } from 'lucide-react';
import { AuthLogo } from '@/components/AuthLogo';

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
            <div className="w-full lg:w-[45%] flex flex-col justify-center py-12 px-6 sm:px-12 lg:px-16 bg-stone-50 relative">
                <Link
                    href="/"
                    className="absolute left-6 top-6 sm:left-8 sm:top-8 flex items-center text-xs font-medium tracking-wide uppercase text-stone-400 hover:text-stone-700 transition-colors"
                >
                    <ArrowLeft className="w-3.5 h-3.5 mr-1.5" />
                    Volver
                </Link>

                <div className="w-full max-w-sm mx-auto">
                    <div className="flex items-center gap-3.5 mb-10">
                        <AuthLogo productName={productName} />
                        <div>
                            <h1 className="text-lg font-semibold tracking-tight text-stone-900">
                                {productName}
                            </h1>
                            <p className="text-xs text-stone-400 tracking-wide">
                                Gestión de última milla
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
                <div className="absolute left-0 top-0 bottom-0 w-px bg-gradient-to-b from-transparent via-amber-500/40 to-transparent" />

                <div className="relative w-full flex flex-col justify-center px-16 xl:px-24">
                    <div className="max-w-md">
                        {/* Tagline */}
                        <div className="mb-12">
                            <div className="inline-block px-3 py-1 rounded-full border border-amber-500/20 bg-amber-500/5 mb-6">
                                <span className="text-[11px] font-medium tracking-widest uppercase text-amber-400">
                                    Plataforma logística
                                </span>
                            </div>
                            <h2 className="text-3xl xl:text-4xl font-bold text-white leading-tight tracking-tight">
                                Gestión de última milla{' '}
                                <span className="text-amber-400">inteligente</span>
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
                                    <div className="flex-shrink-0 w-9 h-9 rounded-lg bg-stone-800 border border-stone-700/50 flex items-center justify-center group-hover:border-amber-500/30 transition-colors">
                                        <feature.Icon className="w-4 h-4 text-amber-400" />
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
                            <p className="text-[11px] tracking-wider uppercase text-stone-600">
                                Desarrollado por <span className="text-stone-500">Tractis</span>
                            </p>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
