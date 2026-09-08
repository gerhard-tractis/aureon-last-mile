/**
 * spec-81 fase 2, ronda 4 de review del PR #679 — costura 2 ("el filtro de
 * B2 no cubre lo que M3 bloquea").
 *
 * Hasta esta ronda, "¿puede avanzar este manifiesto?" tenía DOS
 * implementaciones independientes: `drainManifest` (useOfflineQueue.ts)
 * comprobaba `manifestHasDeadEntry` Y `manifestBlockedForUser` en cada
 * vuelta; el cómputo de `remaining`/`soonest` de `drain()` (el que decide
 * cuándo reprogramar el próximo intento) sólo filtraba por
 * `manifestHasDeadEntry`. Un manifiesto bloqueado por `manifestBlockedForUser`
 * (M3) pero no por un `dead` seguía alimentando `soonest` con un
 * `nextAttemptAt` ya vencido → `delay = 0` en cada pasada → spin sin techo.
 * Medido por el reviewer: ~45 pasadas/s, 0 envíos, sin salida hasta
 * desmontar.
 *
 * `manifestIsBlocked` es ahora el ÚNICO predicado que decide si un
 * manifiesto puede avanzar — lo consume tanto `drainManifest` (para saber si
 * debe detenerse) como `drain()` (para saber si debe excluir el manifiesto
 * de `remaining` antes de programar el próximo reintento). Con una sola
 * fuente de verdad, esta clase de bug no puede volver a divergir por un
 * tercer flanco.
 */
import type { PickupQueueEntry } from '../db';
import type { PickupQueueStore } from './queue-claims';
import { listPending, manifestHasDeadEntry } from './queue';

/**
 * Decisión del usuario, 2026-09-08 (ronda 4 de review del PR #679) — el
 * bloqueo cross-user (M-2) deja de ser permanente. Un turno de recogida dura
 * horas; 15 minutos sin que el dueño de una entrada `pending` la mueva
 * significa que ya no está, y el trabajo tiene que seguir sin intervención
 * humana. Riesgo asumido explícitamente por el usuario: si los dos
 * operarios están activos a la vez, uno puede enviar lo que encoló el otro
 * — aceptable porque el envío es idempotente (`client_operation_id`, spec-81
 * fase 3) y `close_manifest` deriva el firmante de `auth.uid()` en el
 * servidor, no del payload — nada se pierde ni se duplica.
 *
 * Deliberadamente NO es `RECLAIM_STALE_MS` (`useOfflineQueue.ts`, 90s):
 * aquella recupera una reclamación `sending` huérfana de la MISMA sesión
 * (pestaña muerta a mitad de envío); ésta reclama una entrada `pending` de
 * OTRA persona que nunca llegó a intentarse. Semánticas distintas,
 * temporizadores distintos.
 */
export const CROSS_USER_RECLAIM_MS = 15 * 60_000;

function lastTouchedAt(entry: PickupQueueEntry): number {
  return Date.parse(entry.lastAttemptAt ?? entry.createdAt);
}

/**
 * La cabeza real del FIFO de un manifiesto — `pending` o `sending`, de
 * cualquier dueño. Incluir `sending` (a diferencia de `listPending`, que lo
 * excluye a propósito) es lo que cierra el menor 2 de la ronda 4: una
 * entrada ajena atascada `sending` bloquea igual que una `pending` fresca —
 * sin esto había una ventana de hasta `RECLAIM_STALE_MS` en la que el salto
 * de FIFO entre usuarios seguía siendo posible.
 */
export async function manifestHead(
  db: PickupQueueStore,
  operatorId: string,
  manifestId: string,
): Promise<PickupQueueEntry | undefined> {
  const [head] = await db.pickup_queue
    .where('operatorId')
    .equals(operatorId)
    .and((entry) => entry.manifestId === manifestId && (entry.status === 'pending' || entry.status === 'sending'))
    .toArray();
  return head;
}

/**
 * M3, ronda 3 de review del PR #679 — un `pending`/`sending` de OTRO usuario
 * por delante en el FIFO de este manifiesto bloquea, igual que un `dead`
 * bloquea (ver `manifestHasDeadEntry`), sólo que temporalmente.
 *
 * Ronda 4 — deja de ser permanente para el caso `pending`: pasado
 * `CROSS_USER_RECLAIM_MS` desde el último toque de esa entrada (su propio
 * intento, o su encolado si nunca se intentó), deja de bloquear. Una
 * entrada `sending` de otro usuario SIEMPRE bloquea — no tiene temporizador
 * propio aquí; `reclaimStale` (que sí filtra por operador, no por usuario) es
 * quien la devuelve a `pending` tras `RECLAIM_STALE_MS`, momento en el que
 * este mismo chequeo vuelve a evaluarla como `pending` y aplica su propio
 * temporizador.
 */
export async function manifestBlockedForUser(
  db: PickupQueueStore,
  operatorId: string,
  manifestId: string,
  userId: string,
): Promise<boolean> {
  const head = await manifestHead(db, operatorId, manifestId);
  if (head === undefined || head.userId === userId) return false;
  if (head.status === 'sending') return true;
  return Date.now() - lastTouchedAt(head) < CROSS_USER_RECLAIM_MS;
}

/**
 * El único predicado que decide si un manifiesto puede avanzar — ver el
 * docstring del módulo. Combina las dos guardas: un `dead` en cualquier
 * lugar del manifiesto (permanente, decisión de negocio, B3 ronda 1) y un
 * `pending`/`sending` de otro usuario por delante que aún no es reclamable
 * (M3 + la decisión de ronda 4).
 */
export async function manifestIsBlocked(
  db: PickupQueueStore,
  operatorId: string,
  manifestId: string,
  userId: string,
): Promise<boolean> {
  if (await manifestHasDeadEntry(db, operatorId, manifestId)) return true;
  return manifestBlockedForUser(db, operatorId, manifestId, userId);
}

/** Re-exportado por conveniencia — algunos llamadores (`db.ts`) sólo
 * necesitan filtrar entradas pendientes propias sin volver a implementar la
 * lógica de FIFO. */
export { listPending };
