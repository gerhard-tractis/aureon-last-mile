'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';

const PAGES = [
  { href: '/app/dashboard/operaciones', label: 'Operaciones' },
  { href: '/app/dashboard/analitica', label: 'Analítica' },
] as const;

export function DashboardPageNav() {
  const pathname = usePathname();

  return (
    <nav className="flex gap-1 border-b border-border mb-4">
      {PAGES.map(({ href, label }) => (
        <Link
          key={href}
          href={href}
          className={cn(
            'px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors',
            pathname === href
              ? 'border-accent text-accent'
              : 'border-transparent text-[var(--color-text-secondary)] hover:text-[var(--color-text)]',
          )}
        >
          {label}
        </Link>
      ))}
    </nav>
  );
}
