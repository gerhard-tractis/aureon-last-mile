import { NextRequest } from 'next/server';
import { proxyToAgents } from '@/app/api/dev/wismo-test/_proxy';

/**
 * POST /api/dev/wismo-test/test-orders/[id]/state
 * → POST {AGENTS_BASE_URL}/dev/test-orders/{id}/state  (body forwarded)
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = await request.text();
  return proxyToAgents(request, {
    path: `/dev/test-orders/${id}/state`,
    method: 'POST',
    body,
  });
}
