/**
 * spec-54 phase 2 / spec-65 Task 3 — the topbar breadcrumb.
 *
 * Split out of navigation.ts (which re-exports everything here) purely to
 * keep that file under the project's 300-line guideline — no logic changed
 * in the move.
 */

// CIRCULAR-IMPORT CONSTRAINT: navigation.ts does `export * from './navigation.breadcrumbs'`,
// so this file and navigation.ts import each other. Under ESM depth-first evaluation
// this file's body runs BEFORE navigation.ts's own top-level code finishes, so
// NAV_SECTIONS may only be read inside function bodies (as breadcrumbForPath does) —
// never at module scope here. Reading it at module scope would hit the TDZ and throw
// a ReferenceError at import time: a startup crash, not a test failure.
import { NAV_SECTIONS } from './navigation';

/**
 * Reachable pages that are deliberately not in the sidebar — you arrive at them
 * from a button or a menu, not from the nav. They still need a breadcrumb, and
 * it has to come from here: the topbar is the only place a crumb is rendered,
 * so a route missing from this table simply has no crumb at all.
 */
const EXTRA_CRUMBS: { href: string; section: string; page: string }[] = [
  // spec-67: these two are CHILDREN of the Pedidos nav item, so their section
  // has to track it. Leaving them on 'Gestión' after Pedidos moved would
  // render `Seguimiento › Pedidos` for the list and `Gestión › Nuevo pedido`
  // for its own child — a crumb contradicting its parent.
  { href: '/app/orders/new', section: 'Seguimiento', page: 'Nuevo pedido' },
  { href: '/app/orders/import', section: 'Seguimiento', page: 'Importar pedidos' },
  // Deliberately still 'Gestión': "Mi cuenta" is not a child of any nav item
  // (it hangs off the avatar menu), so its section is a free label rather
  // than a claim about the tree — see spec-67 Decisión 7.
  { href: '/app/user-settings', section: 'Gestión', page: 'Mi cuenta' },
  // spec-67: the internal tools moved under /admin. Without these they would
  // match the `/admin` nav item by prefix and both render as plain "Admin".
  { href: '/admin/tools/ocr', section: 'Gestión', page: 'Herramientas · OCR' },
  { href: '/admin/tools/wismo', section: 'Gestión', page: 'Herramientas · WISMO' },
];

/**
 * Breadcrumb for a pathname, from the same definition the sidebar uses, so the
 * two cannot disagree. Matches the longest href prefix, which is what keeps
 * `/admin/users` on Admin rather than on a shorter accidental match, and what
 * lets `/app/orders/new` beat a hypothetical `/app/orders` nav item.
 */
export function breadcrumbForPath(pathname: string): { section: string; page: string } | null {
  let best: { section: string; page: string; length: number } | null = null;

  const candidates = [
    ...NAV_SECTIONS.flatMap((section) =>
      section.items.map((item) => ({
        href: item.href,
        section: section.crumb,
        page: item.label,
      })),
    ),
    ...EXTRA_CRUMBS,
  ];

  for (const candidate of candidates) {
    const matches = pathname === candidate.href || pathname.startsWith(candidate.href + '/');
    if (!matches) continue;
    if (best && candidate.href.length <= best.length) continue;
    best = { section: candidate.section, page: candidate.page, length: candidate.href.length };
  }

  return best ? { section: best.section, page: best.page } : null;
}
