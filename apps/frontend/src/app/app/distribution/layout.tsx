import { requireModuleEnabled } from '@/lib/modules/require-enabled';
import { ModuleKey } from '@/lib/modules/registry';
import DistributionClientGate from './_client-gate';

export default async function DistributionLayout({ children }: { children: React.ReactNode }) {
  await requireModuleEnabled(ModuleKey.DISTRIBUTION);
  return <DistributionClientGate>{children}</DistributionClientGate>;
}
