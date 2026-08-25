'use client';

import { QrCode, PenLine } from 'lucide-react';

/**
 * spec-62 3i — the footer of the mobile Recepción yard screen. Two buttons,
 * both 52px tall for a gloved thumb: the QR scan (the intended path) and
 * the manual fallback for a damaged QR. Neither calls `open_route_reception`
 * itself — "Recibir sin QR" only opens `ReceiveWithoutQRSheet`, which owns
 * that mutation behind its own route pick and confirmation.
 *
 * This footer stays mounted in every screen state — loading, empty, or
 * populated — because it is the way out when the yard is empty (mock 3i).
 */
export interface ReceptionMobileFooterActionsProps {
  onScanQR: () => void;
  onNoQR: () => void;
}

export function ReceptionMobileFooterActions({
  onScanQR,
  onNoQR,
}: ReceptionMobileFooterActionsProps) {
  // px-3 + min-w-0 travel together: on a ~390px screen each flex-1 button is
  // only ~167px, and the label plus the icon filled it edge to edge. Adding
  // padding alone would push the text into overflow -- min-w-0 is what lets a
  // flex child shrink below its content width, so the label wraps inside the
  // 52px instead of spilling. The icons keep flex-none because a squashed QR
  // glyph is worse than a wrapped label: it is what a gloved thumb aims at.
  return (
    <div className="flex flex-none gap-2">
      <button
        type="button"
        onClick={onScanQR}
        className="flex h-[52px] min-w-0 flex-1 items-center justify-center gap-2 rounded-[14px] bg-accent-light px-3 text-center text-[14px] font-semibold leading-[1.15] text-accent-light-foreground transition-opacity hover:opacity-90"
      >
        <QrCode className="h-5 w-5 flex-none" aria-hidden="true" />
        Escanear QR
      </button>
      <button
        type="button"
        onClick={onNoQR}
        className="flex h-[52px] min-w-0 flex-1 items-center justify-center gap-2 rounded-[14px] border border-border bg-surface px-3 text-center text-[14px] font-medium leading-[1.15] text-text transition-colors active:bg-surface-raised"
      >
        <PenLine className="h-5 w-5 flex-none" aria-hidden="true" />
        Recibir sin QR
      </button>
    </div>
  );
}
