import { NextRequest } from 'next/server';
import { proxyToAgents } from '../_proxy';

/**
 * GET  /api/dev/wismo-test/test-orders
 * → GET {AGENTS_BASE_URL}/dev/test-orders
 *
 * POST /api/dev/wismo-test/test-orders
 * → POST {AGENTS_BASE_URL}/dev/test-orders  (body forwarded as-is)
 */
export async function GET(request: NextRequest) {
  return proxyToAgents(request, {
    path: '/dev/test-orders',
    method: 'GET',
  });
}

export async function POST(request: NextRequest) {
  const body = await request.text();
  return proxyToAgents(request, {
    path: '/dev/test-orders',
    method: 'POST',
    body,
  });
}
