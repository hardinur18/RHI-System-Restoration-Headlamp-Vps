import React from 'react';
import { ChevronDown, RefreshCw, SlidersHorizontal, type LucideIcon } from 'lucide-react';
import { cn } from './utils';
import { Skeleton } from './skeleton';
import { Button } from './button';
import { ActionGroup } from './control-layout';
import { useMasterData } from '@/app/pages/master-data/context';
import { toast } from 'sonner';

type OperationalPageShellProps = React.HTMLAttributes<HTMLDivElement> & {
  children: React.ReactNode;
};

export function OperationalPageShell({ children, className, ...props }: OperationalPageShellProps) {
  return (
    <div
      className={cn('opsPageShell', className)}
      {...props}
    >
      {children}
    </div>
  );
}

type OperationalPageHeaderProps = {
  title: string;
  subtitle?: React.ReactNode;
  eyebrow?: string;
  icon?: LucideIcon;
  actions?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
  showRefresh?: boolean;
  onRefresh?: () => void | Promise<void>;
  isRefreshing?: boolean;
  refreshLabel?: string;
  refreshPlacement?: 'actions' | 'title';
};

export function OperationalPageHeader({
  title,
  subtitle,
  eyebrow,
  icon: Icon,
  actions,
  children,
  className,
  showRefresh = true,
  onRefresh,
  isRefreshing,
  refreshLabel = 'Refresh Data',
  refreshPlacement = 'title',
}: OperationalPageHeaderProps) {
  const {
    triggerRefresh,
    isMasterDataLoading,
    isOperationalDataLoading,
    isOrdersLoading,
    isLeadsLoading,
  } = useMasterData();
  const isGlobalRefreshing = Boolean(isMasterDataLoading || isOperationalDataLoading || isOrdersLoading || isLeadsLoading);
  const isRefreshingData = isRefreshing ?? isGlobalRefreshing;

  const handleRefreshData = React.useCallback(() => {
    if (isRefreshingData) {
      toast.info('Data masih dimuat...');
      return;
    }

    if (onRefresh) {
      void Promise.resolve(onRefresh()).catch((error) => {
        console.error('Page refresh failed:', error);
        toast.error('Refresh data gagal dijalankan');
      });
      return;
    }

    triggerRefresh();
    toast.success('Refresh data dijalankan');
  }, [isRefreshingData, onRefresh, triggerRefresh]);
  const refreshAction = showRefresh ? (
    <Button
      type="button"
      variant="outline"
      onClick={handleRefreshData}
      disabled={isRefreshingData}
      className="foundationHeaderRefreshButton dailyAdsHeaderButton h-9 bg-white dark:bg-slate-800 dark:text-slate-200 dark:border-slate-700"
      aria-label="Refresh data aplikasi"
      title={isRefreshingData ? 'Data sedang dimuat' : refreshLabel}
    >
      <RefreshCw className={cn('w-4 h-4', isRefreshingData && 'animate-spin')} />
      <span className="dailyAdsHeaderButtonText">{refreshLabel}</span>
    </Button>
  ) : null;
  const titleRefreshAction = refreshPlacement === 'title' ? refreshAction : null;
  const headerRefreshAction = refreshPlacement === 'actions' ? refreshAction : null;

  return (
    <div className={className}>
      <div className="topbar uiPageHeader">
        <div className="topbarTitle">
          {(eyebrow || Icon) && (
            <div className="eyebrowLine">
              {Icon && <Icon className="h-4 w-4" />}
              {eyebrow}
            </div>
          )}
          <div className="topbarTitleLine">
            <h1>{title}</h1>
            {titleRefreshAction}
          </div>
          {subtitle && <p>{subtitle}</p>}
        </div>
        {(headerRefreshAction || actions) && (
          <ActionGroup className="topbarActions">
            {headerRefreshAction}
            {actions}
          </ActionGroup>
        )}
      </div>
      {children && (
        <div className="surfacePanel overflow-hidden p-0">
          {children}
        </div>
      )}
    </div>
  );
}

type OperationalKpiGridProps = React.HTMLAttributes<HTMLDivElement> & {
  children: React.ReactNode;
};

export function OperationalKpiGrid({ children, className, ...props }: OperationalKpiGridProps) {
  return (
    <div className={cn('metricGrid', className)} {...props}>
      {children}
    </div>
  );
}

type OperationalKpiCardProps = {
  description?: React.ReactNode;
  label: string;
  value: React.ReactNode;
  valueTitle?: string;
  icon?: LucideIcon;
  tone?: 'default' | 'blue' | 'emerald' | 'rose' | 'amber' | 'violet';
  className?: string;
};

const kpiToneClass: Record<NonNullable<OperationalKpiCardProps['tone']>, string> = {
  default: '',
  blue: 'blue text-blue-700 dark:text-blue-300',
  emerald: 'green text-emerald-700 dark:text-emerald-300',
  rose: 'rose text-rose-700 dark:text-rose-300',
  amber: 'amber text-amber-700 dark:text-amber-300',
  violet: 'violet text-violet-700 dark:text-violet-300',
};

export function OperationalKpiCard({
  description,
  label,
  value,
  valueTitle,
  icon: Icon,
  tone = 'default',
  className,
}: OperationalKpiCardProps) {
  return (
    <div className={cn(
      'metricCard',
      !Icon && 'noIcon',
      kpiToneClass[tone],
      className,
    )}>
      {Icon && (
        <span className="metricIcon">
          <Icon className="h-5 w-5" />
        </span>
      )}
      <span className="metricContent">
        <small>{label}</small>
        <span className="metricValue" title={valueTitle}>{value}</span>
        {description ? <em>{description}</em> : null}
      </span>
    </div>
  );
}

type OperationalKpiSkeletonGridProps = React.HTMLAttributes<HTMLDivElement> & {
  count?: number;
};

export function OperationalKpiSkeletonGrid({
  count = 4,
  className,
  ...props
}: OperationalKpiSkeletonGridProps) {
  const itemCount = Math.max(1, Math.min(count, 8));

  return (
    <OperationalKpiGrid className={className} {...props}>
      {Array.from({ length: itemCount }).map((_, index) => (
        <div
          key={index}
          className="metricCard loading"
        >
          <div className="metricIcon">
            <Skeleton className="h-5 w-5 rounded-full" />
          </div>
          <span>
            <Skeleton className="h-4 w-24" />
            <Skeleton className="mt-4 h-7 w-20" />
            <Skeleton className="mt-2 h-3 w-32" />
          </span>
        </div>
      ))}
    </OperationalKpiGrid>
  );
}

type OperationalSurfaceProps = React.HTMLAttributes<HTMLDivElement> & {
  children: React.ReactNode;
};

type OperationalFilterPanelProps = OperationalSurfaceProps & {
  collapsible?: boolean;
  isExpanded?: boolean;
  onExpandedChange?: (expanded: boolean) => void;
  summary?: React.ReactNode;
  contentClassName?: string;
};

export function OperationalFilterPanel({
  children,
  className,
  collapsible = false,
  isExpanded = false,
  onExpandedChange,
  summary,
  contentClassName,
  ...props
}: OperationalFilterPanelProps) {
  if (!collapsible) {
    return (
      <div className={cn('surfacePanel filterPanel', className)} {...props}>
        {children}
      </div>
    );
  }

  return (
    <div
      className={cn('surfacePanel filterPanel foundationFilterPanelCollapsible', className)}
      data-mobile-open={isExpanded ? 'true' : 'false'}
      {...props}
    >
      <div className="foundationFilterSummary">
        <strong>{summary || 'Semua data ditampilkan'}</strong>
        <Button
          type="button"
          variant="outline"
          className="foundationFilterToggle"
          aria-expanded={isExpanded}
          onClick={() => onExpandedChange?.(!isExpanded)}
        >
          <SlidersHorizontal className="h-4 w-4" />
          <span>{isExpanded ? 'Tutup' : 'Filter'}</span>
          <ChevronDown className={cn('h-4 w-4 transition-transform', isExpanded && 'rotate-180')} />
        </Button>
      </div>
      <div className={cn('foundationFilterContent', contentClassName)}>
        {children}
      </div>
    </div>
  );
}

export function OperationalTableCard({ children, className, ...props }: OperationalSurfaceProps) {
  return (
    <div className={cn('tablePanel', className)} {...props}>
      {children}
    </div>
  );
}

type OperationalTableSkeletonProps = {
  rows?: number;
  columns?: number;
  showSecondaryLine?: boolean;
  stickyFirstColumn?: boolean;
  className?: string;
};

export function OperationalTableSkeleton({
  rows = 6,
  columns = 6,
  showSecondaryLine = true,
  stickyFirstColumn = false,
  className,
}: OperationalTableSkeletonProps) {
  const rowCount = Math.max(1, Math.min(rows, 10));
  const columnCount = Math.max(1, Math.min(columns, 16));

  return (
    <>
      {Array.from({ length: rowCount }).map((_, rowIndex) => (
        <tr key={rowIndex} className={cn('align-top', className)}>
          {Array.from({ length: columnCount }).map((__, columnIndex) => {
            const isFirst = columnIndex === 0;

            return (
              <td
                key={columnIndex}
                className={cn(
                  'px-6 py-4',
                  stickyFirstColumn && isFirst &&
                    'sticky left-0 bg-white shadow-[1px_0_0_#e2e8f0] dark:bg-slate-900',
                )}
              >
                <Skeleton
                  className={cn(
                    'h-4',
                    isFirst ? 'w-24' : columnIndex % 3 === 0 ? 'w-28' : 'w-20',
                  )}
                />
                {showSecondaryLine && (isFirst || columnIndex % 4 === 0) && (
                  <Skeleton className="mt-2 h-3 w-16" />
                )}
              </td>
            );
          })}
        </tr>
      ))}
    </>
  );
}

type OperationalCardSkeletonProps = React.HTMLAttributes<HTMLDivElement> & {
  lines?: number;
};

export function OperationalCardSkeleton({
  lines = 3,
  className,
  ...props
}: OperationalCardSkeletonProps) {
  const lineCount = Math.max(1, Math.min(lines, 8));

  return (
    <div
      className={cn('surfacePanel', className)}
      {...props}
    >
      <Skeleton className="h-5 w-40" />
      <Skeleton className="mt-3 h-3 w-56 max-w-full" />
      <div className="mt-5 space-y-3">
        {Array.from({ length: lineCount }).map((_, index) => (
          <Skeleton
            key={index}
            className={cn('h-4', index % 3 === 0 ? 'w-full' : index % 3 === 1 ? 'w-4/5' : 'w-2/3')}
          />
        ))}
      </div>
    </div>
  );
}

type OperationalFormSectionProps = OperationalSurfaceProps & {
  title: string;
  description?: React.ReactNode;
};

export function OperationalFormSection({
  title,
  description,
  children,
  className,
  ...props
}: OperationalFormSectionProps) {
  return (
    <section
      className={cn('formPanel', className)}
      {...props}
    >
      <div className="mb-4 border-b border-slate-100 pb-3 dark:border-slate-800">
        <h3 className="text-[length:var(--font-ui)] font-extrabold tracking-[0] text-slate-900 dark:text-slate-100">{title}</h3>
        {description && <p className="mt-1 text-[length:var(--font-small)] font-semibold text-slate-500 dark:text-slate-400">{description}</p>}
      </div>
      {children}
    </section>
  );
}

type OperationalEmptyStateProps = {
  icon?: LucideIcon;
  title: string;
  description?: React.ReactNode;
  className?: string;
};

export function OperationalEmptyState({ icon: Icon, title, description, className }: OperationalEmptyStateProps) {
  return (
    <div className={cn('flex flex-col items-center justify-center py-16 text-center', className)}>
      {Icon && (
        <div className="mb-3 rounded-full bg-slate-100 p-3 text-slate-400 dark:bg-slate-800">
          <Icon className="h-6 w-6" />
        </div>
      )}
      <h3 className="font-semibold text-slate-700 dark:text-slate-200">{title}</h3>
      {description && <p className="mt-1 max-w-md text-sm text-slate-500 dark:text-slate-400">{description}</p>}
    </div>
  );
}

type RequiredLabelProps = {
  children: React.ReactNode;
  required?: boolean;
  className?: string;
};

export function RequiredLabel({ children, required = true, className }: RequiredLabelProps) {
  return (
    <span className={cn('text-sm font-medium text-slate-700 dark:text-slate-200', className)}>
      {children}
      {required && <span className="ml-1 text-red-500">*</span>}
    </span>
  );
}
