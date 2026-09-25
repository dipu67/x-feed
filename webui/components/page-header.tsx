import type { ReactNode } from "react";

/** Shared page header: title + description on the left, actions on the
 * right. One visual pattern for every page (the feed keeps its own sticky
 * variant because it also carries the live badge). */
export function PageHeader({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children?: ReactNode;
}) {
  return (
    <header className="flex flex-col gap-4 border-b px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <h1 className="text-lg font-semibold tracking-tight">{title}</h1>
        {description ? (
          <p className="text-sm text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {children ? (
        <div className="flex shrink-0 items-center gap-2">{children}</div>
      ) : null}
    </header>
  );
}
