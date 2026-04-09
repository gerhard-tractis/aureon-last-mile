// src/lib/conversations/types.ts

export type SessionStatus = 'active' | 'escalated' | 'closed';
export type MessageRole = 'user' | 'system' | 'operator';
export type WaStatus = 'sent' | 'delivered' | 'read' | 'failed' | null;

export interface ConversationSession {
  id: string;
  operator_id: string;
  order_id: string;
  customer_phone: string;
  customer_name: string | null;
  status: SessionStatus;
  escalated_at: string | null;
  closed_at: string | null;
  created_at: string;
  updated_at: string;
  // joined from orders
  order_number: string;
}

export interface SessionMessage {
  id: string;
  operator_id: string;
  session_id: string;
  role: MessageRole;
  body: string;
  external_message_id: string | null;
  wa_status: WaStatus;
  wa_status_at: string | null;
  template_name: string | null;
  action_taken: string | null;
  created_at: string;
}

export interface ConversationFilters {
  statuses: SessionStatus[];
  dateFrom: string | null;
  dateTo: string | null;
  search: string;
}
