import Link from 'next/link';
import { Linkedin, Mail } from 'lucide-react';

const DEMO_URL = 'https://calendar.app.google/k9siT3q8FuxjGf9v5';

export function Footer() {
  return (
    <footer className="bg-stone-950 border-t border-stone-800 pt-16 pb-8">
      <div className="max-w-7xl mx-auto px-6">
        <div className="grid sm:grid-cols-3 gap-12">
          {/* Brand */}
          <div>
            <div className="flex items-center gap-3 mb-3">
              <svg width="24" height="22" viewBox="0 0 110 104" fill="#e6c15c" className="flex-shrink-0">
                <polygon points="0 41.766 30.817 57.54 30.817 93.694 51 104 51 67.846 51 45.08 0 19" />
                <polygon points="59 45.08 59 67.846 59 104 79.183 93.694 79.183 57.54 110 41.766 110 19" />
                <polygon points="105 11.955 85.674 0 54.017 14.451 22.326 0 3 11.955 54.017 38" />
              </svg>
              <div className="flex flex-col">
                <span className="text-base font-bold text-stone-200 leading-none">Aureon</span>
                <span className="flex items-center gap-1 mt-0.5">
                  <span className="text-[10px] text-stone-500 leading-none">by</span>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src="/logos/tractis-color.svg" alt="Tractis" className="h-2.5 opacity-50" />
                </span>
              </div>
            </div>
            <p className="text-sm text-stone-500">Plataforma inteligente de última milla</p>
          </div>

          {/* Links */}
          <div>
            <h3 className="text-sm font-semibold text-stone-300 uppercase tracking-wider mb-4">Enlaces</h3>
            <ul className="space-y-3 text-sm">
              <li>
                <Link href="/auth/login" className="text-stone-500 hover:text-stone-300 transition-colors">
                  Ingresa
                </Link>
              </li>
              <li>
                <a href={DEMO_URL} target="_blank" rel="noopener noreferrer" className="text-stone-500 hover:text-stone-300 transition-colors">
                  Solicita una Demo
                </a>
              </li>
              <li>
                <Link href="/legal" className="text-stone-500 hover:text-stone-300 transition-colors">
                  Legal
                </Link>
              </li>
            </ul>
          </div>

          {/* Contact */}
          <div>
            <h3 className="text-sm font-semibold text-stone-300 uppercase tracking-wider mb-4">Contacto</h3>
            <ul className="space-y-3 text-sm">
              <li>
                <a href="mailto:gerhard@tractis.ai" className="text-stone-500 hover:text-stone-300 transition-colors flex items-center gap-2">
                  <Mail className="w-4 h-4" />
                  gerhard@tractis.ai
                </a>
              </li>
              <li>
                <a href="https://linkedin.com/in/gneumannv" target="_blank" rel="noopener noreferrer" className="text-stone-500 hover:text-amber-400 transition-colors flex items-center gap-2">
                  <Linkedin className="w-4 h-4" />
                  Gerhard Neumann
                </a>
              </li>
              <li>
                <a href="https://www.linkedin.com/company/tractis-ai/" target="_blank" rel="noopener noreferrer" className="text-stone-500 hover:text-amber-400 transition-colors flex items-center gap-2">
                  <Linkedin className="w-4 h-4" />
                  Tractis
                </a>
              </li>
            </ul>
          </div>
        </div>

        <div className="mt-12 pt-6 border-t border-stone-800/50 text-center">
          <p className="text-xs text-stone-600">© 2026 Tractis. Todos los derechos reservados.</p>
        </div>
      </div>
    </footer>
  );
}
