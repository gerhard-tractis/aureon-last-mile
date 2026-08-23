/**
 * Shared fixtures for the navigation.*.test.ts files, split out so none of
 * them has to import from another *.test.ts module.
 */
import { ModuleKey } from '@/lib/modules/registry';
import type { buildNavSections } from './navigation';

export const ALL_MODULES = [
  ModuleKey.OPS_CONTROL,
  ModuleKey.PICKUP,
  ModuleKey.RECEPTION,
  ModuleKey.DISTRIBUTION,
  ModuleKey.DISPATCH,
  ModuleKey.CONVERSATIONS,
];

export const ALL_PERMISSIONS = ['pickup', 'reception', 'distribution', 'dispatch', 'customer_service'];

export function labels(sections: ReturnType<typeof buildNavSections>) {
  return sections.flatMap((s) => s.items.map((i) => i.label));
}
