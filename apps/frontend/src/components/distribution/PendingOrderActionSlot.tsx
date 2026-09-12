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
 * The order-level ⋯ affordance, gated by `canManualAssign` — unchanged
 * from before SEL existed. SEL's own checkbox (`SelectCheckbox` below) is
 * a separate, leading element rendered by the caller, not a swap-in for
 * this slot: `4f` (`Distribucion.dc.html:761,779,794`) draws the
 * selection checkbox leading each row, trailing ⋯ absent entirely while
 * selecting.
 */
export function OrderActionSlot({
  canManualAssign,
  sendLabel,
  onSend,
}: {
  canManualAssign: boolean;
  sendLabel: string;
  onSend: () => void;
}) {
  if (!canManualAssign) return null;
  return <SendAffordance label={sendLabel} onClick={onSend} />;
}

/**
 * spec-96 Fase 2 review — `4d`'s SEL affordance, order-level only. Leads
 * each row (per `4f`) rather than replacing the trailing ⋯, and carries
 * its own selection-scoped label rather than reusing the ⋯'s "Enviar …"
 * label — a checkbox is not a send action, and a screen reader must not
 * announce one. 22px, matching `4f`'s own checkbox square.
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
      className={`h-[22px] w-[22px] flex-none rounded-[6px] border-2 transition-colors ${
        checked ? 'border-accent bg-accent' : 'border-border-strong'
      }`}
    />
  );
}
