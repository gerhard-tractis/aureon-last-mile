'use client';

/**
 * AuditLogDetailRow — expandable before/after diff view for audit log entries
 * Epic 5 / Spec-06: Capacity Calendar, Alerts & Audit Log Viewer
 */

import { useState } from 'react';
import type { AuditLogEntry } from '@/hooks/useAuditLogsOps';
import { Button } from '@/components/ui/button';

// ── Types ────────────────────────────────────────────────────────────────────

interface AuditLogDetailRowProps {
  entry: AuditLogEntry;
}

// ── JSON Syntax Highlighting ──────────────────────────────────────────────────

function highlightJson(obj: unknown): React.ReactNode {
  const json = JSON.stringify(obj, null, 2);
  const lines = json.split('\n');

  return lines.map((line, i) => {
    // Key coloring (blue), string values (green), numbers (orange), booleans/null (purple)
    const highlighted = line
      .replace(
        /("[\w\s]+")\s*:/g,
        '<span class="text-status-info">$1</span>:',
      )
      .replace(
        /:\s*("(?:[^"\\]|\\.)*")/g,
        ': <span class="text-green-600 dark:text-green-400">$1</span>',
      )
      .replace(
        /:\s*(\d+\.?\d*)/g,
        ': <span class="text-status-warning">$1</span>',
      )
      .replace(
        /:\s*(true|false|null)/g,
        ': <span class="text-accent">$1</span>',
      );

    return (
      <span
        key={i}
        dangerouslySetInnerHTML={{ __html: highlighted + '\n' }}
      />
    );
  });
}

// ── Sub-component: JSON Panel ──────────────────────────────────────────────────

interface JsonPanelProps {
  label: string;
  data: unknown;
  fullJson: string;
}

const JSON_SIZE_LIMIT = 100_000;

function JsonPanel({ label, data, fullJson }: JsonPanelProps) {
  const [modalOpen, setModalOpen] = useState(false);
  const isLarge = fullJson.length > JSON_SIZE_LIMIT;

  return (
    <div className="flex-1 min-w-0">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">
        {label}
      </p>
      <pre className="bg-muted rounded p-3 overflow-auto text-xs font-mono max-h-48 border border-border">
        {isLarge
          ? JSON.stringify(data, null, 2).slice(0, 500) + '\n… [truncado]'
          : highlightJson(data)}
      </pre>
      {isLarge && (
        <>
          <Button
            variant="ghost"
            size="sm"
            className="mt-1 text-xs"
            onClick={() => setModalOpen(true)}
          >
            Ver JSON completo
          </Button>
          {modalOpen && (
            <div
              className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
              onClick={() => setModalOpen(false)}
            >
              <div
                className="bg-card border border-border rounded-lg shadow-xl p-6 max-w-3xl w-full max-h-[80vh] overflow-auto"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="flex justify-between items-center mb-4">
                  <h3 className="text-sm font-semibold text-foreground">{label} — JSON completo</h3>
                  <button
                    className="text-muted-foreground hover:text-foreground"
                    onClick={() => setModalOpen(false)}
                  >
                    ✕
                  </button>
                </div>
                <pre className="text-xs font-mono overflow-auto whitespace-pre-wrap">
                  {highlightJson(data)}
                </pre>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────────

export default function AuditLogDetailRow({ entry }: AuditLogDetailRowProps) {
  const { action, changes_json } = entry;

  if (!changes_json) {
    return (
      <div className="px-4 py-3 bg-muted/30 border-t border-border">
        <p className="text-xs text-muted-foreground italic">Sin datos de cambios disponibles.</p>
      </div>
    );
  }

  const fullJson = JSON.stringify(changes_json);
  const before = (changes_json as Record<string, unknown>).before;
  const after = (changes_json as Record<string, unknown>).after;

  const showBefore = action === 'UPDATE' || action === 'DELETE';
  const showAfter = action === 'UPDATE' || action === 'INSERT';

  return (
    <div className="px-4 py-3 bg-muted/30 border-t border-border">
      <div className="flex gap-4 flex-wrap">
        {showBefore && before !== undefined && (
          <JsonPanel label="Before" data={before} fullJson={fullJson} />
        )}
        {showAfter && after !== undefined && (
          <JsonPanel label="After" data={after} fullJson={fullJson} />
        )}
        {!showBefore && !showAfter && (
          <JsonPanel label="Datos" data={changes_json} fullJson={fullJson} />
        )}
      </div>
    </div>
  );
}
