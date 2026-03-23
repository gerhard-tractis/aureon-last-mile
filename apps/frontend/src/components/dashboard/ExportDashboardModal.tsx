'use client';

import { useState, useCallback, useMemo } from 'react';
import { format, subDays, differenceInDays, parseISO } from 'date-fns';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { useExportData } from '@/hooks/useDashboardMetrics';
import { createSPAClient } from '@/lib/supabase/client';
import {
  generateCSV,
  downloadCSV,
  generatePDF,
  type ExportFormat,
  type ExportSections,
} from '@/lib/utils/exportDashboard';

interface ExportDashboardModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  operatorId: string;
}

type DateRangeOption = '7' | '30' | '90';

const DATE_RANGE_LABELS: Record<DateRangeOption, string> = {
  '7': 'Últimos 7 días',
  '30': 'Últimos 30 días',
  '90': 'Últimos 90 días',
};

const SECTION_LABELS: Record<keyof ExportSections, string> = {
  sla: 'Resumen SLA',
  primary: 'Métricas Primarias',
  customers: 'Tabla de Clientes',
  failures: 'Análisis de Fallos',
  secondary: 'Métricas Secundarias',
};

function computeDates(days: number) {
  const today = new Date();
  const endDate = format(today, 'yyyy-MM-dd');
  const startDate = format(subDays(today, days - 1), 'yyyy-MM-dd');
  const dayCount = differenceInDays(parseISO(endDate), parseISO(startDate)) + 1;
  const prevEndDate = format(subDays(parseISO(startDate), 1), 'yyyy-MM-dd');
  const prevStartDate = format(subDays(parseISO(startDate), dayCount), 'yyyy-MM-dd');
  return { startDate, endDate, prevStartDate, prevEndDate };
}

export default function ExportDashboardModal({
  open,
  onOpenChange,
  operatorId,
}: ExportDashboardModalProps) {
  const [exportFormat, setExportFormat] = useState<ExportFormat>('csv');
  const [dateRange, setDateRange] = useState<DateRangeOption>('30');
  const [sections, setSections] = useState<ExportSections>({
    sla: true,
    primary: true,
    customers: true,
    failures: true,
    secondary: true,
  });
  const [filename, setFilename] = useState(
    `aureon-dashboard-${format(new Date(), 'yyyy-MM-dd')}`
  );
  const [isExporting, setIsExporting] = useState(false);

  const days = Number(dateRange);
  const { startDate, endDate, prevStartDate, prevEndDate } = useMemo(
    () => computeDates(days),
    [days]
  );

  const { data: exportData, isLoading: dataLoading } = useExportData(
    operatorId,
    startDate,
    endDate,
    prevStartDate,
    prevEndDate,
    open
  );

  const toggleSection = (key: keyof ExportSections) => {
    setSections(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const handleExport = useCallback(async () => {
    if (!exportData) return;
    setIsExporting(true);

    const dateRangeLabel = DATE_RANGE_LABELS[dateRange];

    try {
      if (exportFormat === 'csv') {
        const csv = generateCSV(exportData, sections, dateRangeLabel);
        downloadCSV(csv, filename);
      } else {
        try {
          generatePDF(exportData, sections, dateRangeLabel, filename);
        } catch {
          // Fallback to CSV on PDF error — strip .pdf extension if present
          toast.error('Error generando PDF. Descargando CSV.');
          const csv = generateCSV(exportData, sections, dateRangeLabel);
          const csvFilename = filename.replace(/\.pdf$/i, '');
          downloadCSV(csv, csvFilename);
        }
      }

      toast.success(`Reporte descargado: ${filename}`);

      // Audit log (non-blocking)
      try {
        await (createSPAClient().from('audit_logs').insert as CallableFunction)({
          action: 'EXPORT_DASHBOARD',
          resource_type: 'report',
          details: {
            format: exportFormat,
            filename,
            sections,
            dateRange,
          },
        });
      } catch {
        // Non-blocking
      }

      onOpenChange(false);
    } finally {
      setIsExporting(false);
    }
  }, [exportData, exportFormat, sections, filename, dateRange, onOpenChange]);

  const handleCancel = () => {
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg rounded-xl shadow-lg">
        <DialogHeader>
          <DialogTitle>Exportar Dashboard</DialogTitle>
          <DialogDescription>
            Selecciona el formato y las secciones a incluir en el reporte.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          {/* Format */}
          <div>
            <label className="block text-sm font-medium text-foreground mb-2">
              Formato
            </label>
            <div className="flex gap-4">
              {(['csv', 'pdf'] as const).map(fmt => (
                <label key={fmt} className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="export-format"
                    value={fmt}
                    checked={exportFormat === fmt}
                    onChange={() => setExportFormat(fmt)}
                    className="w-4 h-4 text-accent"
                  />
                  <span className="text-sm text-foreground uppercase">{fmt}</span>
                </label>
              ))}
            </div>
          </div>

          {/* Date Range */}
          <div>
            <label
              htmlFor="export-date-range"
              className="block text-sm font-medium text-foreground mb-2"
            >
              Rango de Fechas
            </label>
            <select
              id="export-date-range"
              value={dateRange}
              onChange={e => setDateRange(e.target.value as DateRangeOption)}
              className="w-full text-sm border border-border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-accent"
            >
              {(Object.entries(DATE_RANGE_LABELS) as [DateRangeOption, string][]).map(
                ([val, label]) => (
                  <option key={val} value={val}>
                    {label}
                  </option>
                )
              )}
            </select>
          </div>

          {/* Sections */}
          <div>
            <label className="block text-sm font-medium text-foreground mb-2">
              Secciones a incluir
            </label>
            <div className="space-y-2">
              {(Object.entries(SECTION_LABELS) as [keyof ExportSections, string][]).map(
                ([key, label]) => (
                  <label key={key} className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={sections[key]}
                      onChange={() => toggleSection(key)}
                      className="w-4 h-4 rounded border-border text-accent focus:ring-accent"
                    />
                    <span className="text-sm text-foreground">{label}</span>
                  </label>
                )
              )}
            </div>
          </div>

          {/* Filename */}
          <div>
            <label
              htmlFor="export-filename"
              className="block text-sm font-medium text-foreground mb-2"
            >
              Nombre del archivo
            </label>
            <input
              id="export-filename"
              type="text"
              value={filename}
              onChange={e => setFilename(e.target.value)}
              className="w-full text-sm border border-border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-accent"
            />
          </div>
        </div>

        <DialogFooter className="mt-4">
          <button
            type="button"
            onClick={handleCancel}
            className="px-4 py-2 text-sm font-medium text-foreground border border-border rounded-lg hover:bg-[var(--color-surface-raised)]"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={handleExport}
            disabled={isExporting || dataLoading}
            className="px-6 py-2 text-sm font-medium bg-accent text-accent-foreground hover:opacity-90 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isExporting ? (
              <span className="flex items-center gap-2">
                <svg
                  className="animate-spin h-4 w-4"
                  viewBox="0 0 24 24"
                  fill="none"
                >
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                  />
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                  />
                </svg>
                Generando...
              </span>
            ) : (
              'Exportar'
            )}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
