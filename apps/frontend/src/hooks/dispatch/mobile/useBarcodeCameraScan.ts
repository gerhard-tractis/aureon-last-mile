'use client';

// apps/frontend/src/hooks/dispatch/mobile/useBarcodeCameraScan.ts
//
// spec-76 phase 5 (2g) — camera fallback for the crew without a handheld.
// Decision 4: reuse the camera precedent already in this repo
// (RouteQRScannerEntry.tsx, Recepción) rather than a new scanning library.
// html5-qrcode's default `Html5Qrcode.start()` is NOT QR-only despite the
// package name — it runs ZXing's multi-format reader, which already
// decodes the 1D barcode formats (Code128 etc.) this module's package
// labels use, so no `formatsToSupport` restriction is needed.
//
// Narrowly extracted (not reused directly): RouteQRScannerEntry couples the
// decode callback straight to route lookup/navigation, and calls it on
// every decoded frame with no dedupe — fine for a single "point at one QR
// and navigate away" interaction, wrong for a continuous scan loop where
// the same barcode can sit in frame for a full second at 10fps and would
// otherwise resubmit itself (rejected as ALREADY_STAGED) many times over.
// This hook keeps only the mount/cleanup/error-handling shape and adds a
// per-code cooldown.
import { useEffect, useRef, useState } from 'react';
import { Html5Qrcode } from 'html5-qrcode';

export const CAMERA_READER_ELEMENT_ID = 'dispatch-camera-reader';
const DECODE_COOLDOWN_MS = 2000;

export interface UseBarcodeCameraScanOptions {
  /** Rule 7 (spec-76 Lecciones aplicadas #7 / this spec's own decision 4
   *  restated): the camera must not initialise until the camera view is
   *  actually open. `enabled: false` on a query stops the fetch but not an
   *  observer; the equivalent mistake here would be mounting
   *  `Html5Qrcode` unconditionally and merely hiding its output — an idle
   *  camera stream is worse than an idle query. Gating the whole effect on
   *  `active` is what keeps the stream from ever starting while 2e's
   *  handheld-reader view is showing. */
  active: boolean;
  onDecode: (code: string) => void;
}

export interface UseBarcodeCameraScanResult {
  cameraError: boolean;
  readerElementId: string;
}

export function useBarcodeCameraScan({
  active,
  onDecode,
}: UseBarcodeCameraScanOptions): UseBarcodeCameraScanResult {
  const [cameraError, setCameraError] = useState(false);
  // Latest onDecode without re-running the mount effect on every render —
  // DispatchRouteScanSession passes submitScan fresh each render (same
  // reasoning as useRouteScanSession's own header comment: nothing
  // downstream needs that function's identity to stay stable).
  const onDecodeRef = useRef(onDecode);
  onDecodeRef.current = onDecode;
  const lastDecodedRef = useRef<{ code: string; atMs: number } | null>(null);

  useEffect(() => {
    if (!active) return;
    setCameraError(false);
    let scanner: { stop: () => Promise<void>; clear: () => void } | null = null;

    async function startScanner() {
      try {
        const qr = new Html5Qrcode(CAMERA_READER_ELEMENT_ID);
        scanner = qr;
        await qr.start(
          { facingMode: 'environment' },
          // A wide, short box — this reads a barcode strip, not a square
          // QR payload.
          { fps: 10, qrbox: { width: 260, height: 130 } },
          (decodedText: string) => {
            const now = Date.now();
            const last = lastDecodedRef.current;
            if (last && last.code === decodedText && now - last.atMs < DECODE_COOLDOWN_MS) return;
            lastDecodedRef.current = { code: decodedText, atMs: now };
            onDecodeRef.current(decodedText);
          },
          () => {
            /* ignore per-frame decode errors */
          },
        );
      } catch {
        // Covers both a denied permission prompt (DOMException
        // NotAllowedError) and any other camera-start failure (no camera,
        // already in use elsewhere) — the crew's way back is the same in
        // every case: fall back to the reader, never a blank viewfinder.
        setCameraError(true);
      }
    }

    startScanner();
    return () => {
      // Same shape as RouteQRScannerEntry's cleanup: html5-qrcode throws
      // SYNCHRONOUSLY from stop() when the scanner never started, not a
      // rejected promise — a throw out of an effect cleanup would unmount
      // this screen into the error boundary.
      const running = scanner;
      scanner = null;
      if (!running) return;
      const clear = () => {
        try {
          running.clear();
        } catch {
          /* already gone */
        }
      };
      try {
        Promise.resolve(running.stop()).catch(() => {}).finally(clear);
      } catch {
        clear();
      }
    };
  }, [active]);

  return { cameraError, readerElementId: CAMERA_READER_ELEMENT_ID };
}
