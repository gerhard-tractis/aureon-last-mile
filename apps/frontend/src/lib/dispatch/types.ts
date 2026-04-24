// apps/frontend/src/lib/dispatch/types.ts

export type RouteStatus = 'draft' | 'planned' | 'in_progress' | 'completed' | 'cancelled';
export type PackageStatus =
  | 'ingresado' | 'verificado' | 'en_bodega' | 'asignado'
  | 'en_carga' | 'listo_para_despacho' | 'en_ruta' | 'entregado' | 'cancelado';

export interface DispatchRoute {
  id: string;
  operator_id: string;
  external_route_id: string | null;
  route_date: string;           // ISO date YYYY-MM-DD
  driver_name: string | null;
  vehicle_id: string | null;
  truck_identifier: string | null;
  status: RouteStatus;
  planned_stops: number;
  completed_stops: number;
  created_at: string;
}

export interface RoutePackage {
  dispatch_id: string;          // dispatches.id
  order_id: string;
  order_number: string;
  contact_name: string | null;
  contact_address: string | null;
  contact_phone: string | null;
  package_status: PackageStatus;
}

export interface FleetVehicle {
  id: string;
  external_vehicle_id: string;
  plate_number: string | null;
  driver_name: string | null;
  vehicle_type: string | null;
}

export type ScanResult = {
  ok: true;
  package: RoutePackage;
} | {
  ok: false;
  message: string;
  code: 'NOT_FOUND' | 'WRONG_STATUS' | 'ALREADY_IN_ROUTE';
}

// dispatches.status comes from dispatch_status_enum (DB-level). Keep these values verbatim.
export type DispatchStatus = 'pending' | 'delivered' | 'failed' | 'partial';

export interface RouteDispatchSummary {
  dispatch_id: string;
  order_id: string;
  order_number: string;
  contact_name: string | null;
  contact_address: string | null;
  contact_phone: string | null;
  status: DispatchStatus;
}
