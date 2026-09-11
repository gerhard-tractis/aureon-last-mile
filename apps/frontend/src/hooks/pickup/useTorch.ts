'use client';

import { useCallback, useState } from 'react';

// `torch` es una extensión no estándar de Media Capture and Streams — TS
// lib.dom no la tipa.
interface TorchCapabilities extends MediaTrackCapabilities {
  torch?: boolean;
}
interface TorchConstraints extends MediaTrackConstraints {
  torch?: boolean;
}

/** El subconjunto de `MediaStreamTrack` que este hook necesita — ni más ni
 * menos — para poder testear sin construir un `MediaStreamTrack` real. */
interface TorchTrack {
  getCapabilities?: () => TorchCapabilities;
  applyConstraints?: (constraints: MediaTrackConstraints) => Promise<void>;
}

/**
 * Fase 9, spec-95 (`5g`, el botón de flash) — estado y transiciones del
 * flash, aisladas de `ManifestCameraSheet` (review de `6817496`: montar la
 * hoja entera, con cámara y canvas, sólo para probar la lectura de una
 * capacidad era el motivo de que el caso decisivo quedara sin test).
 */
export function useTorch() {
  const [torchSupported, setTorchSupported] = useState(false);
  const [torchOn, setTorchOn] = useState(false);

  // B1 (review 6817496) — `'torch' in capabilities` es cierto también
  // cuando el valor es `false`: así es como Chromium declara "esta pista
  // NO tiene linterna" (cámara frontal de Android, webcam de escritorio).
  // Sólo `torch === true` es soporte real; cualquier otra cosa (ausente,
  // `false`, sin `getCapabilities`) no lo es.
  const registerTrack = useCallback((track: TorchTrack) => {
    const capabilities = track.getCapabilities?.();
    setTorchSupported(capabilities?.torch === true);
  }, []);

  // La pista se silencia (interrupción, segundo plano en iOS) — el flash
  // deja de estar bajo nuestro control, así que la UI no puede seguir
  // afirmando que está encendido. La capacidad en sí no cambió: la pista
  // sigue viva, puede volver.
  const handleTrackDown = useCallback(() => {
    setTorchOn(false);
  }, []);

  // La pista MURIÓ (permiso revocado, otra app tomó la cámara). No vuelve
  // dentro de esta sesión — ni el "encendido" ni el soporte siguen siendo
  // ciertos.
  const handleTrackEnded = useCallback(() => {
    setTorchOn(false);
    setTorchSupported(false);
  }, []);

  const reset = useCallback(() => {
    setTorchSupported(false);
    setTorchOn(false);
  }, []);

  // B2 (review 6817496) — un `ConstraintSet` dentro de `advanced` es
  // best-effort por spec: el user agent lo SALTA si no puede satisfacerlo
  // y la promesa de `applyConstraints` resuelve igual — no hay
  // `OverconstrainedError` ahí, así que el `.catch` de abajo nunca
  // corría contra un dispositivo real. Como constraint BÁSICO (sin
  // `advanced`), si el track no soporta `torch`, sí rechaza de verdad.
  const toggleTorch = useCallback(
    (track: TorchTrack | null) => {
      if (!track?.applyConstraints) return;
      const next = !torchOn;
      const constraints: TorchConstraints = { torch: next };
      track
        .applyConstraints(constraints)
        .then(() => setTorchOn(next))
        .catch(() => {
          // El dispositivo lo rechazó de verdad — no fingimos el cambio.
        });
    },
    [torchOn]
  );

  return { torchSupported, torchOn, registerTrack, handleTrackDown, handleTrackEnded, toggleTorch, reset };
}
