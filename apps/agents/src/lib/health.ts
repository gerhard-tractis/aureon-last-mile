// src/lib/health.ts — HTTP health endpoint
import http from 'http';

const DEFAULT_PORT = 3100;

export function startHealthServer(port: number = DEFAULT_PORT): http.Server {
  const server = http.createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/health') {
      const body = JSON.stringify({ status: 'ok' });
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      });
      res.end(body);
    } else {
      res.writeHead(404);
      res.end();
    }
  });

  server.listen(port);
  return server;
}
