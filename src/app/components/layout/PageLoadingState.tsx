import { Skeleton } from '../ui/skeleton';

export function PageLoadingState() {
  return (
    <div className="opsPageShell" role="status" aria-label="Memuat halaman">
      <span className="sr-only">Memuat halaman...</span>
      <div className="surfacePanel">
        <div className="topbar mb-0">
          <div className="topbarTitle space-y-3">
            <Skeleton className="h-3 w-28" />
            <Skeleton className="h-7 w-64 max-w-full" />
            <Skeleton className="h-4 w-96 max-w-full" />
          </div>
          <div className="topbarActions">
            <Skeleton className="h-9 w-24" />
            <Skeleton className="h-9 w-9" />
          </div>
        </div>
      </div>
      <div className="metricGrid">
        {Array.from({ length: 4 }).map((_, index) => (
          <div key={index} className="metricCard loading">
            <span className="metricIcon">
              <Skeleton className="h-5 w-5 rounded-full" />
            </span>
            <span>
            <Skeleton className="h-4 w-24" />
            <Skeleton className="mt-4 h-8 w-20" />
            <Skeleton className="mt-2 h-3 w-32" />
            </span>
          </div>
        ))}
      </div>
      <div className="tablePanel">
        <div className="tableHeader">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-9 w-24" />
        </div>
        <div className="space-y-3 p-5">
          {Array.from({ length: 6 }).map((_, index) => (
            <Skeleton key={index} className="h-12 w-full" />
          ))}
        </div>
      </div>
    </div>
  );
}
