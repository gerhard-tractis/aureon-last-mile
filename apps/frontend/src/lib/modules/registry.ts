/**
 * spec-45 — Module Registry
 * Source of truth for which modules CAN be toggled. The DB activation tables
 * store TEXT keys; this enum validates them.
 */

export enum ModuleKey {
  OPS_CONTROL = 'ops_control',
  LATE_ORDER_ALERTS = 'late_order_alerts',
  PICKUP = 'pickup',
  RECEPTION = 'reception',
  DISTRIBUTION = 'distribution',
  PRE_ROUTE = 'pre_route',
  DISPATCH = 'dispatch',
  RETURNS = 'returns',
  CONVERSATIONS = 'conversations',
}

export interface ModuleMeta {
  label: string;
  description: string;
  navHref: string | null;
  navIcon?: string;
}

export const MODULES: Record<ModuleKey, ModuleMeta> = {
  [ModuleKey.OPS_CONTROL]: {
    label: 'Operations Control',
    description: 'Pipeline visibility dashboard for ops managers.',
    navHref: '/operations-control',
  },
  [ModuleKey.LATE_ORDER_ALERTS]: {
    label: 'Late Order Alerts',
    description:
      'WhatsApp/email notifications when an order approaches or breaches its commercial deadline.',
    navHref: null,
  },
  [ModuleKey.PICKUP]: {
    label: 'Pickup',
    description: 'Tenant warehouse load verification with OCR.',
    navHref: '/pickup',
  },
  [ModuleKey.RECEPTION]: {
    label: 'Reception',
    description: 'Hub inbound package intake.',
    navHref: '/reception',
  },
  [ModuleKey.DISTRIBUTION]: {
    label: 'Distribution',
    description: 'Dock zone assignment and batch packaging.',
    navHref: '/distribution',
  },
  [ModuleKey.PRE_ROUTE]: {
    label: 'Pre-Route',
    description: 'Route planning visibility (andén → truck mapping).',
    navHref: '/pre-route',
  },
  [ModuleKey.DISPATCH]: {
    label: 'Dispatch',
    description: 'Route building, truck assignment, DispatchTrack push.',
    navHref: '/dispatch',
  },
  [ModuleKey.RETURNS]: {
    label: 'Returns',
    description: 'Failed-delivery handling and return-to-sender flows.',
    navHref: '/returns',
  },
  [ModuleKey.CONVERSATIONS]: {
    label: 'Conversations',
    description: 'WhatsApp/SMS agent conversation monitoring.',
    navHref: '/conversations',
  },
};

export const ALL_MODULE_KEYS: readonly ModuleKey[] = Object.values(ModuleKey);

export function isValidModuleKey(value: string): value is ModuleKey {
  return (ALL_MODULE_KEYS as readonly string[]).includes(value);
}
