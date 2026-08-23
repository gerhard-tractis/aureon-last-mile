// Shared status and role constants.
// These must match the DB enum values exactly — see
// packages/database/supabase/migrations/ for the authoritative definitions.

// order_status_enum: 20260313000001, renamed by 20260324000001
// ('listo' -> 'listo_para_despacho'), extended by 20260512000001
// ('en_retorno', 'parcialmente_entregado').
export const ORDER_STATUSES = [
  'ingresado',
  'verificado',
  'en_bodega',
  'asignado',
  'en_carga',
  'listo_para_despacho',
  'en_ruta',
  'entregado',
  'cancelado',
  'en_retorno',
  'parcialmente_entregado',
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

// user_role: 20260216170542, plus 'super_admin' from 20260616000001 (spec-45)
// and 'pickup_leader' from 20260820000001 (spec-61).
//
// Listed in a readable order, not the enum's physical one: both ADD VALUE
// migrations append, so Postgres sorts pickup_leader last. Nothing here depends
// on the order — packages/database/seed-qa/lib/enums.ts is the copy that is
// compared against the live database, and it compares as a set.
export const USER_ROLES = [
  'pickup_crew',
  'pickup_leader',
  'warehouse_staff',
  'loading_crew',
  'operations_manager',
  'admin',
  'super_admin',
] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const CONNECTOR_TYPES = ['csv_email', 'browser', 'api'] as const;
export type ConnectorType = (typeof CONNECTOR_TYPES)[number];

// ── Agent Suite enums ────────────────────────────────────────────────────────

export const INTAKE_METHODS = [
  'email', 'whatsapp', 'portal', 'api', 'manual', 'mobile_camera',
] as const;
export type IntakeMethod = (typeof INTAKE_METHODS)[number];

export const INTAKE_STATUSES = [
  'received', 'parsing', 'parsed', 'needs_review', 'confirmed', 'failed', 'rejected',
] as const;
export type IntakeStatus = (typeof INTAKE_STATUSES)[number];

export const FLEET_TYPES = ['own', 'external'] as const;
export type FleetType = (typeof FLEET_TYPES)[number];

export const DRIVER_STATUSES = ['active', 'inactive', 'suspended', 'terminated'] as const;
export type DriverStatus = (typeof DRIVER_STATUSES)[number];

export const ASSIGNMENT_STATUSES = [
  'pending', 'offered', 'negotiating', 'rejected', 'expired',
  'accepted', 'pickup_pending', 'picked_up', 'in_transit',
  'delivered', 'partially_done', 'failed', 'settled', 'cancelled',
] as const;
export type AssignmentStatus = (typeof ASSIGNMENT_STATUSES)[number];

export const CONVERSATION_CHANNELS = ['whatsapp', 'sms', 'portal'] as const;
export type ConversationChannel = (typeof CONVERSATION_CHANNELS)[number];

export const PARTICIPANT_TYPES = ['driver', 'client', 'generator'] as const;
export type ParticipantType = (typeof PARTICIPANT_TYPES)[number];

export const MESSAGE_DIRECTIONS = ['inbound', 'outbound'] as const;
export type MessageDirection = (typeof MESSAGE_DIRECTIONS)[number];

export const MESSAGE_SENDERS = ['agent', 'human', 'participant', 'system'] as const;
export type MessageSender = (typeof MESSAGE_SENDERS)[number];

export const WISMO_TYPES = [
  'proactive_eta', 'proactive_dispatched', 'proactive_delivered',
  'proactive_failed', 'proactive_rescheduled',
  'reactive_status', 'reactive_reschedule', 'reactive_cancel', 'reactive_other',
] as const;
export type WismoType = (typeof WISMO_TYPES)[number];

export const WISMO_DELIVERY_STATUSES = [
  'pending', 'sent', 'delivered', 'read', 'failed',
] as const;
export type WismoDeliveryStatus = (typeof WISMO_DELIVERY_STATUSES)[number];

export const SETTLEMENT_STATUSES = [
  'open', 'calculating', 'pending_review', 'approved', 'paid', 'disputed',
] as const;
export type SettlementStatus = (typeof SETTLEMENT_STATUSES)[number];

export const PAY_MODELS = [
  'per_delivery', 'per_km', 'fixed_daily', 'per_package', 'hybrid',
] as const;
export type PayModel = (typeof PAY_MODELS)[number];

export const EXCEPTION_SEVERITIES = ['low', 'medium', 'high', 'critical'] as const;
export type ExceptionSeverity = (typeof EXCEPTION_SEVERITIES)[number];

export const EXCEPTION_STATUSES = [
  'open', 'auto_resolving', 'auto_resolved', 'escalated', 'human_resolved', 'dismissed',
] as const;
export type ExceptionStatus = (typeof EXCEPTION_STATUSES)[number];

export const EXCEPTION_CATEGORIES = [
  'late_delivery', 'driver_no_show', 'missing_pod', 'wrong_address',
  'data_quality', 'customer_complaint', 'safety_incident',
  'duplicate_submission', 'amount_mismatch', 'other',
] as const;
export type ExceptionCategory = (typeof EXCEPTION_CATEGORIES)[number];

export const ACTOR_TYPES = ['agent', 'human', 'driver', 'client', 'system', 'webhook'] as const;
export type ActorType = (typeof ACTOR_TYPES)[number];

export const COMMAND_STATUSES = ['pending', 'processed', 'failed'] as const;
export type CommandStatus = (typeof COMMAND_STATUSES)[number];
