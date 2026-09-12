'use client';

import { MoreHorizontal } from 'lucide-react';

/** The ⋯ affordance — 44px square, icon-only, named for the a11y tree. */
export function SendAffordance({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="grid h-11 w-11 flex-none place-items-center rounded-full text-text-secondary transition-colors active:bg-surface-raised"
    >
      <MoreHorizontal className="h-5 w-5" aria-hidden="true" />
    </button>
  );
}

/**
 * spec-96 Fase 2 — `4d`'s SEL affordance, order-level only. A real
 * checkbox role so selection state is queryable by assistive tech and by
 * tests, at the same 44px floor as `SendAffordance`, which it replaces
 * while `selectable` is true.
 */
export function SelectCheckbox({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: () => void;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={label}
      onClick={onChange}
      className="grid h-11 w-11 flex-none place-items-center rounded-full text-text-secondary transition-colors active:bg-surface-raised"
    >
      <span
        className={`h-5 w-5 rounded-md border-2 ${checked ? 'border-accent bg-accent' : 'border-border-strong'}`}
      />
    </button>
  );
}

/**
 * The order-level action slot: a checkbox while `selectable` (SEL mode),
 * otherwise the ⋯ send affordance gated by `canManualAssign` as before.
 * Mutually exclusive — SEL mode suspends manual per-order sending in
 * favour of the batched selection action.
 */
export function OrderActionSlot({
  canManualAssign,
  selectable,
  selected,
  onToggleSelect,
  sendLabel,
  onSend,
}: {
  canManualAssign: boolean;
  selectable: boolean;
  selected: boolean;
  onToggleSelect?: () => void;
  sendLabel: string;
  onSend: () => void;
}) {
  if (selectable) {
    return (
      <SelectCheckbox label={sendLabel} checked={selected} onChange={() => onToggleSelect?.()} />
    );
  }
  if (!canManualAssign) return null;
  return <SendAffordance label={sendLabel} onClick={onSend} />;
}
