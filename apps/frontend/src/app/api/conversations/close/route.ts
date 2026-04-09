// src/app/api/conversations/close/route.ts
// customer_sessions is not in generated types yet (spec-24 pending regen).
import { NextRequest, NextResponse } from 'next/server';
import { createSSRClient } from '@/lib/supabase/server';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type UntypedClient = { from: (table: string) => any; auth: any };

export async function POST(req: NextRequest) {
  const supabase = (await createSSRClient()) as unknown as UntypedClient;

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const claims = user.app_metadata?.claims;
  const role = claims?.role as string | undefined;
  const permissions = (claims?.permissions ?? []) as string[];
  const allowed =
    role === 'admin' ||
    role === 'operations_manager' ||
    permissions.includes('customer_service');
  if (!allowed) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { session_id } = await req.json();
  if (!session_id) return NextResponse.json({ error: 'session_id required' }, { status: 400 });

  const { error } = await supabase
    .from('customer_sessions')
    .update({ status: 'closed', closed_at: new Date().toISOString() })
    .eq('id', session_id)
    .eq('operator_id', claims?.operator_id)
    .eq('status', 'escalated');

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
