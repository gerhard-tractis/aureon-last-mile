/**
 * Cuándo cerrar una recepción exige nota de discrepancia.
 *
 * Vivía dentro de FinalizeReceptionButton; se extrajo al aparecer el segundo
 * consumidor (la hoja móvil de spec-62). Una regla con dos consumidores no
 * puede estar escrita dos veces.
 *
 * POR QUÉ NO ES received < expected. spec-52 acepta un paquete que llega sin
 * retiro verificado en esa ruta: incrementa received_count Y unexpected_count,
 * así que los dos errores se compensan y el conteo crudo cuadra:
 *
 *   10 esperados · 10 recibidos · 1 ajeno
 *     -> cuadra, y sin embargo UN paquete esperado no llegó y UNO de otro
 *        camión sí. Comparar totales lo deja pasar en silencio.
 *
 * Separar las poblaciones no lo deja pasar:
 *   matched   := received - unexpected
 *   needsNote := matched !== expected || unexpected > 0
 *
 * ASIMETRÍA DELIBERADA CON EL SERVIDOR. complete_route_reception conserva el
 * guard de spec-47 (`received_count < expected_count`); la regla de arriba
 * quedó explícitamente diferida — ver PART 3 de
 * 20260812000006_spec52_unexpected_count.sql — y es trabajo de spec-56. La UI
 * pide nota en más casos que el servidor, nunca en menos: esa dirección es la
 * segura. La inversa dejaría la recepción sin poder cerrarse.
 */
export interface ReceptionCounts {
  expectedCount: number;
  receivedCount: number;
  unexpectedCount: number;
}

export interface FinalizeDecision {
  /** Esperados que efectivamente llegaron. */
  matched: number;
  /** Esperados que no llegaron. Nunca negativo. */
  missing: number;
  needsNote: boolean;
}

export function finalizeRule({
  expectedCount,
  receivedCount,
  unexpectedCount,
}: ReceptionCounts): FinalizeDecision {
  const matched = receivedCount - unexpectedCount;
  return {
    matched,
    missing: Math.max(0, expectedCount - matched),
    needsNote: matched !== expectedCount || unexpectedCount > 0,
  };
}

/**
 * Lo que el servidor exige HOY, ni más ni menos. Existe para que el test de
 * inclusión pueda nombrarlo; no lo uses para decidir en la UI.
 */
export function serverRequiresNote({ expectedCount, receivedCount }: ReceptionCounts): boolean {
  return receivedCount < expectedCount;
}
