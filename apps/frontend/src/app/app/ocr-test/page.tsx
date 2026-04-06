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

  const { data: pickupPoints } = await supabase
    .from('pickup_points')
    .select('id, name, code')
    .eq('operator_id', operatorId!)
    .eq('is_active', true)
    .is('deleted_at', null)
    .order('name');

  return <OcrTestClient pickupPoints={pickupPoints ?? []} />;
}
