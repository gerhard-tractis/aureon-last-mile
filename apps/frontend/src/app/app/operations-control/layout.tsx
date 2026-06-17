import { requireModuleEnabled } from '@/lib/modules/require-enabled';
import { ModuleKey } from '@/lib/modules/registry';

export default async function OperationsControlLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireModuleEnabled(ModuleKey.OPS_CONTROL);
  return <>{children}</>;
}
