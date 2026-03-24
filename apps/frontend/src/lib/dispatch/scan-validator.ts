import { createSPAClient } from '@/lib/supabase/client';
import type { ScanResult, RoutePackage } from './types';

interface ScanInput {
  code: string;
  routeId: string;
  operatorId: string;
}

export async function validateScan(input: ScanInput): Promise<ScanResult> {
  const { code, operatorId } = input;
  const supabase = createSPAClient();

  // 1. Lookup by package barcode first
  const { data: pkgs } = await supabase
    .from('packages')
    .select('id, status, order_id, orders(order_number, contact_name, contact_address, contact_phone)')
    .eq('operator_id', operatorId)
    .eq('barcode', code)
    .is('deleted_at', null)
    .limit(1);

  let found = pkgs?.[0] ?? null;

  // 2. Fallback: lookup by order number
  if (!found) {
    const { data: orders } = await supabase
      .from('packages')
      .select('id, status, order_id, orders!inner(order_number, contact_name, contact_address, contact_phone)')
      .eq('operator_id', operatorId)
      .eq('orders.order_number', code)
      .is('deleted_at', null)
      .limit(1);

    found = orders?.[0] ?? null;
  }

  if (!found) {
    return { ok: false, message: 'Código no encontrado', code: 'NOT_FOUND' };
  }

  // 3. Validate status
  if (found.status !== 'asignado') {
    return {
      ok: false,
      message: `Paquete en estado incorrecto (estado: ${found.status})`,
      code: 'WRONG_STATUS',
    };
  }

  // 4. Check not already dispatched in another active route
  const { data: existing } = await supabase
    .from('dispatches')
    .select('id, route_id')
    .eq('operator_id', operatorId)
    .eq('order_id', found.order_id)
    .is('deleted_at', null)
    .limit(1);

  if (existing && existing.length > 0) {
    return {
      ok: false,
      message: 'Paquete ya asignado a otra ruta activa',
      code: 'ALREADY_IN_ROUTE',
    };
  }

  const order = Array.isArray(found.orders) ? found.orders[0] : found.orders;

  const pkg: RoutePackage = {
    dispatch_id: '',              // filled after insert
    order_id: found.order_id,
    order_number: order?.order_number ?? code,
    contact_name: order?.contact_name ?? null,
    contact_address: order?.contact_address ?? null,
    contact_phone: order?.contact_phone ?? null,
    package_status: 'en_carga',
  };

  return { ok: true, package: pkg };
}
