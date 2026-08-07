import { describe, it, expect } from 'vitest';

// Test the mapping logic from the n8n "Map & Validate" Code node in easy-wms-webhook.json.
// IMPORTANT: This is a TypeScript re-implementation of the JS in easy-wms-webhook.json
// "Map & Validate" Code node. If you change the n8n workflow mapping logic, update this
// test file to match (and vice versa). The duplication is unavoidable since n8n Code nodes
// run in a sandbox and cannot import from the worker package. See spec-49 Design §2.

interface EasyItem {
  descripcion?: string;
  sku?: string;
  mt3?: string;
  cantidad?: string;
  codigo_barra?: string;
  carton?: string;
  bultos?: string;
}

interface EasyDespacho {
  entrega?: string;
  suborden?: string;
  numero_guia?: string;
  id_carga?: string;
  cd_origen?: string;
  tipo_guia?: string;
  fecha_guia?: string;
  fecha_carga?: string;
  fecha_compromiso?: string;
  direccion?: string;
  comuna?: string;
  cliente_rut?: string;
  cliente_nombre?: string;
  cliente_telefono?: string;
  cliente_correo?: string;
  latitud?: string;
  longitud?: string;
  url_guia?: string;
  items?: EasyItem[];
}

interface EasyWmsPayload {
  evento?: string;
  despachos?: EasyDespacho[];
}

const OPERATOR_ID = '92dc5797-047d-458d-bbdb-63f18c0dd1e7'; // Musan
const TENANT_CLIENT_ID = 'acf3d096-1ff6-4157-9b69-cab6e6a5789f'; // Easy (Cencosud)
const RETAILER_NAME = 'Easy';
const IMPORTED_VIA = 'API';

// Resolves the raw request body into a JSON payload.
// Resolution order (see spec-49 Design §2):
//   1. rawBody string available -> JSON.parse(rawBody). Only lossless path.
//   2. else parsedBody is an object with a despachos array -> use as-is.
//   3. else parsedBody is a non-empty object whose FIRST key starts with '{' (n8n's
//      mangled application/x-www-form-urlencoded parse of a JSON body) -> reconstruct
//      the original string by re-joining all entries and JSON.parse it.
//   4. else -> throw.
function parseEasyWmsBody(
  rawBody: string | undefined,
  parsedBody: unknown
): { payload: EasyWmsPayload; reconstructed: boolean } {
  if (rawBody) {
    return { payload: JSON.parse(rawBody), reconstructed: false };
  }

  if (parsedBody && typeof parsedBody === 'object' && !Array.isArray(parsedBody)) {
    const obj = parsedBody as Record<string, unknown>;
    if (Array.isArray(obj.despachos)) {
      return { payload: obj as EasyWmsPayload, reconstructed: false };
    }

    const keys = Object.keys(obj);
    if (keys.length > 0 && keys[0].startsWith('{')) {
      const reconstructed = Object.entries(obj)
        .map(([k, v]) => (v === '' ? k : k + '=' + v))
        .join('&');
      return { payload: JSON.parse(reconstructed), reconstructed: true };
    }
  }

  throw new Error(
    'Unable to parse Easy WMS payload: no raw body, no despachos array, and body is not the mangled form-parse shape'
  );
}

function cleanPhone(phone: string | undefined): string {
  if (!phone) return '';
  let cleaned = phone.replace(/[\s\-.()]/g, '');
  if (/^9\d{8}$/.test(cleaned)) cleaned = '+56' + cleaned;
  if (/^569\d{8}$/.test(cleaned)) cleaned = '+' + cleaned;
  return cleaned;
}

function parseDeliveryDate(despacho: EasyDespacho): string {
  const fc = (despacho.fecha_compromiso || '').trim();
  if (fc && /^\d{4}-\d{2}-\d{2}$/.test(fc)) return fc;
  const fca = (despacho.fecha_carga || '').trim();
  if (fca && /^\d{4}-\d{2}-\d{2}$/.test(fca)) return fca;
  throw new Error(
    'Missing valid delivery date for entrega ' + despacho.entrega + '. fecha_compromiso=' + fc + ', fecha_carga=' + fca
  );
}

// Replicates the Map & Validate Code node's mapping of despachos[] -> orders[] / packages[],
// plus the new dispatch_guide_url field (spec-49). ctx.now stands in for the Code node's
// `new Date().toISOString()` so tests are deterministic.
function mapDespachos(payload: EasyWmsPayload, ctx: { now?: string }): Record<string, unknown> {
  const evento = payload.evento || '';
  const despachos = payload.despachos || [];
  const now = ctx.now || new Date().toISOString();

  if (despachos.length === 0) {
    return {
      orders: [],
      packages: [],
      despachos_count: 0,
      orders_count: 0,
      packages_count: 0,
      warnings: ['Empty despachos array'],
      evento,
      operator_id: OPERATOR_ID,
      tenant_client_id: TENANT_CLIENT_ID,
    };
  }

  const ordersMap = new Map<string, Record<string, unknown>>();
  const packages: Record<string, unknown>[] = [];
  const warnings: string[] = [];

  for (const despacho of despachos) {
    const entrega = (despacho.entrega || '').trim();
    if (!entrega) {
      warnings.push('Skipped despacho with missing entrega: ' + JSON.stringify(despacho).substring(0, 100));
      continue;
    }

    let deliveryDate: string;
    try {
      deliveryDate = parseDeliveryDate(despacho);
    } catch (e) {
      warnings.push((e as Error).message);
      continue;
    }

    const customerPhone = cleanPhone(despacho.cliente_telefono);

    if (!despacho.url_guia) {
      warnings.push('Despacho ' + entrega + ' has no url_guia — dispatch_guide_url will be null');
    }

    if (!ordersMap.has(entrega)) {
      ordersMap.set(entrega, {
        operator_id: OPERATOR_ID,
        order_number: entrega,
        external_load_id: despacho.id_carga || null,
        delivery_date: deliveryDate,
        delivery_address: despacho.direccion || '',
        comuna: despacho.comuna || '',
        customer_name: despacho.cliente_nombre || '',
        customer_phone: customerPhone,
        retailer_name: RETAILER_NAME,
        imported_via: IMPORTED_VIA,
        tenant_client_id: TENANT_CLIENT_ID,
        imported_at: now,
        dispatch_guide_url: despacho.url_guia || null,
        raw_data: despacho,
      });
    } else {
      const firstDespacho = (ordersMap.get(entrega)!.raw_data) as EasyDespacho;
      if (despacho.url_guia !== firstDespacho.url_guia) {
        warnings.push(
          'Duplicate entrega ' + entrega + ' has a different url_guia; keeping first: ' + (firstDespacho.url_guia || '(none)')
        );
      }
    }

    const items = despacho.items || [];
    if (items.length === 0) {
      warnings.push('Despacho ' + entrega + ' has no items — order will be upserted but no packages');
    }

    for (const item of items) {
      const carton = (item.carton || '').trim();
      if (!carton) {
        warnings.push('Skipped item with missing carton in despacho ' + entrega);
        continue;
      }
      const bultos = Math.round(parseFloat(item.bultos || '') || 1) || 1;
      packages.push({
        operator_id: OPERATOR_ID,
        order_number: entrega,
        label: carton,
        declared_box_count: bultos,
        sku_items: [
          {
            sku: item.sku || '',
            description: item.descripcion || '',
            quantity: parseInt(item.cantidad || '', 10) || 1,
            codigo_barra: item.codigo_barra || '',
            mt3: item.mt3 || '',
          },
        ],
        raw_data: item,
      });
    }
  }

  const orders = Array.from(ordersMap.values());

  if (orders.length === 0) {
    throw new Error('No valid orders extracted from ' + despachos.length + ' despachos. Warnings: ' + warnings.join('; '));
  }

  return {
    orders,
    packages,
    despachos_count: despachos.length,
    orders_count: orders.length,
    packages_count: packages.length,
    warnings,
    evento,
    operator_id: OPERATOR_ID,
    tenant_client_id: TENANT_CLIENT_ID,
  };
}

// ---------------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------------

// Splits a JSON string the same way n8n's application/x-www-form-urlencoded body
// parser would when Easy posts JSON with the wrong Content-Type: split on '&', then
// split each segment on the first '='. This is the exact inverse of the reconstruction
// logic in parseEasyWmsBody's path 3, used here to build realistic "mangled" fixtures.
function mangleFormBody(jsonString: string): Record<string, string> {
  const obj: Record<string, string> = {};
  for (const segment of jsonString.split('&')) {
    const eqIdx = segment.indexOf('=');
    if (eqIdx === -1) {
      obj[segment] = '';
    } else {
      obj[segment.slice(0, eqIdx)] = segment.slice(eqIdx + 1);
    }
  }
  return obj;
}

function buildDespacho(overrides: Partial<EasyDespacho> = {}): EasyDespacho {
  return {
    entrega: '2917174651',
    suborden: '23392760',
    numero_guia: '27513064',
    id_carga: 'CARGACL30040796',
    cd_origen: 'E599',
    tipo_guia: 'despacho',
    fecha_guia: '2026-04-10',
    fecha_carga: '2026-04-17',
    fecha_compromiso: '2026-04-24',
    direccion: 'Los Aromos 456, depto 12',
    comuna: 'Puente Alto',
    cliente_rut: '11.111.111-1',
    cliente_nombre: 'Pablo Soto',
    cliente_telefono: '989-238194',
    cliente_correo: 'pablo.soto@example.com',
    latitud: '',
    longitud: '',
    url_guia: 'http://cencosud.paperless.cl:80/Facturacion/PDFServlet?docId=AbCdEfGh12/IjKlMn(3)OpQrSt45',
    items: [
      {
        descripcion: 'Silla oficina',
        sku: '1273996',
        mt3: '85.500 ',
        cantidad: '1',
        codigo_barra: '2082004176989',
        carton: 'LPNCL0002524863',
        bultos: '1.00 ',
      },
    ],
    ...overrides,
  };
}

const NOW = '2026-04-17T12:00:00.000Z';

describe('parseEasyWmsBody', () => {
  it('(a) parses a clean JSON body via rawBody — the only lossless path', () => {
    const despacho = buildDespacho();
    const jsonString = JSON.stringify({ evento: 'impresion por numero de carga', despachos: [despacho] });

    const { payload, reconstructed } = parseEasyWmsBody(jsonString, undefined);

    expect(reconstructed).toBe(false);
    expect(payload.despachos).toHaveLength(1);
    expect(payload.despachos![0].url_guia).toBe(despacho.url_guia);
  });

  it('(b) reconstructs the mangled single-key form shape (split lands inside url_guia)', () => {
    const despacho = buildDespacho();
    const jsonString = JSON.stringify({ evento: 'impresion por numero de carga', despachos: [despacho] });
    const mangled = mangleFormBody(jsonString);

    // Sanity check on the fixture itself: n8n's form parser produced exactly one key,
    // and that key is the JSON string up to (and not including) the first '='.
    expect(Object.keys(mangled)).toHaveLength(1);
    expect(Object.keys(mangled)[0].startsWith('{')).toBe(true);

    const { payload, reconstructed } = parseEasyWmsBody(undefined, mangled);

    expect(reconstructed).toBe(true);
    expect(payload.despachos).toHaveLength(1);
    expect(payload.despachos![0].url_guia).toBe(despacho.url_guia);
  });

  it('(c) reconstructs the mangled multi-key shape (literal & inside a JSON string value)', () => {
    const despacho = buildDespacho({ direccion: 'AV. LOS ROBLES & CALLE SUR 123' });
    const jsonString = JSON.stringify({ evento: 'impresion por numero de carga', despachos: [despacho] });
    const mangled = mangleFormBody(jsonString);

    expect(Object.keys(mangled).length).toBeGreaterThan(1);
    expect(Object.keys(mangled)[0].startsWith('{')).toBe(true);

    const { payload, reconstructed } = parseEasyWmsBody(undefined, mangled);

    expect(reconstructed).toBe(true);
    expect(payload.despachos![0].direccion).toBe('AV. LOS ROBLES & CALLE SUR 123');
    expect(payload.despachos![0].url_guia).toBe(despacho.url_guia);
  });

  it('branch 2: parsedBody is already an object with a despachos array → used as-is', () => {
    const despacho = buildDespacho();
    const parsedBody = { evento: 'impresion por numero de carga', despachos: [despacho] };

    const { payload, reconstructed } = parseEasyWmsBody(undefined, parsedBody);

    expect(reconstructed).toBe(false);
    expect(payload).toBe(parsedBody as unknown as EasyWmsPayload);
    expect(payload.despachos![0].url_guia).toBe(despacho.url_guia);
  });

  it('(d) prefers rawBody over parsedBody even when parsedBody is the mangled shape', () => {
    const despacho = buildDespacho();
    const jsonString = JSON.stringify({ evento: 'impresion por numero de carga', despachos: [despacho] });
    const mangled = mangleFormBody(jsonString);

    const { payload, reconstructed } = parseEasyWmsBody(jsonString, mangled);

    expect(reconstructed).toBe(false);
    expect(payload.despachos![0].url_guia).toBe(despacho.url_guia);
  });

  it('throws when neither rawBody nor a usable parsedBody shape is available', () => {
    expect(() => parseEasyWmsBody(undefined, { foo: 'bar' })).toThrow();
    expect(() => parseEasyWmsBody(undefined, undefined)).toThrow();
    expect(() => parseEasyWmsBody(undefined, {})).toThrow();
  });
});

describe('mapDespachos — dispatch_guide_url mapping (spec-49)', () => {
  it('assigns dispatch_guide_url verbatim, byte-identical to the source url_guia (docId has / and (...))', () => {
    const url = 'http://cencosud.paperless.cl:80/Facturacion/PDFServlet?docId=AbCdEfGh12/IjKlMn(3)OpQrSt45UvWxYz';
    const despacho = buildDespacho({ url_guia: url });

    const { orders } = mapDespachos({ despachos: [despacho] }, { now: NOW }) as { orders: Record<string, unknown>[] };

    expect(orders[0].dispatch_guide_url).toBe(url);
  });

  it('end-to-end on the reconstruction path: mangled body → parseEasyWmsBody → mapDespachos → byte-identical URL', () => {
    const despacho = buildDespacho();
    const jsonString = JSON.stringify({ evento: 'impresion por numero de carga', despachos: [despacho] });
    const mangled = mangleFormBody(jsonString);

    const { payload, reconstructed } = parseEasyWmsBody(undefined, mangled);
    expect(reconstructed).toBe(true);

    const { orders } = mapDespachos(payload, { now: NOW }) as { orders: Record<string, unknown>[] };

    expect(orders[0].dispatch_guide_url).toBe(despacho.url_guia);
  });

  it('(e) missing url_guia → order still imported, dispatch_guide_url null, and a warning is appended', () => {
    const despacho = buildDespacho({ url_guia: undefined });

    const result = mapDespachos({ despachos: [despacho] }, { now: NOW }) as {
      orders: Record<string, unknown>[];
      warnings: string[];
    };

    expect(result.orders).toHaveLength(1);
    expect(result.orders[0].dispatch_guide_url).toBeNull();
    expect(result.warnings.some((w) => w.includes('no url_guia'))).toBe(true);
  });

  it('(f) empty-string url_guia is coerced to null', () => {
    const despacho = buildDespacho({ url_guia: '' });

    const { orders } = mapDespachos({ despachos: [despacho] }, { now: NOW }) as { orders: Record<string, unknown>[] };

    expect(orders[0].dispatch_guide_url).toBeNull();
  });

  it('(g) duplicate entrega with a different url_guia: first URL wins and a warning is logged', () => {
    const first = buildDespacho({ url_guia: 'http://cencosud.paperless.cl:80/Facturacion/PDFServlet?docId=FIRST' });
    const second = buildDespacho({ url_guia: 'http://cencosud.paperless.cl:80/Facturacion/PDFServlet?docId=SECOND' });

    const result = mapDespachos({ despachos: [first, second] }, { now: NOW }) as {
      orders: Record<string, unknown>[];
      warnings: string[];
    };

    expect(result.orders).toHaveLength(1);
    expect(result.orders[0].dispatch_guide_url).toBe(first.url_guia);
    expect(result.warnings.some((w) => w.includes('different url_guia'))).toBe(true);
  });

  it('duplicate entrega with the SAME url_guia does not warn about differing URLs', () => {
    const sameUrl = 'http://cencosud.paperless.cl:80/Facturacion/PDFServlet?docId=SAME';
    const first = buildDespacho({ url_guia: sameUrl, suborden: 'A' });
    const second = buildDespacho({ url_guia: sameUrl, suborden: 'B' });

    const result = mapDespachos({ despachos: [first, second] }, { now: NOW }) as {
      orders: Record<string, unknown>[];
      warnings: string[];
    };

    expect(result.orders).toHaveLength(1);
    expect(result.warnings.some((w) => w.includes('different url_guia'))).toBe(false);
  });

  it('(h) empty despachos array → parse succeeds, mapDespachos yields zero orders with a warning', () => {
    const result = mapDespachos({ despachos: [] }, { now: NOW }) as {
      orders: Record<string, unknown>[];
      packages: unknown[];
      warnings: string[];
    };

    expect(result.orders).toHaveLength(0);
    expect(result.packages).toHaveLength(0);
    expect(result.warnings).toContain('Empty despachos array');
  });
});

describe('mapDespachos — existing behaviors preserved', () => {
  it('normalizes Chilean phone numbers (9XXXXXXXX and 569XXXXXXXX forms)', () => {
    expect(cleanPhone('989-238194')).toBe('+56989238194');
    expect(cleanPhone('56989238194')).toBe('+56989238194');
    expect(cleanPhone('912345678')).toBe('+56912345678');
    expect(cleanPhone(undefined)).toBe('');
    expect(cleanPhone('')).toBe('');
  });

  it('parses delivery date preferring fecha_compromiso, falling back to fecha_carga', () => {
    const withCompromiso = buildDespacho({ fecha_compromiso: '2026-04-24', fecha_carga: '2026-04-17' });
    expect(parseDeliveryDate(withCompromiso)).toBe('2026-04-24');

    const withoutCompromiso = buildDespacho({ fecha_compromiso: '', fecha_carga: '2026-04-17' });
    expect(parseDeliveryDate(withoutCompromiso)).toBe('2026-04-17');

    const neither = buildDespacho({ fecha_compromiso: '', fecha_carga: '' });
    expect(() => parseDeliveryDate(neither)).toThrow(/Missing valid delivery date/);
  });

  it('skips a despacho with neither date and records a warning instead of throwing', () => {
    const good = buildDespacho({ entrega: '1' });
    const bad = buildDespacho({ entrega: '2', fecha_compromiso: '', fecha_carga: '' });

    const result = mapDespachos({ despachos: [good, bad] }, { now: NOW }) as {
      orders: Record<string, unknown>[];
      warnings: string[];
    };

    expect(result.orders).toHaveLength(1);
    expect(result.orders[0].order_number).toBe('1');
    expect(result.warnings.some((w) => w.includes('Missing valid delivery date'))).toBe(true);
  });

  it('maps order fields: operator_id, order_number=entrega, external_load_id, tenant_client_id, retailer_name, imported_via, raw_data', () => {
    const despacho = buildDespacho();

    const { orders } = mapDespachos({ despachos: [despacho] }, { now: NOW }) as { orders: Record<string, unknown>[] };
    const order = orders[0];

    expect(order.operator_id).toBe(OPERATOR_ID);
    expect(order.order_number).toBe(despacho.entrega);
    expect(order.external_load_id).toBe(despacho.id_carga);
    expect(order.tenant_client_id).toBe(TENANT_CLIENT_ID);
    expect(order.retailer_name).toBe('Easy');
    expect(order.imported_via).toBe('API');
    expect(order.raw_data).toEqual(despacho);
  });

  it('builds packages from items with declared_box_count rounded from bultos', () => {
    const despacho = buildDespacho({
      items: [
        {
          descripcion: 'Mesa',
          sku: 'SKU1',
          mt3: '1.2',
          cantidad: '3',
          codigo_barra: 'BAR1',
          carton: 'CARTON1',
          bultos: '2.6',
        },
      ],
    });

    const { packages } = mapDespachos({ despachos: [despacho] }, { now: NOW }) as { packages: Record<string, unknown>[] };

    expect(packages).toHaveLength(1);
    expect(packages[0].label).toBe('CARTON1');
    expect(packages[0].declared_box_count).toBe(3); // Math.round(2.6) === 3
    const skuItems = packages[0].sku_items as { sku: string; quantity: number }[];
    expect(skuItems[0].sku).toBe('SKU1');
    expect(skuItems[0].quantity).toBe(3);
  });
});
