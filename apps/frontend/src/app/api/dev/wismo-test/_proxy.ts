import { NextRequest, NextResponse } from 'next/server';
import { createSSRClient } from '@/lib/supabase/server';

const ALLOWED_ROLES = ['admin', 'maintainer'] as const;

export interface ProxyOptions {
  /** Path under AGENTS_BASE_URL, e.g. "/dev/test-orders" */
  path: string;
  method: string;
  /** Raw request body to forward (only for non-GET requests) */
  body?: string | null;
}

/**
 * Shared proxy helper for /api/dev/wismo-test/* routes.
 *
 * Auth flow:
 *  1. Require authenticated session → 401 if missing
 *  2. Require role admin or maintainer → 401 if not
 *  3. Require AGENTS_DEV_TOKEN + AGENTS_BASE_URL env vars → 500 if missing
 *  4. Forward request to agents server with X-Dev-Token + X-Operator-Id headers
 *  5. Stream response body and status back to caller
 *
 * Security: AGENTS_DEV_TOKEN is NEVER echoed in the response body or
 * response headers visible to the browser.
 */
export async function proxyToAgents(
  _request: NextRequest,
  { path, method, body }: ProxyOptions,
): Promise<NextResponse> {
  // ── 1. Auth ──────────────────────────────────────────────────────────────
  const supabase = await createSSRClient();
  const {
    data: { session },
    error: authError,
  } = await supabase.auth.getSession();

  if (authError || !session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const role: string | undefined = session.user.app_metadata?.claims?.role;
  if (!ALLOWED_ROLES.includes(role as (typeof ALLOWED_ROLES)[number])) {
    return NextResponse.json({ error: 'Forbidden: admin or maintainer role required' }, { status: 401 });
  }

  const operatorId: string | undefined = session.user.app_metadata?.claims?.operator_id;

  // ── 2. Env vars ───────────────────────────────────────────────────────────
  const devToken = process.env.AGENTS_DEV_TOKEN;
  if (!devToken) {
    return NextResponse.json(
      { error: 'AGENTS_DEV_TOKEN is not configured on this server' },
      { status: 500 },
    );
  }

  const baseUrl = process.env.AGENTS_BASE_URL;
  if (!baseUrl) {
    return NextResponse.json(
      { error: 'AGENTS_BASE_URL is not configured on this server' },
      { status: 500 },
    );
  }

  // ── 3. Forward ────────────────────────────────────────────────────────────
  const url = `${baseUrl}${path}`;
  const headers: HeadersInit = {
    'Content-Type': 'application/json',
    'X-Dev-Token': devToken,
    ...(operatorId ? { 'X-Operator-Id': operatorId } : {}),
  };

  const fetchInit: RequestInit = { method, headers };
  if (body !== undefined && body !== null && method !== 'GET') {
    fetchInit.body = body;
  }

  let upstream: Response;
  try {
    upstream = await fetch(url, fetchInit);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json(
      { error: `Failed to reach agents server: ${message}` },
      { status: 502 },
    );
  }

  const responseBody = await upstream.text();

  // Parse as JSON if possible, else return raw text
  try {
    const json = JSON.parse(responseBody) as unknown;
    return NextResponse.json(json, { status: upstream.status });
  } catch {
    return new NextResponse(responseBody, {
      status: upstream.status,
      headers: { 'Content-Type': 'text/plain' },
    });
  }
}
