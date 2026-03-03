import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { AuthLogo } from '@/components/AuthLogo';

export default function AuthLayout({
                                       children,
                                   }: {
    children: React.ReactNode;
}) {
    const productName = process.env.NEXT_PUBLIC_PRODUCTNAME;
    const featureCards = [
        {
            title: "Dashboard de rendimiento en tiempo real",
            description: "SLA, FADR, análisis de fallas y métricas clave para tu operación",
            icon: "📊",
        },
        {
            title: "Automatización de datos",
            description: "Integración con DispatchTrack, Easy CSV y procesamiento automático",
            icon: "⚡",
        },
        {
            title: "Reportes exportables",
            description: "CSV y PDF para negociaciones contractuales y análisis operativo",
            icon: "📄",
        },
    ];

    return (
        <div className="flex min-h-screen">
            <div className="w-full lg:w-1/2 flex flex-col justify-center py-12 px-4 sm:px-6 lg:px-8 bg-white relative">
                <Link
                    href="/"
                    className="absolute left-8 top-8 flex items-center text-sm text-gray-600 hover:text-gray-900 transition-colors"
                >
                    <ArrowLeft className="w-4 h-4 mr-2" />
                    Back to Homepage
                </Link>

                <div className="sm:mx-auto sm:w-full sm:max-w-md">
                    <div className="flex justify-center mb-4">
                        <AuthLogo productName={productName || 'Aureon Last Mile'} />
                    </div>
                    <h2 className="text-center text-3xl font-bold tracking-tight text-gray-900">
                        {productName}
                    </h2>
                </div>

                <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
                    {children}
                </div>
            </div>

            <div className="hidden lg:flex lg:w-1/2 bg-gradient-to-br from-primary-600 to-primary-800">
                <div className="w-full flex items-center justify-center p-12">
                    <div className="space-y-6 max-w-lg">
                        <h3 className="text-white text-2xl font-bold mb-8">
                            Gestión de última milla inteligente
                        </h3>
                        {featureCards.map((card, index) => (
                            <div
                                key={index}
                                className="relative bg-white/5 backdrop-blur-sm rounded-xl p-6 border border-white/10 shadow-xl"
                            >
                                <div className="flex items-start space-x-4">
                                    <div className="flex-shrink-0">
                                        <div className="w-10 h-10 rounded-full bg-primary-400/30 flex items-center justify-center text-lg">
                                            {card.icon}
                                        </div>
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <p className="text-sm font-medium text-white mb-1">
                                            {card.title}
                                        </p>
                                        <p className="text-sm text-primary-200 leading-relaxed">
                                            {card.description}
                                        </p>
                                    </div>
                                </div>
                            </div>
                        ))}
                        <div className="mt-8 text-center">
                            <p className="text-primary-100 text-sm">
                                Plataforma desarrollada por Tractis
                            </p>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
