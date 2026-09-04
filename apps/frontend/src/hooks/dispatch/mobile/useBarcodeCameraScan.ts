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
// otherwise resubmit itself many times over. This hook keeps only the
// mount/cleanup/error-handling shape and adds:
//   - a per-session submitted-code memory (review I3, below), not a timer;
//   - a start-vs-cleanup race guard (review C2, below);
//   - a `visibilitychange` listener that stops the camera while the tab is
//     backgrounded (review I4) — the exact hardware/battery cost rule 7
//     (spec-76 Lecciones aplicadas) exists to avoid, and gating on `active`
//     alone does not cover a crew member switching apps mid-shift.
import { useEffect, useRef, useState } from 'react';
import { Html5Qrcode } from 'html5-qrcode';

export const CAMERA_READER_ELEMENT_ID = 'dispatch-camera-reader';

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

type Scanner = { stop: () => Promise<void>; clear: () => void };

/** Stops a running scanner instance without throwing. Same shape as the
 *  original cleanup (and RouteQRScannerEntry's): html5-qrcode's `stop()`
 *  can throw SYNCHRONOUSLY — "Cannot stop, scanner is not running or
 *  paused" — not just reject, so a plain `await ... catch` is not enough;
 *  the call itself has to be inside a `try`. Fire-and-forget, never
 *  awaited by the caller — a throw out of an effect cleanup unmounts the
 *  whole screen into the error boundary. */
function stopScannerSafely(running: Scanner) {
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

  useEffect(() => {
    if (!active) return;
    setCameraError(false);

    // review I3 — every code accepted in THIS camera session is
    // remembered for good, not for a fixed window. At ~10fps a label left
    // in frame decodes roughly every 100ms; a 2s cooldown let the SAME
    // already-accepted code resubmit at t+2s, t+4s, ... — each one
    // rejected by the server as a duplicate, replacing the crew's green
    // "cargado" card with a red one and adding a permanent bogus entry to
    // the rejection tally, repeating for as long as the label stayed in
    // frame. A box can only be loaded once, so ANY repeat of a code this
    // session already sent is a rejection by definition — remembering it
    // forever (session-scoped: a fresh `Set` every time `active` goes
    // true) is strictly correct, not merely "wider", and also closes the
    // A→B→A-within-the-window hole a single `lastDecoded` slot had.
    const submittedCodes = new Set<string>();

    // review C2 — true once this effect's cleanup has run. `startScanner`
    // is fire-and-forget: without this flag, a `Volver al lector` tap (or
    // a React Strict-Mode double-effect) that lands WHILE `qr.start()` is
    // still resolving (it takes ~0.3-1s to acquire the camera) ran
    // cleanup against a scanner reference that did not exist yet — cleanup
    // found nothing to stop, and the pending `start()` went on to acquire
    // the camera anyway, with nothing left holding a reference to stop it
    // later. Checking this flag right after `start()` resolves closes
    // that window: a scanner that finishes starting AFTER teardown is
    // stopped immediately instead of leaking.
    let torndown = false;
    // review I4 — true while stopped specifically because the tab is
    // hidden (not because the crew left camera mode). Distinguished from
    // `torndown` so `handleVisibilityChange` knows whether becoming
    // visible again should restart the camera.
    let stoppedForVisibility = false;
    let scanner: Scanner | null = null;

    async function startScanner() {
      try {
        const qr = new Html5Qrcode(CAMERA_READER_ELEMENT_ID);
        await qr.start(
          { facingMode: 'environment' },
          // A wide, short box — this reads a barcode strip, not a square
          // QR payload.
          { fps: 10, qrbox: { width: 260, height: 130 } },
          (decodedText: string) => {
            if (submittedCodes.has(decodedText)) return;
            submittedCodes.add(decodedText);
            onDecodeRef.current(decodedText);
          },
          () => {
            /* ignore per-frame decode errors */
          },
        );
        if (torndown || stoppedForVisibility) {
          // Lost the race — something already tore this session down (or
          // backgrounded the tab) while `start()` was in flight. Stop
          // straight away rather than leave an unreferenced stream open.
          stopScannerSafely(qr);
          return;
        }
        scanner = qr;
      } catch {
        // Covers both a denied permission prompt (DOMException
        // NotAllowedError) and any other camera-start failure (no camera,
        // already in use elsewhere) — the crew's way back is the same in
        // every case: fall back to the reader, never a blank viewfinder.
        if (!torndown) setCameraError(true);
      }
    }

    function stopScanner() {
      const running = scanner;
      scanner = null;
      if (!running) return;
      stopScannerSafely(running);
    }

    function handleVisibilityChange() {
      if (document.hidden) {
        stoppedForVisibility = true;
        stopScanner();
      } else if (stoppedForVisibility) {
        stoppedForVisibility = false;
        startScanner();
      }
    }

    document.addEventListener('visibilitychange', handleVisibilityChange);
    startScanner();

    return () => {
      torndown = true;
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      stopScanner();
    };
  }, [active]);

  return { cameraError, readerElementId: CAMERA_READER_ELEMENT_ID };
}
