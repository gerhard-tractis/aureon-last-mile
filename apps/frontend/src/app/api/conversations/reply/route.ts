// src/app/api/conversations/reply/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { createSSRClient } from '@/lib/supabase/server';

const WA_API_VERSION = 'v18.0';
const WA_BASE_URL = `https://graph.facebook.com/${WA_API_VERSION}`;

async function sendWhatsApp(phone: string, body: string) {
  const phoneNumberId = process.env.WA_PHONE_NUMBER_ID!;
  const accessToken = process.env.WA_ACCESS_TOKEN!;

  const res = await fetch(`${WA_BASE_URL}/${phoneNumberId}/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: phone,
      type: 'text',
      text: { body },
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`WhatsApp API error: ${res.status} ${err}`);
  }

  const data = await res.json();
  return data.messages?.[0]?.id as string;
}

export async function POST(req: NextRequest) {
  const supabase = await createSSRClient();

  // 1. Auth check
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // 2. Permission check
  const claims = user.app_metadata?.claims;
  const role = claims?.role as string | undefined;
  const permissions = (claims?.permissions ?? []) as string[];
  const allowed =
    role === 'admin' ||
    role === 'operations_manager' ||
    permissions.includes('customer_service');
  if (!allowed) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  // 3. Parse body
  const { session_id, body: msgBody } = await req.json();
  if (!session_id || !msgBody) {
    return NextResponse.json({ error: 'session_id and body are required' }, { status: 400 });
  }

  // 4. Validate session
  const { data: session, error: sessErr } = await supabase
    .from('customer_sessions')
    .select('id, operator_id, customer_phone, status')
    .eq('id', session_id)
    .eq('operator_id', claims?.operator_id)
    .single();

  if (sessErr || !session) {
    return NextResponse.json({ error: 'Session not found' }, { status: 404 });
  }
  if (session.status !== 'escalated') {
    return NextResponse.json({ error: 'Session is not escalated' }, { status: 422 });
  }

  // 5. Send via WhatsApp
  let externalMessageId: string;
  try {
    externalMessageId = await sendWhatsApp(session.customer_phone, msgBody);
  } catch (err) {
    return NextResponse.json(
      { error: `WhatsApp send failed: ${(err as Error).message}` },
      { status: 502 },
    );
  }

  // 6. Insert message row
  const { data: msg, error: msgErr } = await supabase
    .from('customer_session_messages')
    .insert({
      operator_id: claims?.operator_id,
      session_id,
      role: 'operator',
      body: msgBody,
      external_message_id: externalMessageId,
      wa_status: 'sent',
    })
    .select('id, created_at')
    .single();

  if (msgErr) {
    return NextResponse.json({ error: msgErr.message }, { status: 500 });
  }

  return NextResponse.json({ message_id: msg.id, created_at: msg.created_at });
}
