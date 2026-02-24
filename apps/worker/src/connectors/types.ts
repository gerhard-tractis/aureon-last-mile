// src/connectors/types.ts — Connector execution contract
export interface JobRecord {
  id: string;
  job_type: 'csv_email' | 'browser' | string;
  client_id: string;
  operator_id: string;
  retry_count: number;
  max_retries: number;
  priority: number;
  scheduled_at: string;
}

export interface JobResult {
  success: boolean;
  result?: Record<string, unknown>;
  errorMessage?: string;
}

export type ConnectorExecutor = (job: JobRecord) => Promise<JobResult>;
