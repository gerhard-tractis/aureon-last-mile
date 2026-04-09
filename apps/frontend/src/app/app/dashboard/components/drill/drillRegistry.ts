import { lazy, type LazyExoticComponent, type ComponentType } from 'react';

export type DrillKey = 'fadr' | 'late_reasons' | 'region' | 'customer';

export interface DrillEntry {
  title: string;
  subtitle?: string;
  content: LazyExoticComponent<ComponentType<{ params?: unknown }>>;
}

export const drillRegistry: Record<DrillKey, DrillEntry> = {
  fadr: {
    title: 'FADR — Motivos de no entrega',
    content: lazy(() => import('./content/FadrDrill')),
  },
  late_reasons: {
    title: 'Razones de retraso',
    content: lazy(() => import('./content/LateReasonsDrill')),
  },
  region: {
    title: 'OTIF por región',
    content: lazy(() => import('./content/RegionDrill')),
  },
  customer: {
    title: 'OTIF por cliente',
    content: lazy(() => import('./content/CustomerDrill')),
  },
};
