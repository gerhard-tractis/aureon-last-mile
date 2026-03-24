import es from './es';

type Vars = Record<string, string | number>;

/**
 * Resolves a dotted key path from the Spanish dictionary and interpolates {placeholder} vars.
 * Falls back to the key string if not found.
 */
function resolve(dict: Record<string, unknown>, path: string): string {
  const parts = path.split('.');
  let node: unknown = dict;
  for (const part of parts) {
    if (typeof node !== 'object' || node === null) return path;
    node = (node as Record<string, unknown>)[part];
  }
  return typeof node === 'string' ? node : path;
}

function interpolate(template: string, vars?: Vars): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (_, key) => String(vars[key] ?? `{${key}}`));
}

export function useTranslation() {
  function t(key: string, vars?: Vars): string {
    const template = resolve(es as unknown as Record<string, unknown>, key);
    return interpolate(template, vars);
  }
  return { t };
}
