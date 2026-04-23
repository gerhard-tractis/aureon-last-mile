import { NextRequest } from 'next/server';
import { proxyToAgents } from '../_proxy';

/**
 * POST /api/dev/wismo-test/simulate-event
 * → POST {AGENTS_BASE_URL}/dev/simulate-event  (body forwarded)
 */
export async function POST(request: NextRequest) {
  const body = await request.text();
  return proxyToAgents(request, {
    path: '/dev/simulate-event',
    method: 'POST',
    body,
  });
}
