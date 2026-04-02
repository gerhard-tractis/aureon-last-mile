// src/lib/health.ts — HTTP health + OCR extraction endpoint
import http from 'http';
import Busboy from 'busboy';
import { extractManifest } from '../tools/ocr/extract-manifest';

const DEFAULT_PORT = 3110;

interface HealthServerOptions {
  openrouterApiKey?: string;
  ocrApiSecret?: string;
}

function sendJson(res: http.ServerResponse, status: number, data: unknown) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  });
  res.end(body);
}

export function startHealthServer(
  port: number = DEFAULT_PORT,
  options: HealthServerOptions = {},
): http.Server {
  const { openrouterApiKey, ocrApiSecret } = options;

  const server = http.createServer((req, res) => {
    // CORS preflight
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Authorization, Content-Type',
        'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
      });
      res.end();
      return;
    }

    if (req.method === 'GET' && req.url === '/health') {
      sendJson(res, 200, { status: 'ok' });
      return;
    }

    if (req.method === 'POST' && req.url === '/api/ocr-extract') {
      handleOcrExtract(req, res, openrouterApiKey, ocrApiSecret);
      return;
    }

    res.writeHead(404);
    res.end();
  });

  server.listen(port);
  return server;
}

async function handleOcrExtract(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  apiKey?: string,
  secret?: string,
) {
  // Auth check
  if (secret) {
    const auth = req.headers.authorization;
    if (!auth || auth !== `Bearer ${secret}`) {
      sendJson(res, 401, { error: 'Unauthorized' });
      return;
    }
  }

  if (!apiKey) {
    sendJson(res, 500, { error: 'OPENROUTER_API_KEY not configured' });
    return;
  }

  // Parse multipart form data
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
    sendJson(res, 400, { error: 'Invalid multipart data' });
    return;
  }

  if (buffers.length === 0) {
    sendJson(res, 400, { error: 'No images provided' });
    return;
  }

  // Call extractManifest
  try {
    const result = await extractManifest(apiKey, buffers);
    sendJson(res, 200, result);
  } catch (err) {
    sendJson(res, 502, { error: String(err instanceof Error ? err.message : err) });
  }
}
