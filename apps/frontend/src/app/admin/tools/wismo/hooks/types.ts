'use client';

export interface TestOrder {
  id: string;
  customer_name: string;
  customer_phone: string;
  delivery_date: string;
  status: string;
  created_at: string;
}

export interface TestOrderSnapshot {
  order: unknown;
  assignment: unknown;
  dispatch: unknown;
  session: unknown;
  messages: unknown[];
  reschedules: unknown[];
  recent_agent_events: unknown[];
}

export interface SimulateEventResult {
  snapshot: TestOrderSnapshot;
  new_messages: unknown[];
  new_agent_events: unknown[];
  model_used: string;
  estimated_cost_usd: number;
}

export interface CreateTestOrderInput {
  customer_name: string;
  customer_phone: string;
  delivery_date: string;
  delivery_window_start?: string;
  delivery_window_end?: string;
}
