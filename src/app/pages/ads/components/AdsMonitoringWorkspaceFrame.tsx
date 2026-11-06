import type { ReactNode } from 'react';
import type { DateRange } from 'react-day-picker';
import { SmartFilterDate } from '@/app/components/SmartFilterDate';
import { WorkspaceFrame } from '@/app/components/workspace/WorkspaceFrame';
import { AdsMonitoringFilters, type AdsMonitoringWorkspaceControls } from './AdsMonitoringFilters';

type AdsMonitoringWorkspaceFrameProps = {
  title: string;
  description: string;
  dateRange: DateRange | undefined;
  setDateRange: (range: DateRange | undefined) => void;
  badges?: string[];
  stats?: Array<{
    label: string;
    value: string;
    hint?: string;
  }>;
  controls?: AdsMonitoringWorkspaceControls;
  children: ReactNode;
};

export function AdsMonitoringWorkspaceFrame({ title, description, dateRange, setDateRange,
  badges = [], stats = [], controls, children,
}: AdsMonitoringWorkspaceFrameProps) {
  return (
    <WorkspaceFrame
      title={title}
      description={description}
      badges={badges}
      stats={stats}
      actions={!controls ? <SmartFilterDate date={dateRange} setDate={setDateRange} /> : undefined}
      filters={controls ? <AdsMonitoringFilters controls={controls} dateRange={dateRange} setDateRange={setDateRange} /> : undefined}
    >
      {children}
    </WorkspaceFrame>
  );
}
