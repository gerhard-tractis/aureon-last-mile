import { requireModuleEnabled } from '@/lib/modules/require-enabled';
import { ModuleKey } from '@/lib/modules/registry';
import ReceptionClientGate from './_client-gate';

export default async function ReceptionLayout({ children }: { children: React.ReactNode }) {
  await requireModuleEnabled(ModuleKey.RECEPTION);
  return <ReceptionClientGate>{children}</ReceptionClientGate>;
}
