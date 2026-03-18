// Shared status and role constants — single source of truth
// These must match the DB enum values exactly.

export const ORDER_STATUSES = [
  'ingresado',
  'verificado',
  'en_bodega',
  'despachado',
  'en_ruta',
  'entregado',
  'no_entregado',
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const USER_ROLES = [
  'admin',
  'operations_manager',
  'warehouse_operator',
  'driver',
] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const CONNECTOR_TYPES = ['csv_email', 'browser', 'api'] as const;
export type ConnectorType = (typeof CONNECTOR_TYPES)[number];
