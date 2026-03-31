'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { motion, useReducedMotion } from 'motion/react';

import { DEMO_URL, TOPO_PATTERN } from '../constants';
import { DashboardPlaceholder } from './dashboard-placeholder';

const proofStats = [
  { number: '3', label: 'KPIs que definen tu éxito' },
  { number: 'E2E', label: 'Pickup a entrega' },
  { number: '100%', label: 'Foco en resolver, no en reportar' },
  { number: '8–10 sem', label: 'Implementación' },
];

const fadeUp = (delay: number) => ({
  initial: { opacity: 0, y: 20 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.7, ease: 'easeOut', delay: delay / 1000 },
});

export function Hero({ isAuthenticated }: { isAuthenticated: boolean }) {
  const reducedMotion = useReducedMotion();
  const topoRef = useRef<HTMLDivElement>(null);
  const [scrollY, setScrollY] = useState(0);

  // Topo parallax
  useEffect(() => {
    if (reducedMotion) return;
    let ticking = false;
    const onScroll = () => {
      if (!ticking) {
        requestAnimationFrame(() => {
          setScrollY(window.scrollY);
          ticking = false;
        });
        ticking = true;
      }
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [reducedMotion]);

  const motionProps = (config: {
    initial: Record<string, unknown>;
    animate: Record<string, unknown>;
    transition: Record<string, unknown>;
  }) => (reducedMotion ? {} : config);

  return (
    <section aria-label="Inicio" className="relative min-h-screen flex items-center justify-center bg-stone-950 overflow-hidden">
      {/* Topographic pattern with parallax */}
      <div
        ref={topoRef}
        className="absolute inset-0 opacity-[0.03] will-change-transform"
        style={{
          backgroundImage: TOPO_PATTERN,
          backgroundSize: '600px 600px',
          transform: `translateY(${scrollY * 0.1}px)`,
        }}
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
      <div className="relative z-10 text-center px-6 max-w-4xl mx-auto pt-16 pb-20">
        {/* Brand */}
        <motion.div
          className="flex flex-col items-center mb-8"
          {...motionProps({
            initial: { opacity: 0, scale: 1.05 },
            animate: { opacity: 1, scale: 1.0 },
            transition: { duration: 0.7, ease: 'easeOut', delay: 0 },
          })}
        >
          <span className="text-4xl md:text-5xl font-bold tracking-tight text-amber-400">Aureon</span>
          <div className="flex items-center gap-1.5 mt-1">
            <span className="text-xs text-stone-500">by</span>
            <svg viewBox="0 0 110 104" fill="currentColor" className="h-3.5 opacity-40 text-stone-100"><polygon points="0 41.766 30.817 57.54 30.817 93.694 51 104 51 67.846 51 45.08 0 19" /><polygon points="59 45.08 59 67.846 59 104 79.183 93.694 79.183 57.54 110 41.766 110 19" /><polygon points="105 11.955 85.674 0 54.017 14.451 22.326 0 3 11.955 54.017 38" /></svg>
            <span className="text-xs font-medium text-stone-500">Tractis</span>
          </div>
        </motion.div>

        {/* Eyebrow */}
        <motion.p
          className="text-xs font-semibold uppercase tracking-[0.15em] text-amber-500/80 mb-5"
          {...motionProps({
            initial: { opacity: 0, x: -20 },
            animate: { opacity: 1, x: 0 },
            transition: { duration: 0.7, ease: 'easeOut', delay: 0.1 },
          })}
        >
          El sistema operativo para última milla
        </motion.p>

        {/* Headline */}
        <motion.h1
          className="text-5xl md:text-6xl lg:text-7xl font-display tracking-tight text-stone-100 leading-snug"
          {...motionProps(fadeUp(200))}
        >
          Ejecutas miles de entregas al mes.
          <br />
          <motion.span
            className="bg-gradient-to-r from-amber-400 to-amber-600 bg-clip-text text-transparent inline-block pb-1"
            {...motionProps(fadeUp(350))}
          >
            ¿Pero sabes si tu negocio es rentable?
          </motion.span>
        </motion.h1>

        {/* Subtext */}
        <motion.p
          className="mt-6 text-lg md:text-xl text-stone-400 max-w-2xl mx-auto leading-relaxed"
          {...motionProps({
            initial: { opacity: 0 },
            animate: { opacity: 1 },
            transition: { duration: 0.7, ease: 'easeOut', delay: 0.5 },
          })}
        >
          Aureon OS es el sistema de gestión que te muestra dónde pierdes plata, coordina con tu
          cliente de forma autónoma, y conecta toda tu operación en un solo lugar.
        </motion.p>

        {/* CTAs */}
        <motion.div
          className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-4"
          {...motionProps(fadeUp(650))}
        >
          <a
            href={DEMO_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="px-10 py-4 bg-amber-500 text-stone-950 font-semibold rounded-md hover:bg-amber-400 hover:shadow-[0_0_20px_rgba(230,193,92,0.3)] transition-all text-sm active:scale-[0.98] focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:ring-offset-2 focus-visible:ring-offset-stone-950 outline-none"
          >
            Agenda una llamada de 15 min →
          </a>
          <Link
            href={isAuthenticated ? '/app' : '/auth/login'}
            className="px-8 py-3 border border-stone-700 text-stone-300 rounded-md hover:border-stone-500 hover:text-stone-100 transition-all text-sm active:scale-[0.98] focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:ring-offset-2 focus-visible:ring-offset-stone-950 outline-none"
          >
            {isAuthenticated ? 'Ir al Panel' : 'Ver el panel'}
          </Link>
        </motion.div>

        {/* Proof stats — floating bar */}
        <motion.div
          className="mt-14 bg-stone-900/50 backdrop-blur-sm rounded-2xl px-8 py-6 grid grid-cols-2 md:grid-cols-4 gap-8"
          {...motionProps(fadeUp(800))}
        >
          {proofStats.map((stat, i) => (
            <motion.div
              key={stat.label}
              className="text-center"
              {...motionProps({
                initial: { opacity: 0, y: 10 },
                animate: { opacity: 1, y: 0 },
                transition: { duration: 0.5, ease: 'easeOut', delay: 0.8 + i * 0.1 },
              })}
            >
              <div className="text-2xl md:text-3xl font-bold text-stone-100">{stat.number}</div>
              <div className="mt-1 text-xs text-stone-500">{stat.label}</div>
            </motion.div>
          ))}
        </motion.div>

        {/* Dashboard placeholder */}
        <motion.div {...motionProps(fadeUp(1000))}>
          <DashboardPlaceholder />
        </motion.div>
      </div>
    </section>
  );
}
