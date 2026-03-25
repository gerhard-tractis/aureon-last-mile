'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

const DEMO_URL = 'https://calendar.app.google/k9siT3q8FuxjGf9v5';

// Topographic SVG pattern (inline data URI)
const TOPO_PATTERN = `url("data:image/svg+xml,%3Csvg width='600' height='600' viewBox='0 0 600 600' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' stroke='%23ffffff' stroke-width='1'%3E%3Cellipse cx='300' cy='300' rx='280' ry='180'/%3E%3Cellipse cx='300' cy='300' rx='220' ry='140'/%3E%3Cellipse cx='300' cy='300' rx='160' ry='100'/%3E%3Cellipse cx='300' cy='300' rx='100' ry='60'/%3E%3Cellipse cx='300' cy='300' rx='50' ry='30'/%3E%3Cellipse cx='150' cy='150' rx='120' ry='80'/%3E%3Cellipse cx='150' cy='150' rx='70' ry='45'/%3E%3Cellipse cx='450' cy='450' rx='130' ry='85'/%3E%3Cellipse cx='450' cy='450' rx='75' ry='50'/%3E%3C/g%3E%3C/svg%3E")`;

export function Hero({ isAuthenticated }: { isAuthenticated: boolean }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const show = mounted
    ? 'opacity-100 translate-y-0 transition-all duration-700 ease-out'
    : 'opacity-0 translate-y-5';

  return (
    <section className="relative min-h-screen flex items-center justify-center bg-stone-950 overflow-hidden">
      {/* Topographic pattern */}
      <div
        className="absolute inset-0 opacity-[0.03]"
        style={{ backgroundImage: TOPO_PATTERN, backgroundSize: '600px 600px' }}
      />

      {/* Radial gold gradient */}
      <div
        className="absolute inset-0"
        style={{
          background: 'radial-gradient(ellipse at 50% 0%, rgba(230,193,92,0.08) 0%, transparent 60%)',
        }}
      />

      {/* Faint T-symbol watermark */}
      <svg
        width="384"
        height="384"
        viewBox="0 0 110 104"
        fill="#e6c15c"
        className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 opacity-[0.03]"
      >
        <polygon points="0 41.766 30.817 57.54 30.817 93.694 51 104 51 67.846 51 45.08 0 19" />
        <polygon points="59 45.08 59 67.846 59 104 79.183 93.694 79.183 57.54 110 41.766 110 19" />
        <polygon points="105 11.955 85.674 0 54.017 14.451 22.326 0 3 11.955 54.017 38" />
      </svg>

      {/* Content */}
      <div className="relative z-10 text-center px-6 max-w-4xl mx-auto">
        <div
          className={`flex items-center justify-center gap-3 mb-8 ${show}`}
          style={{ transitionDelay: '0ms' }}
        >
          <span className="text-4xl md:text-5xl font-bold tracking-tight text-amber-400">Aureon</span>
          <span className="flex items-center gap-1.5 self-end mb-1">
            <span className="text-xs text-stone-500">by</span>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logos/tractis-white.svg" alt="Tractis" className="h-4 opacity-50" />
          </span>
        </div>
        <h1
          className={`text-5xl md:text-6xl lg:text-7xl font-bold tracking-tight bg-gradient-to-r from-white via-stone-200 to-stone-400 bg-clip-text text-transparent ${show}`}
          style={{ transitionDelay: '150ms' }}
        >
          Tu última milla, bajo control
        </h1>

        <p
          className={`mt-6 text-lg md:text-xl text-stone-400 max-w-2xl mx-auto leading-relaxed ${show}`}
          style={{ transitionDelay: '300ms' }}
        >
          Plataforma inteligente para operaciones logísticas de última milla. Menos entregas fallidas,
          rutas más eficientes, datos en tiempo real.
        </p>

        <div
          className={`mt-10 flex flex-col sm:flex-row items-center justify-center gap-4 ${show}`}
          style={{ transitionDelay: '450ms' }}
        >
          <a
            href={DEMO_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="px-8 py-3 bg-amber-500 text-stone-950 font-medium rounded-md hover:bg-amber-400 hover:shadow-[0_0_20px_rgba(230,193,92,0.3)] transition-all text-sm"
          >
            Solicita una Demo
          </a>
          <Link
            href={isAuthenticated ? '/app' : '/auth/login'}
            className="px-8 py-3 border border-stone-700 text-stone-300 rounded-md hover:border-stone-500 hover:text-stone-100 transition-all text-sm"
          >
            {isAuthenticated ? 'Ir al Panel' : 'Ingresa'}
          </Link>
        </div>
      </div>
    </section>
  );
}
