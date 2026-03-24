import { createSSRClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';

export async function POST() {
  try {
    const supabase = await createSSRClient();
    const { data: { session }, error: authError } = await supabase.auth.getSession();
    if (authError || !session) {
      return NextResponse.json({ code: 'UNAUTHORIZED' }, { status: 401 });
    }

    const operatorId: string | undefined = session.user.app_metadata?.claims?.operator_id;
    if (!operatorId) {
      return NextResponse.json({ code: 'NO_OPERATOR' }, { status: 403 });
    }

    const today = new Date().toISOString().split('T')[0];
    // Use a draft placeholder for external_route_id (NOT NULL constraint).
    // This is replaced with the real DT route ID when /dispatch is called.
    const draftExternalId = `draft_${crypto.randomUUID()}`;

    const { data: route, error } = await supabase
      .from('routes')
      .insert({
        operator_id: operatorId,
        provider: 'dispatchtrack',
        external_route_id: draftExternalId,
        route_date: today,
        status: 'draft',
        planned_stops: 0,
        completed_stops: 0,
      })
      .select('id, status, route_date, created_at')
      .single();

    if (error) throw error;

    return NextResponse.json(route, { status: 201 });
  } catch (err) {
    console.error('[dispatch/routes POST]', err);
    return NextResponse.json({ code: 'INTERNAL_ERROR' }, { status: 500 });
  }
}
