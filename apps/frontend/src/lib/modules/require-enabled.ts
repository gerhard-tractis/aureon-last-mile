import { notFound } from 'next/navigation';
import { isModuleEnabled } from './enabled';
import type { ModuleKey } from './registry';

export async function requireModuleEnabled(key: ModuleKey): Promise<void> {
  if (!(await isModuleEnabled(key))) notFound();
}
