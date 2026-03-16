// Package status (active pipeline + terminal)
export type PackageStatus =
  | 'ingresado' | 'verificado' | 'en_bodega' | 'asignado'
  | 'en_carga' | 'listo' | 'en_ruta' | 'entregado'
  | 'cancelado' | 'devuelto' | 'dañado' | 'extraviado';

export const TERMINAL_PACKAGE_STATUSES: PackageStatus[] = [
  'cancelado', 'devuelto', 'dañado', 'extraviado',
];

// Order status (active pipeline + cancelado)
export type OrderStatus =
  | 'ingresado' | 'verificado' | 'en_bodega' | 'asignado'
  | 'en_carga' | 'listo' | 'en_ruta' | 'entregado'
  | 'cancelado';

export type OrderPriority = 'urgent' | 'alert' | 'ok' | 'late';

// Pipeline stage display config
export const PIPELINE_STAGES: {
  status: OrderStatus;
  label: string;
  icon: string;
  position: number;
}[] = [
  { status: 'ingresado', label: 'Ingresado', icon: 'PackagePlus', position: 1 },
  { status: 'verificado', label: 'Verificado', icon: 'ScanSearch', position: 2 },
  { status: 'en_bodega', label: 'En Bodega', icon: 'Warehouse', position: 3 },
  { status: 'asignado', label: 'Asignado', icon: 'UserCheck', position: 4 },
  { status: 'en_carga', label: 'En Carga', icon: 'Truck', position: 5 },
  { status: 'listo', label: 'Listo', icon: 'CheckCircle', position: 6 },
  { status: 'en_ruta', label: 'En Ruta', icon: 'Navigation', position: 7 },
  { status: 'entregado', label: 'Entregado', icon: 'PackageCheck', position: 8 },
];

// Priority display config
export const PRIORITY_CONFIG: Record<OrderPriority, {
  label: string;
  color: string;
  dotColor: string;
}> = {
  urgent: { label: 'Urgente', color: 'red', dotColor: 'bg-red-500' },
  alert: { label: 'Alerta', color: 'yellow', dotColor: 'bg-yellow-500' },
  ok: { label: 'OK', color: 'green', dotColor: 'bg-green-500' },
  late: { label: 'Atrasado', color: 'gray', dotColor: 'bg-gray-500' },
};
