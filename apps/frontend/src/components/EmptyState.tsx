import type { LucideIcon } from 'lucide-react';

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description: string;
  action?: { label: string; onClick: () => void } | { label: string; href: string };
}

export function EmptyState({ icon: Icon, title, description, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-4">
      <Icon className="h-12 w-12 text-text-muted mb-4" />
      <h3 className="text-base font-semibold text-text mb-1">{title}</h3>
      <p className="text-sm text-text-secondary mb-4 max-w-sm text-center">{description}</p>
      {action && (
        'href' in action ? (
          <a href={action.href} className="px-4 py-2 bg-accent text-accent-foreground rounded-md text-sm font-medium hover:opacity-90 transition-opacity">
            {action.label}
          </a>
        ) : (
          <button onClick={action.onClick} className="px-4 py-2 bg-accent text-accent-foreground rounded-md text-sm font-medium hover:opacity-90 transition-opacity">
            {action.label}
          </button>
        )
      )}
    </div>
  );
}
