// EmptyState — emoji + message + optional CTA (DESIGN_SYSTEM §7).
import type { ReactNode } from 'react';

export default function EmptyState({
  emoji = '📍',
  title,
  body,
  action,
  className,
}: {
  emoji?: string;
  title: string;
  body?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={`flex flex-col items-center gap-2 px-6 py-10 text-center ${className ?? ''}`}>
      <span aria-hidden="true" className="text-3xl">
        {emoji}
      </span>
      <p className="text-sm font-semibold text-neutral-900">{title}</p>
      {body && <p className="max-w-sm text-sm text-neutral-600">{body}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
