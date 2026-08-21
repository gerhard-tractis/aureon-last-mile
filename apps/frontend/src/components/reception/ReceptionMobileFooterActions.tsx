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
  return (
    <div className="flex flex-none gap-2">
      <button
        type="button"
        onClick={onScanQR}
        className="flex h-[52px] flex-1 items-center justify-center gap-2 rounded-[14px] bg-accent-light text-[14px] font-semibold text-accent-light-foreground transition-opacity hover:opacity-90"
      >
        <QrCode className="h-5 w-5" aria-hidden="true" />
        Escanear QR de ruta
      </button>
      <button
        type="button"
        onClick={onNoQR}
        className="flex h-[52px] flex-1 items-center justify-center gap-2 rounded-[14px] border border-border bg-surface text-[14px] font-medium text-text transition-colors active:bg-surface-raised"
      >
        <PenLine className="h-5 w-5" aria-hidden="true" />
        Recibir sin QR
      </button>
    </div>
  );
}
