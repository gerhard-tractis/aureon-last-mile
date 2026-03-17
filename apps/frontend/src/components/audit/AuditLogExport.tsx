'use client';

/**
 * AuditLogExport — CSV export button for audit log viewer
 * Epic 5 / Spec-06: Capacity Calendar, Alerts & Audit Log Viewer
 */

import { toast } from 'sonner';
import type { AuditLogEntry } from '@/hooks/useAuditLogsOps';
import { Button } from '@/components/ui/button';

// ── Types ────────────────────────────────────────────────────────────────────

interface AuditLogExportProps {
  logs: AuditLogEntry[];
  userMap: Record<string, string>;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function escapeCSV(value: string | null | undefined): string {
  if (value == null) return '';
  const str = String(value);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function buildCSV(logs: AuditLogEntry[], userMap: Record<string, string>): string {
  const headers = ['Fecha/Hora', 'Usuario', 'Acción', 'Recurso', 'resource_id'];
  const rows = logs.map((log) => [
    escapeCSV(new Date(log.timestamp).toLocaleString('es-CL')),
    escapeCSV(userMap[log.user_id] ?? log.user_id),
    escapeCSV(log.action),
    escapeCSV(log.resource_type),
    escapeCSV(log.resource_id),
  ]);

  return [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
}

function getTodayFilename(): string {
  const today = new Date().toISOString().split('T')[0];
  return `audit-logs-${today}.csv`;
}

// ── Component ─────────────────────────────────────────────────────────────────

const EXPORT_WARN_THRESHOLD = 10_000;

export default function AuditLogExport({ logs, userMap }: AuditLogExportProps) {
  function handleExport() {
    if (logs.length > EXPORT_WARN_THRESHOLD) {
      toast.warning(
        `Exportando ${logs.length.toLocaleString()} registros. El archivo puede ser grande.`,
      );
    }

    const csv = buildCSV(logs, userMap);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);

    const link = document.createElement('a');
    link.href = url;
    link.download = getTodayFilename();
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  return (
    <Button variant="outline" size="sm" onClick={handleExport}>
      Exportar CSV
    </Button>
  );
}
