'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Menu } from 'lucide-react';
import { Sheet, SheetTrigger, SheetContent } from '@/components/ui/sheet';

const DEMO_URL = 'https://calendar.app.google/k9siT3q8FuxjGf9v5';

const navLinks = [
  { label: 'Beneficios', href: '#beneficios' },
  { label: 'Métricas', href: '#metricas' },
  { label: 'Funcionalidades', href: '#funcionalidades' },
  { label: 'Cómo Funciona', href: '#como-funciona' },
];

export function Navbar({ isAuthenticated }: { isAuthenticated: boolean }) {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 64);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <nav
      className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${
        scrolled
          ? 'bg-stone-950/80 backdrop-blur-lg border-b border-stone-800/50'
          : 'bg-transparent'
      }`}
    >
      <div className="max-w-7xl mx-auto flex items-center justify-between h-16 px-6">
        {/* Brand */}
        <Link href="/" className="flex items-center gap-3">
          <svg width="28" height="26" viewBox="0 0 110 104" fill="#e6c15c" className="flex-shrink-0">
            <polygon points="0 41.766 30.817 57.54 30.817 93.694 51 104 51 67.846 51 45.08 0 19" />
            <polygon points="59 45.08 59 67.846 59 104 79.183 93.694 79.183 57.54 110 41.766 110 19" />
            <polygon points="105 11.955 85.674 0 54.017 14.451 22.326 0 3 11.955 54.017 38" />
          </svg>
          <div className="flex flex-col">
            <span className="text-lg font-bold tracking-tight text-stone-100 leading-none">Aureon</span>
            <span className="text-[10px] text-stone-500 tracking-wide leading-none mt-0.5">by Tractis</span>
          </div>
        </Link>

        {/* Desktop nav links */}
        <div className="hidden md:flex items-center gap-8">
          {navLinks.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className="text-sm text-stone-400 hover:text-stone-200 transition-colors"
            >
              {link.label}
            </a>
          ))}
        </div>

        {/* Desktop CTAs */}
        <div className="hidden md:flex items-center gap-3">
          <Link
            href={isAuthenticated ? '/app' : '/auth/login'}
            className="text-sm text-stone-400 hover:text-stone-200 transition-colors px-3 py-1.5"
          >
            {isAuthenticated ? 'Ir al Panel' : 'Ingresa'}
          </Link>
          <a
            href={DEMO_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm font-medium bg-amber-500 text-stone-950 px-4 py-2 rounded-md hover:bg-amber-400 hover:shadow-[0_0_20px_rgba(230,193,92,0.3)] transition-all"
          >
            Solicita una Demo
          </a>
        </div>

        {/* Mobile hamburger */}
        <div className="md:hidden">
          <Sheet open={open} onOpenChange={setOpen}>
            <SheetTrigger asChild>
              <button className="text-stone-400 hover:text-stone-200 p-2" aria-label="Menu">
                <Menu className="w-5 h-5" />
              </button>
            </SheetTrigger>
            <SheetContent side="right" className="bg-stone-950 border-stone-800 w-72">
              <div className="flex flex-col gap-6 mt-8">
                {navLinks.map((link) => (
                  <a
                    key={link.href}
                    href={link.href}
                    onClick={() => setOpen(false)}
                    className="text-stone-300 hover:text-stone-100 text-lg"
                  >
                    {link.label}
                  </a>
                ))}
                <hr className="border-stone-800" />
                <Link
                  href={isAuthenticated ? '/app' : '/auth/login'}
                  className="text-stone-300 hover:text-stone-100 text-lg"
                  onClick={() => setOpen(false)}
                >
                  {isAuthenticated ? 'Ir al Panel' : 'Ingresa'}
                </Link>
                <a
                  href={DEMO_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-center font-medium bg-amber-500 text-stone-950 px-4 py-2.5 rounded-md"
                >
                  Solicita una Demo
                </a>
              </div>
            </SheetContent>
          </Sheet>
        </div>
      </div>
    </nav>
  );
}
