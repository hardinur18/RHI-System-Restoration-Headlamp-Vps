import type { ReactNode } from 'react';
import { OperationalFilterPanel } from '@/app/components/ui/operational-page';
import './cs-dashboard-filters.css';
import { ActionGroup } from '@/app/components/ui/control-layout';

type CsDashboardFiltersProps = {
  period: ReactNode;
  cs?: ReactNode;
  platform: ReactNode;
  actions?: ReactNode;
  expanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
  activeFilterCount: number;
};

export function CsDashboardFilters({
  period, cs, platform, actions, expanded, onExpandedChange, activeFilterCount,
}: CsDashboardFiltersProps) {
  return (
    <OperationalFilterPanel
      className="csFilters"
      collapsible
      isExpanded={expanded}
      onExpandedChange={onExpandedChange}
      summary={activeFilterCount > 0 ? `${activeFilterCount} filter aktif` : 'Semua data ditampilkan'}
      contentClassName="csFiltersContent"
    >
      <div className="csFiltersRow">
        <div className="csFiltersField csFiltersPeriod" role="group" aria-label="Periode">
          <span className="csFiltersLabel">Periode</span>
          {period}
        </div>
        {cs && (
          <div className="csFiltersField" role="group" aria-label="Customer service">
            <span className="csFiltersLabel">Customer service</span>
            {cs}
          </div>
        )}
        <div className="csFiltersField" role="group" aria-label="Platform">
          <span className="csFiltersLabel">Platform</span>
          {platform}
        </div>
        {actions && <ActionGroup className="csFiltersActions">{actions}</ActionGroup>}
      </div>
    </OperationalFilterPanel>
  );
}
