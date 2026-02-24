// src/connectors/index.ts — Connector registry
import { ConnectorExecutor } from './types';
import { executeCsvEmail } from './csv-email';
// import { executeBrowser } from './browser'; // Story 2.6

export const connectors: Record<string, ConnectorExecutor> = {
  csv_email: executeCsvEmail,
  browser: async () => {
    throw new Error('Browser connector not implemented — see Story 2.6');
  },
};
