import { requireModuleEnabled } from '@/lib/modules/require-enabled';
import { ModuleKey } from '@/lib/modules/registry';

export default async function ConversationsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireModuleEnabled(ModuleKey.CONVERSATIONS);
  return <>{children}</>;
}
