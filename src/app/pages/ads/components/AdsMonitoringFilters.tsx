import type { ReactNode } from 'react';

import { Badge } from '@/app/components/ui/badge';
import { Switch } from '@/app/components/ui/switch';
import { Card } from '@/app/components/ui/card';
import { SmartFilterDate } from '@/app/components/SmartFilterDate';
import type { DateRange } from 'react-day-picker';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/app/components/ui/select';
import type {
  AdsMonitoringWorkspaceMode,
  AdsMonitoringWorkspaceOption,
} from '../useAdsMonitoringWorkspaceData';

function ControlField({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="min-w-0 space-y-2">
      <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
        {label}
      </div>
      {children}
    </div>
  );
}

export type AdsMonitoringWorkspaceControls = {
  platformOptions: AdsMonitoringWorkspaceOption[];
  advertiserOptions: AdsMonitoringWorkspaceOption[];
  selectedPlatformId: string;
  selectedAdvertiserId: string;
  openClawMode: AdsMonitoringWorkspaceMode;
  compareMode: boolean;
  activeFilterCount?: number;
  onPlatformChange: (value: string) => void;
  onAdvertiserChange: (value: string) => void;
  onOpenClawModeChange: (value: AdsMonitoringWorkspaceMode) => void;
  onCompareModeChange: (value: boolean) => void;
};

type Props = {
  controls: AdsMonitoringWorkspaceControls;
  dateRange: DateRange | undefined;
  setDateRange: (range: DateRange | undefined) => void;
};

export function AdsMonitoringFilters({ controls, dateRange, setDateRange }: Props) {
  return (
        <Card className="border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <div className="space-y-4 p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  Filter & Perbandingan
                </div>
                <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                  Pilih platform, advertiser, dan periode yang ingin dibandingkan.
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline" className="border-slate-200 dark:border-slate-700">
                  {controls.activeFilterCount || 0} filter aktif
                </Badge>
                <Badge variant="outline" className="border-slate-200 dark:border-slate-700">
                  mode {controls.openClawMode}
                </Badge>
              </div>
            </div>

            <div className="grid gap-4 xl:grid-cols-[minmax(280px,1.2fr)_repeat(3,minmax(0,1fr))_minmax(180px,0.9fr)]">
              <ControlField label="Rentang Waktu">
                <SmartFilterDate date={dateRange} setDate={setDateRange} className="w-full" />
              </ControlField>

              <ControlField label="Platform">
                <Select value={controls.selectedPlatformId} onValueChange={controls.onPlatformChange}>
                  <SelectTrigger aria-label="Platform" className="w-full min-w-0 bg-white dark:bg-slate-900">
                    <SelectValue placeholder="Semua platform" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Semua platform</SelectItem>
                    {controls.platformOptions.map((platform) => (
                      <SelectItem key={platform.id} value={platform.id}>
                        {platform.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </ControlField>

              <ControlField label="Advertiser">
                <Select
                  value={controls.selectedAdvertiserId}
                  onValueChange={controls.onAdvertiserChange}
                >
                  <SelectTrigger aria-label="Advertiser" className="w-full min-w-0 bg-white dark:bg-slate-900">
                    <SelectValue placeholder="Semua advertiser" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Semua advertiser</SelectItem>
                    {controls.advertiserOptions.map((advertiser) => (
                      <SelectItem key={advertiser.id} value={advertiser.id}>
                        {advertiser.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </ControlField>

              <ControlField label="OpenClaw Mode">
                <Select
                  value={controls.openClawMode}
                  onValueChange={(value) =>
                    controls.onOpenClawModeChange(value as AdsMonitoringWorkspaceMode)
                  }
                >
                  <SelectTrigger aria-label="Mode OpenClaw" className="w-full min-w-0 bg-white dark:bg-slate-900">
                    <SelectValue placeholder="Pilih mode" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="manual">Audit</SelectItem>
                    <SelectItem value="assisted">Assisted</SelectItem>
                    <SelectItem value="semi-auto">Semi Auto</SelectItem>
                  </SelectContent>
                </Select>
              </ControlField>

              <ControlField label="Compare">
                <div className="flex h-9 items-center justify-between rounded-xl border border-slate-200 px-3 dark:border-slate-800">
                  <span className="text-sm text-slate-600 dark:text-slate-300">
                    Bandingkan vs periode sebelumnya
                  </span>
                  <Switch
                    aria-label="Bandingkan dengan periode sebelumnya"
                    checked={controls.compareMode}
                    onCheckedChange={controls.onCompareModeChange}
                  />
                </div>
              </ControlField>
            </div>
          </div>
        </Card>
  );
}
