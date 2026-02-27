// src/connectors/index.ts — Connector registry
import { ConnectorExecutor } from './types';
import { executeCsvEmail } from './csv-email';
import { executeBeetrack } from './beetrack';

export const connectors: Record<string, ConnectorExecutor> = {
  csv_email: executeCsvEmail,
  browser: executeBeetrack,
};
