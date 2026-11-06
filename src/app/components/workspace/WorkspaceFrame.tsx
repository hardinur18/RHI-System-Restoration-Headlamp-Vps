import type { ReactNode } from 'react';

import { Badge } from '@/app/components/ui/badge';
import { Card } from '@/app/components/ui/card';

export type WorkspaceFrameProps = {
  title: string;
  description: string;
  badges?: string[];
  stats?: Array<{
    label: string;
    value: string;
    hint?: string;
  }>;
  actions?: ReactNode;
  filters?: ReactNode;
  children: ReactNode;
};

export function WorkspaceFrame({
  title,
  description,
  badges = [],
  stats = [],
  actions,
  filters,
  children,
}: WorkspaceFrameProps) {
  return (
    <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-6 p-0">
      <Card className="border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-col gap-5 p-6">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
            <div className="space-y-3">
              {badges.length > 0 && <div className="flex flex-wrap items-center gap-2">
                {badges.map((badge) => (
                  <Badge
                    key={badge}
                    variant="outline"
                    className="border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-700 dark:bg-slate-800/80 dark:text-slate-300"
                  >
                    {badge}
                  </Badge>
                ))}
              </div>}
              <div>
                <h1 className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">
                  {title}
                </h1>
                <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-500 dark:text-slate-400">
                  {description}
                </p>
              </div>
            </div>

            {actions ? (
              <div className="flex flex-wrap items-center gap-3 xl:justify-end">{actions}</div>
            ) : null}
          </div>

          {stats.length > 0 ? (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              {stats.map((stat) => (
                <div
                  key={stat.label}
                  className="rounded-2xl border border-slate-200 bg-slate-50/80 p-4 dark:border-slate-800 dark:bg-slate-950/40"
                >
                  <div className="text-xs font-medium uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                    {stat.label}
                  </div>
                  <div className="mt-2 text-2xl font-semibold text-slate-900 dark:text-slate-100">
                    {stat.value}
                  </div>
                  {stat.hint ? (
                    <p className="mt-1 text-xs leading-5 text-slate-500 dark:text-slate-400">
                      {stat.hint}
                    </p>
                  ) : null}
                </div>
              ))}
            </div>
          ) : null}
        </div>
      </Card>

      {filters}
      {children}
    </div>
  );
}
