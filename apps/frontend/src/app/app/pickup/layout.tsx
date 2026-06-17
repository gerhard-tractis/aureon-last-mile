import { requireModuleEnabled } from '@/lib/modules/require-enabled';
import { ModuleKey } from '@/lib/modules/registry';
import PickupClientGate from './_client-gate';

export default async function PickupLayout({ children }: { children: React.ReactNode }) {
  await requireModuleEnabled(ModuleKey.PICKUP);
  return <PickupClientGate>{children}</PickupClientGate>;
}
