/**
 * spec-80 fase 4 (5g) — ¿hay un frame real para capturar?
 *
 * Ronda 4 de review del PR #713 — un frame congelado (dimensiones > 0) no
 * basta: la pista puede seguir "viva" en el `<video>` pero `ended` o
 * `muted`. Se deriva de las tres señales juntas para que sea la misma
 * función la que habilita (`loadedmetadata`, `unmute`, `visible`) y
 * deshabilita (`ended`, `mute`, `hidden`) — evita que una rama tenga ida y
 * la otra no (ver `ManifestCameraSheet.tsx`).
 */
export function isVideoReady(
  video: Pick<HTMLVideoElement, 'videoWidth' | 'videoHeight'> | null,
  track: Pick<MediaStreamTrack, 'readyState' | 'muted'> | null
): boolean {
  return (
    !!video &&
    video.videoWidth > 0 &&
    video.videoHeight > 0 &&
    !!track &&
    track.readyState === 'live' &&
    !track.muted
  );
}
