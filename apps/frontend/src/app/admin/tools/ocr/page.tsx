import { redirect } from 'next/navigation';
import { createSSRClient } from '@/lib/supabase/server';
import OcrTestClient from './OcrTestClient';

export default async function OcrTestPage() {
  const supabase = await createSSRClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session) {
    redirect('/auth/login');
  }

  const userRole = session.user.app_metadata?.claims?.role as string | undefined;
  if (userRole !== 'admin') {
    redirect('/app');
  }

  const operatorId = session.user.app_metadata?.claims?.operator_id as string | undefined;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: pickupPoints } = (await (supabase as any)
    .from('pickup_points')
    .select('id, name, code')
    .eq('operator_id', operatorId!)
    .eq('is_active', true)
    .is('deleted_at', null)
    .order('name')) as { data: { id: string; name: string; code: string }[] | null };

  return <OcrTestClient pickupPoints={pickupPoints ?? []} />;
}
