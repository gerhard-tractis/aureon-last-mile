import { describe, expect, it } from 'vitest';
import type { OrdersListRow } from '@/hooks/useOrdersList';
import { ordersToCsv } from './orders-csv';
import { getStatusLabel } from '@/components/StatusBadge';
import { formatSlaCell, formatLastEvent } from './orders-list-format';

const BOM = '﻿';

function baseRow(overrides: Partial<OrdersListRow> = {}): OrdersListRow {
  return {
    id: 'id-1',
    order_number: 'ORD-1',
    customer_name: 'Juan Pérez',
    leading_status: 'en_ruta',
    comuna: 'Ñuñoa',
    package_count: 2,
    route_label: 'RUTA-01',
    driver_name: 'María López',
    sla_status: 'ok',
    minutes_remaining: 120,
    last_event_at: '2026-08-22T10:00:00Z',
    last_event_label: 'En camino',
    has_pod: false,
    total_count: 1,
    ...overrides,
  };
}

describe('ordersToCsv', () => {
  it('emits a UTF-8 BOM as the first character', () => {
    const csv = ordersToCsv([baseRow()]);
    expect(csv.charAt(0)).toBe(BOM);
  });

  it('emits the exact Spanish header row, in table column order', () => {
    const csv = ordersToCsv([]);
    const firstLine = csv.slice(BOM.length).split('\r\n')[0];
    expect(firstLine).toBe('PEDIDO,CLIENTE,ESTADO,PQT,RUTA,CONDUCTOR,SLA,ÚLTIMO EVENTO');
  });

  it('serializes a plain row with fields in the right order', () => {
    const row = baseRow();
    const csv = ordersToCsv([row]);
    const lines = csv.slice(BOM.length).split('\r\n');
    expect(lines[1]).toBe(
      `ORD-1,Juan Pérez,${getStatusLabel(row.leading_status, 'order')},2,RUTA-01,María López,${formatSlaCell(row.sla_status, row.minutes_remaining)},${formatLastEvent(row)}`,
    );
  });

  it('formats ESTADO, SLA and ÚLTIMO EVENTO with the same formatters the table uses — never the raw enum values', () => {
    const row = baseRow();
    const csv = ordersToCsv([row]);
    const dataLine = csv.slice(BOM.length).split('\r\n')[1];

    expect(dataLine).toContain(getStatusLabel(row.leading_status, 'order'));
    expect(dataLine).toContain(formatSlaCell(row.sla_status, row.minutes_remaining));
    expect(dataLine).toContain(formatLastEvent(row));

    // The raw enum values themselves must not leak into the file.
    expect(dataLine).not.toContain(',en_ruta,');
    expect(dataLine).not.toContain(',ok,');
  });

  it('formats a late SLA with the signed hour/minute the table shows, not the raw "late" enum', () => {
    const csv = ordersToCsv([baseRow({ sla_status: 'late', minutes_remaining: -65 })]);
    const dataLine = csv.slice(BOM.length).split('\r\n')[1];
    expect(dataLine).toContain('−1h 05m');
    expect(dataLine).not.toContain(',late,');
  });

  it('preserves non-ASCII characters intact', () => {
    const csv = ordersToCsv([baseRow({ route_label: 'Peñalolén', customer_name: 'Ñoño' })]);
    expect(csv).toContain('Peñalolén');
    expect(csv).toContain('Ñoño');
  });

  it('quotes and escapes a value containing a comma', () => {
    const csv = ordersToCsv([baseRow({ customer_name: 'Pérez, Juan' })]);
    const dataLine = csv.slice(BOM.length).split('\r\n')[1];
    expect(dataLine).toContain('"Pérez, Juan"');
  });

  it('doubles embedded double quotes per RFC 4180', () => {
    const csv = ordersToCsv([baseRow({ customer_name: 'The "Boss"' })]);
    const dataLine = csv.slice(BOM.length).split('\r\n')[1];
    expect(dataLine).toContain('"The ""Boss"""');
  });

  it('quotes a value containing a newline and keeps the newline inside the field', () => {
    const csv = ordersToCsv([baseRow({ customer_name: 'Line1\nLine2' })]);
    expect(csv).toContain('"Line1\nLine2"');
  });

  it('quotes a value containing a lone carriage return', () => {
    const csv = ordersToCsv([baseRow({ customer_name: 'Line1\rLine2' })]);
    expect(csv).toContain('"Line1\rLine2"');
  });

  it('renders null fields as empty strings, not the text "null"', () => {
    const row = baseRow({
      route_label: null,
      driver_name: null,
      last_event_label: null,
      last_event_at: null,
    });
    const csv = ordersToCsv([row]);
    const dataLine = csv.slice(BOM.length).split('\r\n')[1];
    expect(dataLine).toBe(
      `ORD-1,Juan Pérez,${getStatusLabel(row.leading_status, 'order')},2,,,${formatSlaCell(row.sla_status, row.minutes_remaining)},${formatLastEvent(row)}`,
    );
    expect(dataLine).not.toContain('null');
  });

  it('serializes multiple rows in input order', () => {
    const csv = ordersToCsv([
      baseRow({ order_number: 'ORD-1' }),
      baseRow({ order_number: 'ORD-2' }),
    ]);
    const lines = csv.slice(BOM.length).split('\r\n');
    expect(lines[1]).toMatch(/^ORD-1,/);
    expect(lines[2]).toMatch(/^ORD-2,/);
  });

  it('emits only the header for an empty row list', () => {
    const csv = ordersToCsv([]);
    const lines = csv.slice(BOM.length).split('\r\n');
    expect(lines).toEqual(['PEDIDO,CLIENTE,ESTADO,PQT,RUTA,CONDUCTOR,SLA,ÚLTIMO EVENTO']);
  });
});
