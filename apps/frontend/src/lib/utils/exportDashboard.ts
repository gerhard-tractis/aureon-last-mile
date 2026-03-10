import { jsPDF } from 'jspdf';
import type {
  CustomerPerformanceRow,
  FailureReasonRow,
  SecondaryMetrics,
} from '@/hooks/useDashboardMetrics';
import { formatDateTime } from '@/lib/utils/dateFormat';

export type ExportFormat = 'csv' | 'pdf';

export type ExportSections = {
  sla: boolean;
  primary: boolean;
  customers: boolean;
  failures: boolean;
  secondary: boolean;
};

export type SlaExportData = {
  value: number | null;
  prevValue: number | null;
  totalOrders: number;
  deliveredOrders: number;
};

export type PrimaryExportData = {
  fadrValue: number | null;
  fadrPrev: number | null;
  fadrFirstAttempt: number;
  fadrTotal: number;
  claimsCount: number;
  claimsAmount: number;
  claimsPrevCount: number;
  claimsPrevAmount: number;
  avgDeliveryTime: number | null;
  prevAvgDeliveryTime: number | null;
};

export type DashboardExportPayload = {
  sla: SlaExportData;
  primary: PrimaryExportData;
  customers: CustomerPerformanceRow[];
  failures: FailureReasonRow[];
  secondary: SecondaryMetrics | null;
  prevSecondary: SecondaryMetrics | null;
};

function escapeCSVField(value: string | number): string {
  const str = String(value);
  if (
    str.includes(',') ||
    str.includes('"') ||
    str.includes('\n') ||
    /^[=+\-@\t\r]/.test(str)
  ) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function csvRow(fields: (string | number)[]): string {
  return fields.map(escapeCSVField).join(',');
}

function fmtPct(v: number | null): string {
  return v !== null ? `${v.toFixed(1)}%` : 'N/A';
}

function fmtNum(v: number | null): string {
  return v !== null ? String(v) : 'N/A';
}

export function generateCSV(
  data: DashboardExportPayload,
  sections: ExportSections,
  _dateRange: string
): string {
  const lines: string[] = [];

  if (sections.sla) {
    lines.push(csvRow(['Resumen SLA']));
    lines.push(csvRow(['Métrica', 'Valor', 'Período anterior']));
    lines.push(
      csvRow([
        'SLA %',
        fmtPct(data.sla.value),
        fmtPct(data.sla.prevValue),
      ])
    );
    lines.push(
      csvRow(['Total Pedidos', data.sla.totalOrders, ''])
    );
    lines.push(
      csvRow(['Pedidos Entregados', data.sla.deliveredOrders, ''])
    );
    lines.push('');
  }

  if (sections.primary) {
    lines.push(csvRow(['Métricas Primarias']));
    lines.push(csvRow(['Métrica', 'Valor', 'Período anterior']));
    lines.push(
      csvRow([
        'FADR %',
        fmtPct(data.primary.fadrValue),
        fmtPct(data.primary.fadrPrev),
      ])
    );
    lines.push(
      csvRow([
        'Reclamos (cantidad)',
        data.primary.claimsCount,
        data.primary.claimsPrevCount,
      ])
    );
    lines.push(
      csvRow([
        'Reclamos (CLP)',
        data.primary.claimsAmount,
        data.primary.claimsPrevAmount,
      ])
    );
    lines.push(
      csvRow([
        'Tiempo medio entrega (min)',
        fmtNum(data.primary.avgDeliveryTime),
        fmtNum(data.primary.prevAvgDeliveryTime),
      ])
    );
    lines.push('');
  }

  if (sections.customers) {
    if (data.customers.length === 0) {
      lines.push(csvRow(['Tabla de Clientes']));
      lines.push(csvRow(['Sin datos para este período']));
      lines.push('');
    } else {
      lines.push(csvRow(['Tabla de Clientes']));
      lines.push(
        csvRow([
          'Cliente',
          'Pedidos',
          'Entregados',
          'SLA %',
          'FADR %',
          'Fallos',
        ])
      );
      for (const r of data.customers) {
        lines.push(
          csvRow([
            r.retailer_name,
            r.total_orders,
            r.delivered_orders,
            fmtPct(r.sla_pct),
            fmtPct(r.fadr_pct),
            r.failed_deliveries,
          ])
        );
      }
      lines.push('');
    }
  }

  if (sections.failures) {
    if (data.failures.length === 0) {
      lines.push(csvRow(['Análisis de Fallos']));
      lines.push(csvRow(['Sin datos para este período']));
      lines.push('');
    } else {
      lines.push(csvRow(['Análisis de Fallos']));
      lines.push(csvRow(['Razón', 'Cantidad', 'Porcentaje']));
      for (const r of data.failures) {
        lines.push(csvRow([r.reason, r.count, `${r.percentage.toFixed(1)}%`]));
      }
      lines.push('');
    }
  }

  if (sections.secondary) {
    if (!data.secondary) {
      lines.push(csvRow(['Métricas Secundarias']));
      lines.push(csvRow(['Sin datos para este período']));
      lines.push('');
    } else {
      lines.push(csvRow(['Métricas Secundarias']));
      lines.push(csvRow(['Métrica', 'Valor']));
      lines.push(
        csvRow([
          'Capacidad %',
          fmtPct(data.secondary.capacityPct),
        ])
      );
      lines.push(
        csvRow([
          'Pedidos/Hora',
          fmtNum(data.secondary.ordersPerHour),
        ])
      );
      lines.push('');
    }
  }

  return lines.join('\n');
}

export function downloadCSV(csv: string, filename: string): void {
  const blob = new Blob(['\ufeff' + csv], {
    type: 'text/csv;charset=utf-8',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename.endsWith('.csv') ? filename : `${filename}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// PDF generation

const GOLD = '#e6c15c';
const SLATE = '#5e6b7b';
const LIGHT_GRAY = '#f8fafc';
const WHITE = '#ffffff';

function drawTableHeader(
  doc: jsPDF,
  headers: string[],
  colWidths: number[],
  x: number,
  y: number
): number {
  doc.setFillColor(SLATE);
  doc.rect(x, y - 5, colWidths.reduce((a, b) => a + b, 0), 7, 'F');
  doc.setFontSize(8);
  doc.setTextColor(WHITE);
  let cx = x;
  for (let i = 0; i < headers.length; i++) {
    doc.text(headers[i], cx + 2, y);
    cx += colWidths[i];
  }
  return y + 7;
}

function drawTableRows(
  doc: jsPDF,
  rows: string[][],
  colWidths: number[],
  x: number,
  startY: number
): number {
  let y = startY;
  const rowH = 6;
  const totalW = colWidths.reduce((a, b) => a + b, 0);

  for (let r = 0; r < rows.length; r++) {
    if (y > 270) {
      doc.addPage();
      y = 20;
    }
    // Alternating row colors
    if (r % 2 === 1) {
      doc.setFillColor(LIGHT_GRAY);
      doc.rect(x, y - 4, totalW, rowH, 'F');
    }

    doc.setFontSize(8);
    doc.setTextColor(SLATE);
    let cx = x;
    for (let i = 0; i < rows[r].length; i++) {
      const text = rows[r][i];
      // Truncate long text to fit column
      const maxChars = Math.floor(colWidths[i] / 2.2);
      const display = text.length > maxChars ? text.slice(0, maxChars - 1) + '…' : text;
      doc.text(display, cx + 2, y);
      cx += colWidths[i];
    }
    y += rowH;
  }
  return y;
}

export function generatePDF(
  data: DashboardExportPayload,
  sections: ExportSections,
  dateRange: string,
  filename: string
): void {
  const doc = new jsPDF();
  const pageW = doc.internal.pageSize.getWidth();
  let y = 20;

  // Header
  doc.setFontSize(18);
  doc.setTextColor(SLATE);
  doc.text('Aureon Performance Dashboard', pageW / 2, y, { align: 'center' });
  y += 8;

  doc.setFontSize(10);
  doc.setTextColor(GOLD);
  doc.text(dateRange, pageW / 2, y, { align: 'center' });
  y += 5;

  doc.setFontSize(8);
  doc.setTextColor(SLATE);
  doc.text(
    `Generado: ${formatDateTime(new Date())}`,
    pageW / 2,
    y,
    { align: 'center' }
  );
  y += 10;

  // Draw gold line
  doc.setDrawColor(GOLD);
  doc.setLineWidth(0.5);
  doc.line(20, y, pageW - 20, y);
  y += 8;

  const x = 15;
  const contentW = pageW - 30;

  // SLA Section
  if (sections.sla) {
    if (y > 250) { doc.addPage(); y = 20; }
    doc.setFontSize(12);
    doc.setTextColor(SLATE);
    doc.text('Resumen SLA', x, y);
    y += 6;

    const cols = [contentW * 0.4, contentW * 0.3, contentW * 0.3];
    y = drawTableHeader(doc, ['Métrica', 'Valor', 'Período anterior'], cols, x, y);
    y = drawTableRows(
      doc,
      [
        ['SLA %', fmtPct(data.sla.value), fmtPct(data.sla.prevValue)],
        ['Total Pedidos', String(data.sla.totalOrders), ''],
        ['Pedidos Entregados', String(data.sla.deliveredOrders), ''],
      ],
      cols,
      x,
      y
    );
    y += 6;
  }

  // Primary Metrics
  if (sections.primary) {
    if (y > 250) { doc.addPage(); y = 20; }
    doc.setFontSize(12);
    doc.setTextColor(SLATE);
    doc.text('Métricas Primarias', x, y);
    y += 6;

    const cols = [contentW * 0.4, contentW * 0.3, contentW * 0.3];
    y = drawTableHeader(doc, ['Métrica', 'Valor', 'Período anterior'], cols, x, y);
    y = drawTableRows(
      doc,
      [
        ['FADR %', fmtPct(data.primary.fadrValue), fmtPct(data.primary.fadrPrev)],
        ['Reclamos (cantidad)', String(data.primary.claimsCount), String(data.primary.claimsPrevCount)],
        ['Reclamos (CLP)', String(data.primary.claimsAmount), String(data.primary.claimsPrevAmount)],
        [
          'Tiempo medio entrega (min)',
          fmtNum(data.primary.avgDeliveryTime),
          fmtNum(data.primary.prevAvgDeliveryTime),
        ],
      ],
      cols,
      x,
      y
    );
    y += 6;
  }

  // Customers
  if (sections.customers) {
    if (y > 250) { doc.addPage(); y = 20; }
    doc.setFontSize(12);
    doc.setTextColor(SLATE);
    doc.text('Tabla de Clientes', x, y);
    y += 6;

    if (data.customers.length === 0) {
      doc.setFontSize(9);
      doc.setTextColor(SLATE);
      doc.text('Sin datos para este período', x, y);
      y += 8;
    } else {
      const cols = [contentW * 0.25, contentW * 0.15, contentW * 0.15, contentW * 0.15, contentW * 0.15, contentW * 0.15];
      y = drawTableHeader(
        doc,
        ['Cliente', 'Pedidos', 'Entregados', 'SLA %', 'FADR %', 'Fallos'],
        cols,
        x,
        y
      );
      const rows = data.customers.map(r => [
        r.retailer_name,
        String(r.total_orders),
        String(r.delivered_orders),
        fmtPct(r.sla_pct),
        fmtPct(r.fadr_pct),
        String(r.failed_deliveries),
      ]);
      y = drawTableRows(doc, rows, cols, x, y);
      y += 6;
    }
  }

  // Failure Reasons
  if (sections.failures) {
    if (y > 250) { doc.addPage(); y = 20; }
    doc.setFontSize(12);
    doc.setTextColor(SLATE);
    doc.text('Análisis de Fallos', x, y);
    y += 6;

    if (data.failures.length === 0) {
      doc.setFontSize(9);
      doc.setTextColor(SLATE);
      doc.text('Sin datos para este período', x, y);
      y += 8;
    } else {
      const cols = [contentW * 0.5, contentW * 0.25, contentW * 0.25];
      y = drawTableHeader(doc, ['Razón', 'Cantidad', 'Porcentaje'], cols, x, y);
      const rows = data.failures.map(r => [
        r.reason,
        String(r.count),
        `${r.percentage.toFixed(1)}%`,
      ]);
      y = drawTableRows(doc, rows, cols, x, y);
      y += 6;
    }
  }

  // Secondary Metrics
  if (sections.secondary) {
    if (y > 250) { doc.addPage(); y = 20; }
    doc.setFontSize(12);
    doc.setTextColor(SLATE);
    doc.text('Métricas Secundarias', x, y);
    y += 6;

    if (!data.secondary) {
      doc.setFontSize(9);
      doc.setTextColor(SLATE);
      doc.text('Sin datos para este período', x, y);
      y += 8;
    } else {
      const cols = [contentW * 0.5, contentW * 0.5];
      y = drawTableHeader(doc, ['Métrica', 'Valor'], cols, x, y);
      y = drawTableRows(
        doc,
        [
          ['Capacidad %', fmtPct(data.secondary.capacityPct)],
          ['Pedidos/Hora', fmtNum(data.secondary.ordersPerHour)],
        ],
        cols,
        x,
        y
      );
    }
  }

  // Footer on each page
  const totalPages = doc.getNumberOfPages();
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setTextColor(SLATE);
    doc.text('Generado por Aureon Last Mile', 20, 285);
    doc.text(`Página ${i} de ${totalPages}`, pageW - 20, 285, { align: 'right' });
  }

  doc.save(filename.endsWith('.pdf') ? filename : `${filename}.pdf`);
}
