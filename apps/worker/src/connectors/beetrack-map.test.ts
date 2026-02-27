import { describe, it, expect } from 'vitest';

// Test the mapping logic from the n8n Map & Validate Code node.
// IMPORTANT: This is a TypeScript re-implementation of the JS in beetrack-excel-import.json
// "Map & Validate" Code node. If you change the n8n workflow mapping logic, update this
// test file to match. The duplication is unavoidable since n8n Code nodes run in a sandbox.

interface BeetrackRow {
  'Identificador ruta'?: string;
  Orden?: string;
  'Fecha estimada'?: string;
  Estado?: string;
  'Id cliente'?: string;
  'Nombre cliente'?: string;
  'Dirección cliente'?: string;
  'Teléfono cliente'?: string;
  'Correo electrónico cliente'?: string;
  'Latitud dirección'?: string;
  'Longitud dirección'?: string;
  Desc_Comuna?: string;
  isPrime?: string;
  URLGUIA?: string;
  URLCARGA?: string;
  'Código del producto'?: string;
  'Nombre del producto'?: string;
  CARTONID?: string;
  [key: string]: unknown;
}

function cleanPhone(phone: string | null | undefined): string | null {
  if (!phone) return null;
  let c = String(phone).replace(/[\s\-\.\(\)]/g, '');
  if (/^9\d{8}$/.test(c)) c = '+56' + c;
  else if (/^569\d{8}$/.test(c)) c = '+' + c;
  else if (/^56\d{9}$/.test(c)) c = '+' + c;
  return c || null;
}

function parseDate(dateStr: string | null | undefined): string | null {
  if (!dateStr) return null;
  const m = String(dateStr).match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
}

function mapBeetrackRows(rows: BeetrackRow[]) {
  const OPERATOR_ID = '92dc5797-047d-458d-bbdb-63f18c0dd1e7';
  const ordersMap = new Map<string, Record<string, unknown>>();
  const packages: Record<string, unknown>[] = [];
  const errors: { row: number; reason: string }[] = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const orden = row.Orden?.toString().trim() || null;
    if (!orden) {
      errors.push({ row: i + 1, reason: 'Missing Orden' });
      continue;
    }
    if (!ordersMap.has(orden)) {
      ordersMap.set(orden, {
        operator_id: OPERATOR_ID,
        order_number: orden,
        external_load_id: row['Identificador ruta'] || null,
        delivery_date: parseDate(row['Fecha estimada'] as string),
        status_detail: row.Estado || null,
        customer_name: row['Nombre cliente'] || null,
        delivery_address: row['Dirección cliente'] || null,
        customer_phone: cleanPhone(row['Teléfono cliente'] as string),
        comuna: row.Desc_Comuna || null,
        retailer_name: 'Paris',
        imported_via: 'EMAIL',
        metadata: {
          customer_email: row['Correo electrónico cliente'] || null,
          latitude: row['Latitud dirección'] || null,
          longitude: row['Longitud dirección'] || null,
          is_prime: row.isPrime || null,
          rut: row['Id cliente'] || null,
        },
        raw_data: row,
      });
    }
    const cartonId = row.CARTONID?.toString().trim() || null;
    if (cartonId) {
      packages.push({
        operator_id: OPERATOR_ID,
        order_number: orden,
        label: cartonId,
        sku_items: [{
          sku: row['Código del producto'] || '',
          description: row['Nombre del producto'] || '',
        }],
      });
    }
  }

  return {
    orders: Array.from(ordersMap.values()),
    packages,
    errors,
  };
}

// Sample rows modeled after actual Beetrack export (21 rows, 65 cols — only mapped cols shown)
const sampleRows: BeetrackRow[] = [
  {
    'Identificador ruta': '45017521',
    Orden: '67810988',
    'Fecha estimada': '2026-02-25 23:37:59',
    Estado: 'Ruta troncal',
    'Id cliente': '15.371.858-K',
    'Nombre cliente': 'Juan Pérez',
    'Dirección cliente': 'Av. Providencia 1234, Providencia',
    'Teléfono cliente': '912345678',
    'Correo electrónico cliente': 'juan@example.com',
    'Latitud dirección': '-33.4300',
    'Longitud dirección': '-70.6150',
    Desc_Comuna: 'PROVIDENCIA',
    isPrime: 'Vip',
    URLGUIA: 'https://example.com/guia1.pdf',
    URLCARGA: 'https://example.com/carga1.pdf',
    'Código del producto': 'SKU001',
    'Nombre del producto': 'Mesa de Centro',
    CARTONID: 'DD033408164',
    'AGRUPACIONES DE TRANSPORTES': 'Musan Ltda',
  },
  {
    'Identificador ruta': '45017521',
    Orden: '67810988',
    'Fecha estimada': '2026-02-25 23:37:59',
    Estado: 'Ruta troncal',
    'Id cliente': '15.371.858-K',
    'Nombre cliente': 'Juan Pérez',
    'Dirección cliente': 'Av. Providencia 1234, Providencia',
    'Teléfono cliente': '912345678',
    Desc_Comuna: 'PROVIDENCIA',
    'Código del producto': 'SKU002',
    'Nombre del producto': 'Silla Comedor',
    CARTONID: 'DD033408165',
  },
  {
    'Identificador ruta': '45017522',
    Orden: '67810990',
    'Fecha estimada': '2026-02-25 10:00:00',
    Estado: 'Entregado',
    'Id cliente': '12.345.678-9',
    'Nombre cliente': 'María López',
    'Dirección cliente': 'Los Leones 567, Ñuñoa',
    'Teléfono cliente': '+56987654321',
    Desc_Comuna: 'NUNOA',
    'Código del producto': 'SKU003',
    'Nombre del producto': 'Refrigerador',
    CARTONID: 'DD033408170',
  },
  {
    'Identificador ruta': '45017523',
    Orden: '',
    Estado: 'Unknown',
    CARTONID: 'DD033408999',
  },
];

describe('Beetrack Map & Validate logic', () => {
  it('groups multiple rows by Orden into single order with multiple packages', () => {
    const { orders, packages, errors } = mapBeetrackRows(sampleRows);

    // 4 rows: 2 for order 67810988, 1 for 67810990, 1 with empty Orden
    expect(orders).toHaveLength(2);
    expect(packages).toHaveLength(3);
    expect(errors).toHaveLength(1);

    const order1 = orders.find((o) => o.order_number === '67810988');
    expect(order1).toBeDefined();
    expect(order1!.external_load_id).toBe('45017521');
    expect(order1!.retailer_name).toBe('Paris');
    expect(order1!.delivery_date).toBe('2026-02-25');

    const order1Packages = packages.filter((p) => p.order_number === '67810988');
    expect(order1Packages).toHaveLength(2);
    expect(order1Packages[0].label).toBe('DD033408164');
    expect(order1Packages[1].label).toBe('DD033408165');
  });

  it('normalizes Chilean phone numbers', () => {
    expect(cleanPhone('912345678')).toBe('+56912345678');
    expect(cleanPhone('+56987654321')).toBe('+56987654321');
    expect(cleanPhone('56912345678')).toBe('+56912345678');
    expect(cleanPhone('9 1234 5678')).toBe('+56912345678');
    expect(cleanPhone(null)).toBeNull();
    expect(cleanPhone('')).toBeNull();
  });

  it('parses Beetrack date format (YYYY-MM-DD HH:MM:SS)', () => {
    expect(parseDate('2026-02-25 23:37:59')).toBe('2026-02-25');
    expect(parseDate('2026-02-25')).toBe('2026-02-25');
    expect(parseDate(null)).toBeNull();
    expect(parseDate('')).toBeNull();
  });

  it('maps metadata fields correctly (email, lat/lng, is_prime, rut)', () => {
    const { orders } = mapBeetrackRows(sampleRows);
    const order1 = orders.find((o) => o.order_number === '67810988');
    const meta = order1!.metadata as Record<string, unknown>;

    expect(meta.customer_email).toBe('juan@example.com');
    expect(meta.latitude).toBe('-33.4300');
    expect(meta.longitude).toBe('-70.6150');
    expect(meta.is_prime).toBe('Vip');
    expect(meta.rut).toBe('15.371.858-K');
  });

  it('maps CARTONID to packages.label and product info to sku_items', () => {
    const { packages } = mapBeetrackRows(sampleRows);
    const pkg = packages.find((p) => p.label === 'DD033408164') as Record<string, unknown>;

    expect(pkg).toBeDefined();
    const skuItems = pkg.sku_items as { sku: string; description: string }[];
    expect(skuItems[0].sku).toBe('SKU001');
    expect(skuItems[0].description).toBe('Mesa de Centro');
  });

  it('skips rows with empty Orden and records error', () => {
    const { errors } = mapBeetrackRows(sampleRows);
    expect(errors).toHaveLength(1);
    expect(errors[0].reason).toBe('Missing Orden');
  });

  it('preserves raw_data for audit trail', () => {
    const { orders } = mapBeetrackRows(sampleRows);
    const order1 = orders.find((o) => o.order_number === '67810988');
    expect(order1!.raw_data).toBeDefined();
    expect((order1!.raw_data as BeetrackRow)['AGRUPACIONES DE TRANSPORTES']).toBe('Musan Ltda');
  });
});
