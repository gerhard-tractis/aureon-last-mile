export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('./sentry.server.config');
  }

  if (process.env.NEXT_RUNTIME === 'edge') {
    await import('./sentry.edge.config');
  }
}

// Capture errors from nested React Server Components
export async function onRequestError(
  err: Error,
  request: Request,
  context: {
    routerKind: 'Pages Router' | 'App Router';
    routePath: string;
    routeType: 'render' | 'route' | 'action' | 'middleware';
  }
) {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const Sentry = await import('@sentry/nextjs');
    Sentry.captureException(err, {
      tags: {
        runtime: 'nodejs',
        routerKind: context.routerKind,
        routeType: context.routeType,
      },
      extra: {
        routePath: context.routePath,
        url: request.url,
        method: request.method,
      },
    });
  }

  if (process.env.NEXT_RUNTIME === 'edge') {
    const Sentry = await import('@sentry/nextjs');
    Sentry.captureException(err, {
      tags: {
        runtime: 'edge',
        routerKind: context.routerKind,
        routeType: context.routeType,
      },
      extra: {
        routePath: context.routePath,
        url: request.url,
        method: request.method,
      },
    });
  }
}
