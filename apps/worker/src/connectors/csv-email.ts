// src/connectors/csv-email.ts — Status tracking only; n8n handles actual execution
import { JobRecord, JobResult } from './types';
import { log } from '../logger';

export async function executeCsvEmail(job: JobRecord): Promise<JobResult> {
  log('info', 'csv_email_status_ack', { jobId: job.id });
  return {
    success: true,
    result: { note: 'csv_email job acknowledged by worker; n8n is the actual executor' },
  };
}
