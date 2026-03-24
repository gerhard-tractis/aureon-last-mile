import { es } from './es';

function t(key: string, vars?: Record<string, string | number>): string {
  const template = es[key] ?? key;
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (_, name) => String(vars[name] ?? `{${name}}`));
}

export function useTranslation() {
  return { t };
}
