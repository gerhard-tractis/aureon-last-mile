import { NextRequest } from 'next/server';
import { proxyToAgents } from '../../_proxy';

/**
 * POST /api/dev/wismo-test/test-orders/purge
 * → POST {AGENTS_BASE_URL}/dev/test-orders/purge
 */
export async function POST(request: NextRequest) {
  return proxyToAgents(request, {
    path: '/dev/test-orders/purge',
    method: 'POST',
  });
}
