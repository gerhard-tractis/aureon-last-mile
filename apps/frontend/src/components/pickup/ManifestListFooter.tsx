'use client';

/**
 * spec-95 fase 8 (mock `5a:216-217`) — "Mostrando N de M · Cargar más",
 * extracted out of `PickupDesktopView.tsx` to keep that file under the
 * 300-line limit. Purely presentational: `PickupDesktopView` owns the
 * `visibleCount` state and the reset-on-filter-change effect, this just
 * renders what it is handed.
 */
interface ManifestListFooterProps {
  shownCount: number;
  totalCount: number;
  onLoadMore: () => void;
}

export function ManifestListFooter({ shownCount, totalCount, onLoadMore }: ManifestListFooterProps) {
  if (totalCount === 0) return null;

  return (
    <div className="flex flex-none items-center gap-2.5 border-t border-border bg-background px-4 py-2.5">
      <span className="text-[11px] text-text-secondary">
        Mostrando {shownCount} de {totalCount}
      </span>
      {shownCount < totalCount && (
        <button
          type="button"
          onClick={onLoadMore}
          className="ml-auto rounded-md border border-border bg-surface px-2.5 py-1.5 text-[11px] font-medium text-text hover:bg-surface-raised"
        >
          Cargar más
        </button>
      )}
    </div>
  );
}
