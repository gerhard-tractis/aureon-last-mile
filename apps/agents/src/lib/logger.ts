// src/lib/logger.ts — Structured JSON logger for agent stdout capture
// Extra fields vs worker logger: agent, tool, operator_id, job_id, request_id (via meta)

export function log(
  level: 'debug' | 'info' | 'warn' | 'error',
  event: string,
  meta?: Record<string, unknown>,
): void {
  const entry = { level, ts: new Date().toISOString(), event, ...meta };
  console.log(JSON.stringify(entry));
}
