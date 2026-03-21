import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb';
import { Separator } from '@/components/ui/separator';
import { Fragment } from 'react';

interface BreadcrumbEntry {
  label: string;
  href?: string;
}

interface PageShellProps {
  title: string;
  breadcrumbs?: BreadcrumbEntry[];
  actions?: React.ReactNode;
  children: React.ReactNode;
}

export function PageShell({ title, breadcrumbs, actions, children }: PageShellProps) {
  return (
    <div className="p-4 lg:p-6">
      {(breadcrumbs || actions) && (
        <div className="flex items-center justify-between mb-1">
          {breadcrumbs && breadcrumbs.length > 0 ? (
            <Breadcrumb>
              <BreadcrumbList>
                {breadcrumbs.map((crumb, i) => (
                  <Fragment key={crumb.label}>
                    {i > 0 && <BreadcrumbSeparator />}
                    <BreadcrumbItem>
                      {crumb.href && i < breadcrumbs.length - 1 ? (
                        <BreadcrumbLink href={crumb.href}>{crumb.label}</BreadcrumbLink>
                      ) : (
                        <BreadcrumbPage>{crumb.label}</BreadcrumbPage>
                      )}
                    </BreadcrumbItem>
                  </Fragment>
                ))}
              </BreadcrumbList>
            </Breadcrumb>
          ) : (
            <div />
          )}
          {actions && <div className="flex items-center gap-2">{actions}</div>}
        </div>
      )}
      <h1 className="text-xl font-bold text-text mb-4">{title}</h1>
      <Separator className="mb-4" />
      {children}
    </div>
  );
}
