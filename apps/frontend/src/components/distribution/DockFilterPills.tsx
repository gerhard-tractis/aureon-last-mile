'use client';

/**
 * spec-96 fase 4 review — extracted from `distribution/page.tsx` (which
 * had grown past the repo's 300-line cap in the fix diff, not the
 * original phase). `4a:180-183` draws `Lotes abiertos` / `Todas` as this
 * document's selected/unselected idiom (same as `4b`'s Sectorizar/Estibar
 * and the Claro/Oscuro toggle) — `Lotes abiertos` is styled selected.
 *
 * `distribution/page.tsx` still defaults to `all`: the module's only
 * `Abrir` action exists solely on the tiles `open` would hide
 * (`OutboundDockGrid`'s `data-action="abrir"` only when a zone has no
 * open lote) — starting on `Lotes abiertos` would hide an unopened dock
 * precisely when it needs opening, taking the action that satisfies the
 * filter's own predicate out of reach. That is the load-bearing reason,
 * not "the artboard draws six tiles" (the grid doubles as a catalogue of
 * all four chip states and has to show `SIN ABRIR` somewhere regardless).
 *
 * Open design question, not resolved here: the chip and this filter
 * measure different axes. `chipStateFor` gives capacity precedence, so a
 * dock at 168/180 with its lote closed shows `CASI LLENO` — and the
 * `open` filter hides it anyway. The most urgent tile on the screen can
 * vanish under this filter with nothing explaining why.
 */
interface DockFilterPillsProps {
  value: 'open' | 'all';
  onChange: (value: 'open' | 'all') => void;
}

export function DockFilterPills({ value, onChange }: DockFilterPillsProps) {
  return (
    <div className="ml-auto flex gap-1.5">
      <button
        type="button"
        data-testid="dock-filter-open"
        data-active={value === 'open'}
        onClick={() => onChange('open')}
        className={
          'rounded-md border px-2.5 py-1 text-[11px] font-semibold ' +
          (value === 'open' ? 'border-border bg-surface-raised text-text' : 'border-border text-text-secondary')
        }
      >
        Lotes abiertos
      </button>
      <button
        type="button"
        data-testid="dock-filter-all"
        data-active={value === 'all'}
        onClick={() => onChange('all')}
        className={
          'rounded-md border px-2.5 py-1 text-[11px] font-medium ' +
          (value === 'all' ? 'border-border bg-surface-raised text-text' : 'border-border text-text-secondary')
        }
      >
        Todas
      </button>
    </div>
  );
}
