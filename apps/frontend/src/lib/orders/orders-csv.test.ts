import { describe, expect, it } from 'vitest';
import type { OrdersListRow } from '@/hooks/useOrdersList';
import { ordersToCsv } from './orders-csv';

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
    const csv = ordersToCsv([baseRow()]);
    const lines = csv.slice(BOM.length).split('\r\n');
    expect(lines[1]).toBe('ORD-1,Juan Pérez,en_ruta,2,RUTA-01,María López,ok,En camino');
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
    const csv = ordersToCsv([
      baseRow({ route_label: null, driver_name: null, last_event_label: null }),
    ]);
    const dataLine = csv.slice(BOM.length).split('\r\n')[1];
    expect(dataLine).toBe('ORD-1,Juan Pérez,en_ruta,2,,,ok,');
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
