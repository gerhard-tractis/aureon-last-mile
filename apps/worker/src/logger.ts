// src/logger.ts — Structured JSON logger for journald capture
export function log(
  level: 'debug' | 'info' | 'warn' | 'error',
  event: string,
  meta?: Record<string, unknown>,
): void {
  const entry = { level, ts: new Date().toISOString(), event, ...meta };
  console.log(JSON.stringify(entry));
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
