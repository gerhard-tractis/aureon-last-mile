import { requireModuleEnabled } from '@/lib/modules/require-enabled';
import { ModuleKey } from '@/lib/modules/registry';
import DispatchClientGate from './_client-gate';

export default async function DispatchLayout({ children }: { children: React.ReactNode }) {
  await requireModuleEnabled(ModuleKey.DISPATCH);
  return <DispatchClientGate>{children}</DispatchClientGate>;
}
