import { Separator } from '@/components/ui/separator';

/**
 * spec-54 — PageShell no longer renders a breadcrumb.
 *
 * The topbar owns it, derived from sidebar/navigation.ts. Rendering one here
 * too put the same crumb on screen twice (Auditoría, Torre de control) and put
 * it in a different place on pages the nav does not cover. If a route needs a
 * crumb and does not have one, add it to EXTRA_CRUMBS in navigation.ts — not
 * back into the page body.
 */

interface PageShellProps {
  title: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
}

export function PageShell({ title, actions, children }: PageShellProps) {
  return (
    <div className="p-4 lg:p-6">
      <div className="mb-4 flex items-center justify-between gap-4">
        <h1 className="font-heading text-xl font-semibold text-text">{title}</h1>
        {actions && <div className="flex items-center gap-2">{actions}</div>}
      </div>
      <Separator className="mb-4" />
      {children}
    </div>
  );
}
