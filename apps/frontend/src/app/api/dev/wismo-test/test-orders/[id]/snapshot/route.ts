import { NextRequest } from 'next/server';
import { proxyToAgents } from '@/app/api/dev/wismo-test/_proxy';

/**
 * GET /api/dev/wismo-test/test-orders/[id]/snapshot
 * → GET {AGENTS_BASE_URL}/dev/test-orders/{id}/snapshot
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return proxyToAgents(request, {
    path: `/dev/test-orders/${id}/snapshot`,
    method: 'GET',
  });
}
