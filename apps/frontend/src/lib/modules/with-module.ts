import { isModuleEnabled } from './enabled';
import type { ModuleKey } from './registry';

type RouteHandler<Args extends unknown[]> = (
  req: Request,
  ...rest: Args
) => Promise<Response> | Response;

export function withModule<Args extends unknown[]>(
  key: ModuleKey,
  handler: RouteHandler<Args>,
): RouteHandler<Args> {
  return async (req, ...rest) => {
    if (!(await isModuleEnabled(key))) {
      return new Response('Not Found', { status: 404 });
    }
    return handler(req, ...rest);
  };
}
