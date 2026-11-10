import type { ReactNode } from 'react';
import type { DateRange } from 'react-day-picker';

import { Card } from '@/app/components/ui/card';
import { SmartFilterDate } from '@/app/components/SmartFilterDate';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/app/components/ui/select';
import { integrasiIklanCopy } from '../integrasiIklanContent';
import type { IntegrasiIklanOption } from '../integrasiIklanTypes';
import { FilterRow } from '@/app/components/ui/control-layout';

function FilterField({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="filterField">
      <div className="filterFieldLabel">
        {label}
      </div>
      {children}
    </div>
  );
}

type IntegrasiIklanFiltersProps = {
  selectedDateRange: DateRange | undefined;
  onDateRangeChange: (value: DateRange | undefined) => void;
  selectedPlatformId: string;
  selectedGroupId: string;
  selectedAdvertiserId: string;
  selectedAdAccountId: string;
  onPlatformChange: (value: string) => void;
  onGroupChange: (value: string) => void;
  onAdvertiserChange: (value: string) => void;
  onAdAccountChange: (value: string) => void;
  platformOptions: IntegrasiIklanOption[];
  businessGroupOptions: IntegrasiIklanOption[];
  advertiserOptions: IntegrasiIklanOption[];
  adAccountOptions: IntegrasiIklanOption[];
  isApplyingDateRange: boolean;
};

export function IntegrasiIklanFilters({
  selectedDateRange,
  onDateRangeChange,
  selectedPlatformId,
  selectedGroupId,
  selectedAdvertiserId,
  selectedAdAccountId,
  onPlatformChange,
  onGroupChange,
  onAdvertiserChange,
  onAdAccountChange,
  platformOptions,
  businessGroupOptions,
  advertiserOptions,
  adAccountOptions,
  isApplyingDateRange,
}: IntegrasiIklanFiltersProps) {
  return (
    <Card className="filterPanel border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              {integrasiIklanCopy.filters.title}
            </div>
            <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              Pilih rentang waktu, lane platform, dan akun yang ingin dibedah.
            </div>
          </div>

          {isApplyingDateRange ? (
            <div className="rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-xs text-blue-700 dark:border-blue-900/70 dark:bg-blue-950/40 dark:text-blue-300">
              Menerapkan rentang waktu terbaru...
            </div>
          ) : null}
        </div>

        <FilterRow className="filterGrid">
          <FilterField label="Rentang Waktu">
            <SmartFilterDate
              date={selectedDateRange}
              setDate={onDateRangeChange}
              className="w-full"
            />
          </FilterField>

          <FilterField label="Platform">
            <Select value={selectedPlatformId} onValueChange={onPlatformChange}>
              <SelectTrigger className="w-full min-w-0 bg-white dark:bg-slate-900">
                <SelectValue placeholder={integrasiIklanCopy.filters.platform} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{integrasiIklanCopy.filters.allPlatform}</SelectItem>
                {platformOptions.map((platform) => (
                  <SelectItem key={platform.id} value={platform.id}>
                    {platform.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FilterField>

          <FilterField label="Business Manager / Grup">
            <Select value={selectedGroupId} onValueChange={onGroupChange}>
              <SelectTrigger className="w-full min-w-0 bg-white dark:bg-slate-900">
                <SelectValue placeholder={integrasiIklanCopy.filters.businessGroup} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{integrasiIklanCopy.filters.allBusinessGroup}</SelectItem>
                {businessGroupOptions.map((group) => (
                  <SelectItem key={group.id} value={group.id}>
                    {group.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FilterField>

          <FilterField label="Advertiser">
            <Select value={selectedAdvertiserId} onValueChange={onAdvertiserChange}>
              <SelectTrigger className="w-full min-w-0 bg-white dark:bg-slate-900">
                <SelectValue placeholder={integrasiIklanCopy.filters.advertiser} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{integrasiIklanCopy.filters.allAdvertiser}</SelectItem>
                {advertiserOptions.map((advertiser) => (
                  <SelectItem key={advertiser.id} value={advertiser.id}>
                    {advertiser.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FilterField>

          <FilterField label="Akun Iklan">
            <Select value={selectedAdAccountId} onValueChange={onAdAccountChange}>
              <SelectTrigger className="w-full min-w-0 bg-white dark:bg-slate-900">
                <SelectValue placeholder={integrasiIklanCopy.filters.adAccount} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{integrasiIklanCopy.filters.allAdAccount}</SelectItem>
                {adAccountOptions.map((account) => (
                  <SelectItem key={account.id} value={account.id}>
                    {account.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FilterField>
        </FilterRow>
      </div>
    </Card>
  );
}
