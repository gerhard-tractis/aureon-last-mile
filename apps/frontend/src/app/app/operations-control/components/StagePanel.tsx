'use client';

import type { ReactNode } from 'react';
import { Card, CardHeader, CardContent, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

export interface KpiSlot {
  label: string;
  value: string;
  trend?: string;
}

interface StagePanelProps {
  title: string;
  subtitle: string;
  deepLink: string | null;
  deepLinkLabel?: string;
  kpis: KpiSlot[];
  children: ReactNode;
  page: number;
  pageCount: number;
  onPageChange: (page: number) => void;
  lastSyncAt: Date | null;
}

export function StagePanel({
  title, subtitle, deepLink, deepLinkLabel = 'Abrir',
  kpis, children, page, pageCount, onPageChange, lastSyncAt,
}: StagePanelProps) {
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0 pb-4">
        <div>
          <h2 className="text-lg font-semibold text-text">{title}</h2>
          <p className="text-sm text-text-secondary">{subtitle}</p>
        </div>
        {deepLink !== null ? (
          <Button variant="outline" size="sm" asChild>
            <a href={deepLink}>{deepLinkLabel} →</a>
          </Button>
        ) : (
          <Button variant="outline" size="sm" disabled>Próximamente</Button>
        )}
      </CardHeader>

      <div className="grid grid-cols-4 border-y border-border">
        {kpis.slice(0, 4).map((kpi) => (
          <div key={kpi.label} className="border-r border-border p-4 last:border-r-0">
            <span className="text-xs uppercase tracking-wide text-text-muted">{kpi.label}</span>
            <div className="mt-1">
              <span className="font-mono text-xl font-semibold leading-none tabular-nums text-text">
                {kpi.value}
              </span>
              {kpi.trend && (
                <span className="ml-1 text-sm text-text-secondary">{kpi.trend}</span>
              )}
            </div>
          </div>
        ))}
      </div>

      <CardContent className="p-0">
        {children}
      </CardContent>

      <CardFooter className="justify-between border-t border-border px-4 py-2">
        <div className="flex items-center gap-2 text-xs text-text-secondary">
          <Button variant="outline" size="sm" onClick={() => onPageChange(page - 1)} disabled={page <= 1}>
            Anterior
          </Button>
          <span>Página {page} de {pageCount}</span>
          <Button variant="outline" size="sm" onClick={() => onPageChange(page + 1)} disabled={page >= pageCount}>
            Siguiente
          </Button>
        </div>
        <span className="text-xs text-text-muted">
          Tiempo real
          {lastSyncAt && <> · {lastSyncAt.toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })}</>}
        </span>
      </CardFooter>
    </Card>
  );
}
