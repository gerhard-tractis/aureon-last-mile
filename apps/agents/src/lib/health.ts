// src/lib/health.ts — HTTP health + OCR extraction endpoint
import http from 'http';
import express from 'express';
import Busboy from 'busboy';
import { extractManifest } from '../tools/ocr/extract-manifest';

const DEFAULT_PORT = 3110;

interface HealthServerOptions {
  openrouterApiKey?: string;
  ocrApiSecret?: string;
}

export interface HealthServer {
  server: http.Server;
  app: express.Application;
}

export function startHealthServer(
  port: number = DEFAULT_PORT,
  options: HealthServerOptions = {},
): HealthServer {
  const { openrouterApiKey, ocrApiSecret } = options;

  const app = express();
  app.use(express.json());

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  app.post('/api/ocr-extract', (req, res) => {
    handleOcrExtract(req, res, openrouterApiKey, ocrApiSecret);
  });

  const server = http.createServer(app);
  server.listen(port);
  return { server, app };
}

async function handleOcrExtract(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  apiKey?: string,
  secret?: string,
) {
  function sendJson(status: number, data: unknown) {
    const body = JSON.stringify(data);
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(body);
  }

  if (secret) {
    const auth = (req as express.Request).headers.authorization;
    if (!auth || auth !== `Bearer ${secret}`) {
      sendJson(401, { error: 'Unauthorized' });
      return;
    }
  }

  if (!apiKey) {
    sendJson(500, { error: 'OPENROUTER_API_KEY not configured' });
    return;
  }

  const buffers: Buffer[] = [];

  try {
    await new Promise<void>((resolve, reject) => {
      const busboy = Busboy({ headers: req.headers as Record<string, string> });

      busboy.on('file', (_fieldname: string, file: NodeJS.ReadableStream) => {
        const chunks: Buffer[] = [];
        file.on('data', (chunk: Buffer) => chunks.push(chunk));
        file.on('end', () => buffers.push(Buffer.concat(chunks)));
      });

      busboy.on('finish', resolve);
      busboy.on('error', reject);
      req.pipe(busboy);
    });
  } catch {
    sendJson(400, { error: 'Invalid multipart data' });
    return;
  }

  if (buffers.length === 0) {
    sendJson(400, { error: 'No images provided' });
    return;
  }

  try {
    const result = await extractManifest(apiKey, buffers);
    sendJson(200, result);
  } catch (err) {
    sendJson(502, { error: String(err instanceof Error ? err.message : err) });
  }
}
