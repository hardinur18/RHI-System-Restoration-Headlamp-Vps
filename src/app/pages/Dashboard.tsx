import React from 'react';
import { useMasterData } from './master-data/context';
import { PageLoadingState } from '../components/layout/PageLoadingState';
import { AlertTriangle, CheckCircle2, Loader2, Megaphone, MessageSquare, Wrench, type LucideIcon } from 'lucide-react';
import { DASHBOARD_VIEW_PERMISSION_MAP, type DashboardViewMode } from '../data/permissions';
import { normalizeRole } from '../data/roleHelpers';
import { Tabs, TabsContent, TabsRail, TabsTrigger, TabsViewport } from '../components/ui/tabs';
import { probeSystemHealth, type SystemHealthCheck } from '../services/systemHealthService';

const TechnicianDashboard = React.lazy(() => import('./technician/TechnicianDashboard').then(
  (module) => ({ default: module.TechnicianDashboard }),
));
const CSDashboard = React.lazy(() => import('./cs/CSDashboard').then(
  (module) => ({ default: module.CSDashboard }),
));
const AdvertiserDashboard = React.lazy(() => import('./advertiser/AdvertiserDashboard').then(
  (module) => ({ default: module.AdvertiserDashboard }),
));

interface DashboardProps {
  viewMode?: DashboardViewMode;
  availableViewModes?: DashboardViewMode[];
  onViewModeChange?: (mode: DashboardViewMode) => void;
}

const DASHBOARD_VIEW_META: Record<DashboardViewMode, { label: string; icon: LucideIcon }> = {
  Advertiser: { label: 'Advertiser', icon: Megaphone },
  CS: { label: 'CS', icon: MessageSquare },
  Teknisi: { label: 'Teknisi', icon: Wrench },
};

const isDashboardViewMode = (value: unknown): value is DashboardViewMode => (
  typeof value === 'string' && value in DASHBOARD_VIEW_PERMISSION_MAP
);

function DashboardViewContent({ viewMode }: { viewMode: DashboardViewMode }) {
  return (
    <React.Suspense fallback={<PageLoadingState />}>
      {viewMode === 'Teknisi' ? <TechnicianDashboard />
        : viewMode === 'CS' ? <CSDashboard /> : <AdvertiserDashboard />}
    </React.Suspense>
  );
}

function SystemHealthStrip() {
  const [checks, setChecks] = React.useState<SystemHealthCheck[]>([]);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    let cancelled = false;

    const run = async () => {
      setLoading(true);
      const result = await probeSystemHealth();
      if (cancelled) return;
      setChecks(result.checks);
      setLoading(false);
    };

    const timeoutId = window.setTimeout(() => {
      void run();
    }, 1_200);

    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, []);

  if (loading || checks.length === 0 || checks.every((check) => check.ok)) {
    return null;
  }

  return (
    <div className="mx-auto mt-4 w-full max-w-[calc(100%-48px)] rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-amber-900 shadow-sm dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-100">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <AlertTriangle className="h-4 w-4" />
          <span>Koneksi sistem sedang tidak stabil</span>
        </div>
        <div className="flex flex-wrap gap-2">
          {checks.map((check) => (
            <span
              key={check.key}
              className="inline-flex items-center gap-1.5 rounded-full border border-amber-200 bg-white/70 px-2.5 py-1 text-xs font-medium dark:border-amber-900/60 dark:bg-slate-950/30"
              title={check.detail || `${check.ms}ms`}
            >
              {check.ok ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" /> : <Loader2 className="h-3.5 w-3.5 text-amber-700" />}
              {check.label}: {check.ok ? `${check.ms}ms` : check.detail || 'Timeout'}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function Dashboard({
  viewMode,
  availableViewModes = [],
  onViewModeChange,
}: DashboardProps) {
  const { currentRole } = useMasterData();
  const effectiveRole = normalizeRole(viewMode || currentRole);
  const activeViewMode: DashboardViewMode =
    effectiveRole in DASHBOARD_VIEW_PERMISSION_MAP ? effectiveRole as DashboardViewMode : 'Advertiser';
  const visibleViewModes = (availableViewModes.length > 0 ? availableViewModes : [activeViewMode])
    .filter(isDashboardViewMode);
  const safeViewModes = visibleViewModes.length > 0 ? visibleViewModes : [activeViewMode];
  const canSwitchView = visibleViewModes.length > 1 && Boolean(onViewModeChange);

  if (!canSwitchView) {
    return (
      <>
        <SystemHealthStrip />
        <DashboardViewContent viewMode={activeViewMode} />
      </>
    );
  }

  return (
    <>
      <SystemHealthStrip />
      <Tabs
        value={activeViewMode}
        onValueChange={(value) => onViewModeChange?.(value as DashboardViewMode)}
        className="dashboardViewTabsRoot"
      >
        <div className="dashboardViewSwitcherWrap">
          <TabsViewport className="dashboardViewTabsViewport">
            <TabsRail className="dashboardViewTabsRail min-w-max" aria-label="Dashboard view">
              {safeViewModes.map((mode) => {
                const Icon = DASHBOARD_VIEW_META[mode].icon;

                return (
                  <TabsTrigger
                    key={mode}
                    value={mode}
                    className="dashboardViewTab"
                  >
                    <Icon className="h-4 w-4" />
                    <span>{DASHBOARD_VIEW_META[mode].label}</span>
                  </TabsTrigger>
                );
              })}
            </TabsRail>
          </TabsViewport>
        </div>

        {safeViewModes.map((mode) => (
          <TabsContent key={mode} value={mode} className="dashboardViewContent">
            {mode === activeViewMode ? <DashboardViewContent viewMode={mode} /> : null}
          </TabsContent>
        ))}
      </Tabs>
    </>
  );
}
