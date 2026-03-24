/**
 * Spanish translation dictionary for Aureon Last Mile.
 * Flat key-path structure. Interpolate {n}, {name}, etc. via useTranslation.
 */
const es = {
  connection: {
    offline: 'Sin conexión',
    syncing: 'Sincronizando...',
    queued: '{n} escaneos en cola',
  },
} as const;

export type Dict = typeof es;
export default es;
