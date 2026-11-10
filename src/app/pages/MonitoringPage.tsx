import React, { useState, useEffect, useMemo } from 'react';
import { useMasterData } from './master-data/context';
import { 
  format, 
  isSameDay, 
  parseISO, 
  differenceInMinutes, 
  startOfDay, 
  endOfDay, 
  isWithinInterval,
  subDays,
  startOfWeek,
  endOfWeek,
  startOfMonth,
  endOfMonth,
  addDays
} from 'date-fns';
import { id as localeId } from 'date-fns/locale';
import { 
  Clock, 
  MapPin, 
  Briefcase, 
  CheckCircle2, 
  User,
  ChevronRight,
  TrendingUp,
  Map,
  List,
  CalendarRange,
  LayoutList,
  Edit,
  Trash2,
  Target,
  BarChart,
  Terminal
} from 'lucide-react';
import { Button } from '../components/ui/button';
import { Card, CardContent } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import { cn } from '../components/ui/utils';
import { FoundationDateRangePicker } from '@/app/components/ui/period-filter-picker';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select";
import { DateRange } from "react-day-picker";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogTrigger,
  DialogFooter,
} from "../components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "../components/ui/alert-dialog";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { toast } from 'sonner';
import { Progress } from '../components/ui/progress';
import { usePermissions } from '@/app/hooks/usePermissions';
import { getSessionBackedEdgeHeaders } from '@/app/services/internal/sessionClientHeaders';
import { buildMakeServerUrl } from '@/app/services/internal/functionsBaseUrl';
import { minutesToMs, useUsageControlSettings } from '@/app/services/usageControlSettings';
import { isTechnicianRole } from '@/app/data/roleHelpers';

import { TargetManager, TargetItem } from './monitoring/TargetManager';

interface MonthlyTarget {
    month: string; // YYYY-MM
    revenue: number;
    orders: number;
    working_days: number;
    daily_revenue: number;
    daily_orders: number;
}

export function MonitoringPage() {
  const usageControlSettings = useUsageControlSettings();
  const shiftRefreshMs = minutesToMs(usageControlSettings.monitoringShiftRefreshMinutes);
  const { users, orders, currentRole } = useMasterData();
  const { hasPermission } = usePermissions();
  const canManageTargets = hasPermission('targets.manage');
  const canManageAttendance = hasPermission('technician_schedule.manage');
  
  // Tabs State
  const [activeTab, setActiveTab] = useState<'daily' | 'period'>('daily');

  // Daily State
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [refreshTrigger, setRefreshTrigger] = useState(0);

  // Period State
  const [periodFilter, setPeriodFilter] = useState<string>('this_week');
  const [dateRange, setDateRange] = useState<DateRange | undefined>({
    from: startOfWeek(new Date(), { weekStartsOn: 1 }),
    to: endOfWeek(new Date(), { weekStartsOn: 1 })
  });

  const [shifts, setShifts] = useState<Record<string, any>>({});
  const [isLoading, setIsLoading] = useState(true);

  // --- Target & Database State ---
  const currentMonthKey = useMemo(() => format(selectedDate, 'yyyy-MM'), [selectedDate]);
  const [monthlyTarget, setMonthlyTarget] = useState<MonthlyTarget | null>(null);
  const [isTargetModalOpen, setIsTargetModalOpen] = useState(false);
  const [rawTargets, setRawTargets] = useState<TargetItem[]>([]);
  const [targetRefresh, setTargetRefresh] = useState(0);

  // Fetch Target on Month Change (from API)
  useEffect(() => {
      const fetchTargets = async () => {
          try {
              const url = buildMakeServerUrl(`/targets/${currentMonthKey}`);
              const headers = await getSessionBackedEdgeHeaders();
              const res = await fetch(url, { headers });
              if (res.ok) {
                  const data: TargetItem[] = await res.json();
                  setRawTargets(Array.isArray(data) ? data : []);
                  
                  // Aggregate
                  const totalRev = (Array.isArray(data) ? data : []).reduce((acc, curr) => acc + (curr.revenueTarget || 0), 0);
                  const totalOrd = (Array.isArray(data) ? data : []).reduce((acc, curr) => acc + (curr.orderTarget || 0), 0);
                  const workingDays = (Array.isArray(data) ? data : [])[0]?.workingDays || 26; // Use first row or default
                  
                  const breakdown = {
                      daily_revenue: workingDays > 0 ? Math.ceil(totalRev / workingDays) : 0,
                      daily_orders: workingDays > 0 ? Math.ceil(totalOrd / workingDays) : 0
                  };

                  setMonthlyTarget({
                      month: currentMonthKey,
                      revenue: totalRev,
                      orders: totalOrd,
                      working_days: workingDays,
                      ...breakdown
                  });
              } else {
                  setRawTargets([]);
                  setMonthlyTarget(null);
              }
          } catch (e) {
              console.error("Fetch target error", e);
          }
      };
      
      fetchTargets();
  }, [currentMonthKey, selectedDate, targetRefresh]);


  // --- Realtime Achievement Calculation ---
  const achievementStats = useMemo(() => {
      // Filter orders for THIS MONTH
      const startM = startOfMonth(selectedDate);
      const endM = endOfMonth(selectedDate);
      
      const monthOrders = orders.filter(o => {
          if (!o.serviceDate) return false;
          const d = parseISO(o.serviceDate);
          return isWithinInterval(d, { start: startM, end: endM }) && 
                 (o.status === 'done' || o.status === 'teknisi_completed');
      });

      const currentRevenue = monthOrders.reduce((acc, curr) => acc + (curr.price || 0), 0);
      const currentOrders = monthOrders.length;
      
      // Daily Achievement (For selected Date)
      const dayStart = startOfDay(selectedDate);
      const dayEnd = endOfDay(selectedDate);
      
      const dayOrders = orders.filter(o => {
           if (!o.serviceDate) return false;
           const d = parseISO(o.serviceDate);
           return isWithinInterval(d, { start: dayStart, end: dayEnd }) &&
                  (o.status === 'done' || o.status === 'teknisi_completed');
      });

      const dailyRevenue = dayOrders.reduce((acc, curr) => acc + (curr.price || 0), 0);
      const dailyOrders = dayOrders.length;

      return {
          month: { revenue: currentRevenue, orders: currentOrders },
          daily: { revenue: dailyRevenue, orders: dailyOrders }
      };
  }, [orders, selectedDate]);

  // Technicians
  const technicians = useMemo(() => users.filter(u => isTechnicianRole(u.role)), [users]);

  // Handle Period Change
  const handlePeriodChange = (val: string) => {
    setPeriodFilter(val);
    const today = new Date();
    let newRange: DateRange | undefined;

    switch(val) {
        case 'this_week':
            newRange = { from: startOfWeek(today, { weekStartsOn: 1 }), to: endOfWeek(today, { weekStartsOn: 1 }) };
            break;
        case 'last_week':
            const lastWeek = subDays(today, 7);
            newRange = { from: startOfWeek(lastWeek, { weekStartsOn: 1 }), to: endOfWeek(lastWeek, { weekStartsOn: 1 }) };
            break;
        case 'this_month':
            newRange = { from: startOfMonth(today), to: endOfMonth(today) };
            break;
        case 'custom':
            newRange = dateRange || { from: today, to: today };
            break;
        default:
            newRange = { from: today, to: today };
    }
    
    if (val !== 'custom') {
        setDateRange(newRange);
    }
  };

  // Fetch Shifts (Only for Daily View)
  useEffect(() => {
    const fetchShifts = async () => {
      if (activeTab !== 'daily') return;

      setIsLoading(prev => prev && true); // Only show loading spinner on first load, not polling
      const dateKey = format(selectedDate, 'yyyy-MM-dd');
      const shiftResults: Record<string, any> = {};
      const headers = await getSessionBackedEdgeHeaders({ includeJsonContentType: true });

      await Promise.all(technicians.map(async (tech) => {
        try {
          const url = buildMakeServerUrl(`/shifts/${tech.id}/${dateKey}`);
          const response = await fetch(url, { headers });
          if (response.ok) {
            const data = await response.json();
            if (data && data.status) {
              shiftResults[tech.id] = data;
            }
          }
        } catch (e) {
          console.error(`Failed to fetch shift for ${tech.name}`, e);
        }
      }));

      setShifts(shiftResults);
      setIsLoading(false);
    };

    if (technicians.length > 0) {
      fetchShifts();
    } else {
      setIsLoading(false);
    }
  }, [selectedDate, technicians, activeTab, refreshTrigger]);

  // Periodic refresh for shift status. Keep this conservative because it fans out per technician.
  useEffect(() => {
    if (activeTab !== 'daily') return;
    
    const interval = setInterval(() => {
        if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
        setRefreshTrigger(prev => prev + 1);
    }, shiftRefreshMs);

    return () => clearInterval(interval);
  }, [activeTab, shiftRefreshMs]);

  // Handle Reset Shift
  const handleResetShift = async (techId: string, techName: string) => {
      // Confirmation handled by AlertDialog
      const dateKey = format(selectedDate, 'yyyy-MM-dd');
      const url = buildMakeServerUrl(`/shifts/${techId}/${dateKey}`);
      
      try {
          const headers = await getSessionBackedEdgeHeaders();
          const response = await fetch(url, {
              method: 'DELETE',
              headers,
          });
          
          if (response.ok) {
              toast.success(`Absensi ${techName} berhasil di-reset`);
              setRefreshTrigger(prev => prev + 1);
          } else {
              toast.error("Gagal melakukan reset");
          }
      } catch (e) {
          console.error("Reset error", e);
          toast.error("Terjadi kesalahan sistem");
      }
  };

  // --- Calculate Target Progress ---
  const targetProgress = useMemo(() => {
      if (!monthlyTarget) return null;
      
      const revPct = monthlyTarget.revenue > 0 ? (achievementStats.month.revenue / monthlyTarget.revenue) * 100 : 0;
      const ordPct = monthlyTarget.orders > 0 ? (achievementStats.month.orders / monthlyTarget.orders) * 100 : 0;
      
      return {
          revenue: Math.min(100, revPct),
          orders: Math.min(100, ordPct),
          daily_revenue_achieved: achievementStats.daily.revenue >= monthlyTarget.daily_revenue,
          daily_orders_achieved: achievementStats.daily.orders >= monthlyTarget.daily_orders
      };
  }, [monthlyTarget, achievementStats]);

  // Calculate Stats
  const techStats = useMemo(() => {
    // Define time window
    let start: Date, end: Date;

    if (activeTab === 'daily') {
        start = startOfDay(selectedDate);
        end = endOfDay(selectedDate);
    } else {
        if (!dateRange?.from) return [];
        start = startOfDay(dateRange.from);
        end = dateRange.to ? endOfDay(dateRange.to) : endOfDay(dateRange.from);
    }

    return technicians.map(tech => {
      const shift = activeTab === 'daily' ? shifts[tech.id] : null; 
      
      const rangeOrders = orders.filter(o => {
        if (!o.technicianId || o.technicianId !== tech.id) return false;
        if (!o.serviceDate) return false;
        
        const oDate = parseISO(o.serviceDate); 
        return isWithinInterval(oDate, { start, end });
      });

      const completedOrders = rangeOrders.filter(o => o.status === 'done' || o.status === 'teknisi_completed');
      const cancelledOrders = rangeOrders.filter(o => o.status === 'cancelled');
      const activeOrders = rangeOrders.filter(o => ['otw', 'processing', 'working'].includes(o.status || ''));

      let totalTravelMinutes = 0;
      let totalWorkMinutes = 0;

      rangeOrders.forEach((o: any) => {
        if (o.startTravelAt && (o.arrivedAt || o.startedAt)) {
             const s = parseISO(o.startTravelAt);
             const e = o.arrivedAt ? parseISO(o.arrivedAt) : (o.startedAt ? parseISO(o.startedAt) : new Date());
             const diff = differenceInMinutes(e, s);
             if (diff > 0 && diff < 180) totalTravelMinutes += diff; 
        }

        if (o.startedAt && o.completedAt) {
            const s = parseISO(o.startedAt);
            const e = parseISO(o.completedAt);
            const diff = differenceInMinutes(e, s);
            if (diff > 0 && diff < 480) totalWorkMinutes += diff; 
        }
      });

      return {
        tech,
        shift,
        orders: {
          total: rangeOrders.length,
          completed: completedOrders.length,
          cancelled: cancelledOrders.length,
          active: activeOrders.length,
          list: rangeOrders
        },
        metrics: {
          travelTime: totalTravelMinutes,
          workTime: totalWorkMinutes
        }
      };
    });
  }, [technicians, shifts, orders, selectedDate, dateRange, activeTab]);

  // Summary
  const summary = useMemo(() => {
    const activeTechs = activeTab === 'daily' 
        ? techStats.filter(t => t.shift?.status === 'active' || t.shift?.status === 'completed').length 
        : techStats.filter(t => t.orders.total > 0).length;

    const totalJobsDone = techStats.reduce((acc, curr) => acc + curr.orders.completed, 0);
    const totalJobsPending = techStats.reduce((acc, curr) => acc + curr.orders.active, 0);
    
    return { activeTechs, totalJobsDone, totalJobsPending };
  }, [techStats, activeTab]);

  const formatTime = (minutes: number) => {
      if (minutes === 0) return '0m';
      const h = Math.floor(minutes / 60);
      const m = minutes % 60;
      if (h > 0) return `${h}j ${m}m`;
      return `${m}m`;
  };

  const formatClock = (isoString?: string) => {
      if (!isoString) return '-';
      return format(parseISO(isoString), 'HH:mm');
  };

  const formatRangeDisplay = () => {
      if (!dateRange?.from) return 'Pilih Tanggal';
      if (!dateRange.to || isSameDay(dateRange.from, dateRange.to)) {
          return format(dateRange.from, "d MMM yyyy", { locale: localeId });
      }
      return `${format(dateRange.from, "d MMM")} - ${format(dateRange.to, "d MMM yyyy")}`;
  };

  const dailyDateRange = useMemo<DateRange>(() => ({
      from: selectedDate,
      to: selectedDate,
  }), [selectedDate]);

  const setDailyDateRange = React.useCallback((range?: DateRange) => {
      const nextDate = range?.from || range?.to;
      if (nextDate) setSelectedDate(nextDate);
  }, []);

  const setPeriodDateRange = React.useCallback((range?: DateRange) => {
      setDateRange(range);
      setPeriodFilter('custom');
  }, []);

  return (
    <div className="fieldActivityPage opsPageShell font-sans text-slate-800 dark:text-slate-200">
      
      {/* Top Header Section */}
      <div className="fieldActivityHeaderBlock">
          <div className="fieldActivityTopbar">
            <div>
                <div className="fieldActivityTitleRow">
                    <h1>Aktivitas Teknisi</h1>
                    <span className="relative flex h-2.5 w-2.5">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                      <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500"></span>
                    </span>
                    <span className="fieldActivityLiveBadge">Live</span>
                </div>
                <p>Monitor kinerja teknisi, absensi harian, dan rekapitulasi pekerjaan.</p>
            </div>
          </div>

          {/* Controls Bar */}
          <div className="fieldActivityControlPanel surfacePanel filterPanel">
             
             {/* Tab Switcher (Segmented Control) */}
             <div className="fieldActivityTabs">
                <button
                    onClick={() => setActiveTab('daily')}
                    className={cn("fieldActivityTab", activeTab === 'daily' && "isActive")}
                >
                    <List className="w-4 h-4" />
                    Harian
                </button>
                <button
                    onClick={() => setActiveTab('period')}
                    className={cn("fieldActivityTab", activeTab === 'period' && "isActive")}
                >
                    <CalendarRange className="w-4 h-4" />
                    Periode
                </button>
                {/* Target Button */}
                {canManageTargets && (
                    <button 
                        onClick={() => setIsTargetModalOpen(prev => !prev)}
                        className={cn("fieldActivityTab", isTargetModalOpen && "isActive")}
                    >
                        <Terminal className="w-4 h-4" />
                        Target Console
                    </button>
                )}
             </div>

             {/* Date Controls */}
             <div className="fieldActivityDateControls">
                
                {activeTab === 'daily' ? (
                    // Daily View Controls
                    <div className="fieldActivityDailyPicker">
                        <Button variant="ghost" size="icon" className="fieldActivityDateNav" onClick={() => setSelectedDate(d => subDays(d, 1))}>
                            <ChevronRight className="w-4 h-4 rotate-180" />
                        </Button>
                        <FoundationDateRangePicker
                            date={dailyDateRange}
                            setDate={setDailyDateRange}
                            numberOfMonths={1}
                            className="fieldActivityDatePicker"
                            contentClassName="fieldActivityDatePopover"
                        />
                        <Button variant="ghost" size="icon" className="fieldActivityDateNav" onClick={() => setSelectedDate(d => addDays(d, 1))}>
                            <ChevronRight className="w-4 h-4" />
                        </Button>
                    </div>
                ) : (
                    // Period View Controls
                    <>
                        <Select value={periodFilter} onValueChange={handlePeriodChange}>
                            <SelectTrigger className="fieldActivityPeriodSelect">
                                <SelectValue placeholder="Pilih Periode" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="this_week">Minggu Ini</SelectItem>
                                <SelectItem value="last_week">Minggu Lalu</SelectItem>
                                <SelectItem value="this_month">Bulan Ini</SelectItem>
                                <SelectItem value="custom">Custom Range</SelectItem>
                            </SelectContent>
                        </Select>

                        <FoundationDateRangePicker
                            date={dateRange}
                            setDate={setPeriodDateRange}
                            className="fieldActivityDatePicker"
                            contentClassName="fieldActivityDatePopover"
                        />
                    </>
                )}
             </div>
          </div>
      </div>

      {/* Target Manager Console */}
      {canManageTargets && isTargetModalOpen && (
          <div className="fieldActivityTargetConsole animate-in slide-in-from-top-4 duration-300">
              <TargetManager 
                  month={selectedDate} 
                  onClose={() => setIsTargetModalOpen(false)} 
                  onUpdate={() => setTargetRefresh(prev => prev + 1)} 
                  className="h-auto min-h-[500px] border-slate-200 shadow-md mb-2"
                  defaultShowPrompt={true}
              />
          </div>
      )}

      {/* Target Progress Section (New) */}
      {monthlyTarget && (monthlyTarget.revenue > 0 || monthlyTarget.orders > 0) && (
          <div className="fieldActivityTargetGrid grid grid-cols-1 lg:grid-cols-2 gap-4">
              {/* Revenue Target */}
              <Card className="border-blue-100 dark:border-blue-900/40 bg-gradient-to-br from-white to-blue-50/50 dark:from-slate-900 dark:to-blue-950/30 shadow-sm relative overflow-hidden">
                  <div className="absolute top-0 right-0 p-3 opacity-10"><BarChart className="w-24 h-24 text-blue-600" /></div>
                  <CardContent className="p-5 relative z-10">
                      <div className="flex justify-between items-start mb-4">
                          <div>
                              <p className="text-xs font-bold text-blue-500 uppercase tracking-wider mb-1">Target Omzet ({format(selectedDate, 'MMM')})</p>
                              <div className="flex items-baseline gap-2">
                                  <h3 className="text-2xl font-bold text-slate-900 dark:text-slate-100">
                                      Rp {achievementStats.month.revenue.toLocaleString('id-ID')}
                                  </h3>
                                  <span className="text-sm text-slate-400 font-medium">
                                      / {monthlyTarget.revenue.toLocaleString('id-ID')}
                                  </span>
                              </div>
                          </div>
                          <div className="text-right">
                              <span className={cn(
                                  "text-lg font-bold block",
                                  targetProgress!.revenue >= 100 ? "text-emerald-600" : "text-blue-600"
                              )}>
                                  {targetProgress!.revenue.toFixed(1)}%
                              </span>
                          </div>
                      </div>
                      <Progress value={targetProgress!.revenue} className="h-2 bg-blue-100 dark:bg-blue-900/40" indicatorClassName={targetProgress!.revenue >= 100 ? "bg-emerald-500" : "bg-blue-500"} />
                      
                      <div className="mt-4 pt-4 border-t border-blue-100 dark:border-blue-900/40 flex justify-between items-center text-sm">
                          <div className="flex flex-col">
                              <span className="text-slate-500 dark:text-slate-400 text-xs">Pencapaian Hari Ini</span>
                              <span className={cn("font-bold", targetProgress!.daily_revenue_achieved ? "text-emerald-600" : "text-amber-600")}>
                                  Rp {achievementStats.daily.revenue.toLocaleString('id-ID')}
                              </span>
                          </div>
                          <div className="flex flex-col text-right">
                              <span className="text-slate-500 dark:text-slate-400 text-xs">Target Harian</span>
                              <span className="font-bold text-slate-700 dark:text-slate-300">
                                  Rp {monthlyTarget.daily_revenue.toLocaleString('id-ID')}
                              </span>
                          </div>
                      </div>
                  </CardContent>
              </Card>

              {/* Order Target */}
              <Card className="border-purple-100 dark:border-purple-900/40 bg-gradient-to-br from-white to-purple-50/50 dark:from-slate-900 dark:to-purple-950/30 shadow-sm relative overflow-hidden">
                  <div className="absolute top-0 right-0 p-3 opacity-10"><Target className="w-24 h-24 text-purple-600" /></div>
                  <CardContent className="p-5 relative z-10">
                      <div className="flex justify-between items-start mb-4">
                          <div>
                              <p className="text-xs font-bold text-purple-500 uppercase tracking-wider mb-1">Target Order ({format(selectedDate, 'MMM')})</p>
                              <div className="flex items-baseline gap-2">
                                  <h3 className="text-2xl font-bold text-slate-900 dark:text-slate-100">
                                      {achievementStats.month.orders}
                                  </h3>
                                  <span className="text-sm text-slate-400 font-medium">
                                      / {monthlyTarget.orders} Unit
                                  </span>
                              </div>
                          </div>
                          <div className="text-right">
                              <span className={cn(
                                  "text-lg font-bold block",
                                  targetProgress!.orders >= 100 ? "text-emerald-600" : "text-purple-600"
                              )}>
                                  {targetProgress!.orders.toFixed(1)}%
                              </span>
                          </div>
                      </div>
                      <Progress value={targetProgress!.orders} className="h-2 bg-purple-100 dark:bg-purple-900/40" indicatorClassName={targetProgress!.orders >= 100 ? "bg-emerald-500" : "bg-purple-500"} />
                      
                      <div className="mt-4 pt-4 border-t border-purple-100 dark:border-purple-900/40 flex justify-between items-center text-sm">
                          <div className="flex flex-col">
                              <span className="text-slate-500 dark:text-slate-400 text-xs">Selesai Hari Ini</span>
                              <span className={cn("font-bold", targetProgress!.daily_orders_achieved ? "text-emerald-600" : "text-amber-600")}>
                                  {achievementStats.daily.orders} Unit
                              </span>
                          </div>
                          <div className="flex flex-col text-right">
                              <span className="text-slate-500 dark:text-slate-400 text-xs">Target Harian</span>
                              <span className="font-bold text-slate-700 dark:text-slate-300">
                                  {monthlyTarget.daily_orders} Unit
                              </span>
                          </div>
                      </div>
                  </CardContent>
              </Card>
          </div>
      )}

      {/* Summary Stats Cards */}
      <div className="fieldActivitySummaryGrid grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card className="fieldActivityMetricCard bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm rounded-xl overflow-hidden group hover:shadow-md transition-shadow">
              <CardContent className="p-0 flex h-full">
                  <div className="w-1.5 bg-blue-500 h-full shrink-0 group-hover:w-2 transition-all"></div>
                  <div className="p-5 flex items-center gap-4 w-full">
                      <div className="w-12 h-12 rounded-full bg-blue-50 dark:bg-blue-900/30 flex items-center justify-center text-blue-600 dark:text-blue-400 shrink-0">
                          {activeTab === 'daily' ? <User className="w-6 h-6" /> : <LayoutList className="w-6 h-6" />}
                      </div>
                      <div>
                          <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">
                              {activeTab === 'daily' ? 'Teknisi Aktif' : 'Teknisi Terlibat'}
                          </p>
                          <div className="flex items-baseline gap-1">
                              <h3 className="text-2xl font-bold text-slate-900 dark:text-slate-100">{summary.activeTechs}</h3>
                              <span className="text-sm text-slate-400 font-medium">/ {technicians.length}</span>
                          </div>
                      </div>
                  </div>
              </CardContent>
          </Card>
          
          <Card className="fieldActivityMetricCard bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm rounded-xl overflow-hidden group hover:shadow-md transition-shadow">
              <CardContent className="p-0 flex h-full">
                  <div className="w-1.5 bg-emerald-500 h-full shrink-0 group-hover:w-2 transition-all"></div>
                  <div className="p-5 flex items-center gap-4 w-full">
                      <div className="w-12 h-12 rounded-full bg-emerald-50 dark:bg-emerald-900/30 flex items-center justify-center text-emerald-600 dark:text-emerald-400 shrink-0">
                          <CheckCircle2 className="w-6 h-6" />
                      </div>
                      <div>
                          <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">Total Selesai</p>
                          <h3 className="text-2xl font-bold text-slate-900 dark:text-slate-100">{summary.totalJobsDone}</h3>
                      </div>
                  </div>
              </CardContent>
          </Card>

          <Card className="fieldActivityMetricCard bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm rounded-xl overflow-hidden group hover:shadow-md transition-shadow">
              <CardContent className="p-0 flex h-full">
                  <div className="w-1.5 bg-amber-500 h-full shrink-0 group-hover:w-2 transition-all"></div>
                  <div className="p-5 flex items-center gap-4 w-full">
                      <div className="w-12 h-12 rounded-full bg-amber-50 dark:bg-amber-900/30 flex items-center justify-center text-amber-600 dark:text-amber-400 shrink-0">
                          <TrendingUp className="w-6 h-6" />
                      </div>
                      <div>
                          <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">
                              {activeTab === 'daily' ? 'Sedang Berlangsung' : 'Total Pending'}
                          </p>
                          <h3 className="text-2xl font-bold text-slate-900 dark:text-slate-100">{summary.totalJobsPending}</h3>
                      </div>
                  </div>
              </CardContent>
          </Card>
      </div>

      {/* Main Content List */}
      <div className="fieldActivityRoster space-y-4">
          <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-2">
            <div className="flex items-center gap-2 text-slate-800 dark:text-slate-200">
                <Briefcase className="w-5 h-5 text-slate-500 dark:text-slate-400" />
                <h2 className="text-lg font-bold">{activeTab === 'daily' ? 'Detail Harian' : 'Rincian Periode'}</h2>
            </div>
            {activeTab === 'period' && (
                <span className="text-xs font-medium text-slate-500 dark:text-slate-400 bg-slate-100 dark:bg-slate-800 px-2 py-1 rounded">
                    {formatRangeDisplay()}
                </span>
            )}
          </div>

          {isLoading ? (
              <div className="flex justify-center py-20">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-slate-900 dark:border-slate-100"></div>
              </div>
          ) : (
            <div className="grid grid-cols-1 gap-4">
                {techStats.map(({ tech, shift, orders, metrics }) => (
                    <Card key={tech.id} className="fieldActivityTechnicianCard overflow-hidden border border-slate-200 dark:border-slate-800 shadow-sm bg-white dark:bg-slate-900 rounded-xl transition-all hover:shadow-md">
                        <div className="flex flex-col lg:flex-row">
                            
                            {/* Left: Profile & Info */}
                            <div className="w-full lg:w-[280px] bg-white dark:bg-slate-900 p-6 flex flex-col justify-center border-b lg:border-b-0 lg:border-r border-slate-100 dark:border-slate-800">
                                <div className="flex items-center gap-4 mb-6">
                                    <div className="w-14 h-14 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center overflow-hidden border border-slate-200 dark:border-slate-700 shrink-0">
                                        {tech.avatar ? (
                                            <img src={tech.avatar} alt={tech.name} className="w-full h-full object-cover" />
                                        ) : (
                                            <User className="w-6 h-6 text-slate-400" />
                                        )}
                                    </div>
                                    <div>
                                        <h4 className="font-bold text-slate-900 dark:text-slate-100 line-clamp-1 text-base">{tech.name}</h4>
                                        <p className="text-xs text-slate-500 dark:text-slate-400 line-clamp-1">{tech.email}</p>
                                    </div>
                                </div>
                                
                                {activeTab === 'daily' ? (
                                    /* Daily View Left Side Info */
                                    <div className="space-y-4">
                                        <div className="flex justify-between items-center text-sm">
                                            <div className="flex items-center gap-1">
                                                <span className="text-slate-500 font-medium text-xs uppercase tracking-wide">Status Absen</span>
                                                {canManageAttendance && (
                                                    <>
                                                        <ShiftEditDialog 
                                                            tech={tech} 
                                                            shift={shift} 
                                                            date={selectedDate} 
                                                            onSave={() => setRefreshTrigger(prev => prev + 1)} 
                                                        />
                                                        {isSameDay(selectedDate, new Date()) && shift && (
                                                            <AlertDialog>
                                                                <AlertDialogTrigger asChild>
                                                                    <Button 
                                                                        variant="ghost" 
                                                                        size="sm" 
                                                                        className="h-6 w-6 p-0 text-slate-400 hover:text-red-600 rounded-full ml-1"
                                                                        title="Reset Absen Hari Ini"
                                                                    >
                                                                        <Trash2 className="w-3 h-3" />
                                                                    </Button>
                                                                </AlertDialogTrigger>
                                                                <AlertDialogContent>
                                                                    <AlertDialogHeader>
                                                                        <AlertDialogTitle>Reset Absensi Hari Ini?</AlertDialogTitle>
                                                                        <AlertDialogDescription>
                                                                            Anda akan menghapus data absensi (jam masuk/pulang) milik <strong>{tech.name}</strong> untuk hari ini.
                                                                            <br/><br/>
                                                                            Tindakan ini tidak dapat dibatalkan dan teknisi harus absen ulang.
                                                                        </AlertDialogDescription>
                                                                    </AlertDialogHeader>
                                                                    <AlertDialogFooter>
                                                                        <AlertDialogCancel>Batal</AlertDialogCancel>
                                                                        <AlertDialogAction variant="danger"
                                                                            onClick={() => handleResetShift(tech.id, tech.name)}
                                                                            className="bg-red-600 hover:bg-red-700 text-white border-red-600"
                                                                        >
                                                                            Reset Absen
                                                                        </AlertDialogAction>
                                                                    </AlertDialogFooter>
                                                                </AlertDialogContent>
                                                            </AlertDialog>
                                                        )}
                                                    </>
                                                )}
                                            </div>
                                            {shift?.status === 'active' ? (
                                                <Badge className="bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-100 dark:hover:bg-emerald-900/40 border border-emerald-200 dark:border-emerald-700/40 px-3 py-0.5 h-6">Masuk</Badge>
                                            ) : shift?.status === 'completed' ? (
                                                <Badge variant="outline" className="text-slate-600 dark:text-slate-400 border-slate-300 dark:border-slate-600 px-3 h-6">Selesai</Badge>
                                            ) : (
                                                <Badge variant="outline" className="text-slate-400 dark:text-slate-500 border-dashed px-3 h-6 bg-slate-50 dark:bg-slate-800">Belum Mulai</Badge>
                                            )}
                                        </div>

                                        <div className="grid grid-cols-2 gap-3">
                                            <div className="p-3 rounded-lg border border-slate-100 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-800/50">
                                                <span className="block text-[10px] text-slate-400 font-bold uppercase mb-1">Masuk</span>
                                                <span className="font-mono text-lg font-bold text-slate-700 dark:text-slate-300 dark:text-slate-300">{formatClock(shift?.startTime)}</span>
                                            </div>
                                            <div className="p-3 rounded-lg border border-slate-100 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-800/50">
                                                <span className="block text-[10px] text-slate-400 font-bold uppercase mb-1">Pulang</span>
                                                <span className="font-mono text-lg font-bold text-slate-700 dark:text-slate-300 dark:text-slate-300">{formatClock(shift?.endTime)}</span>
                                            </div>
                                        </div>

                                        {shift?.startLocation && (
                                            <div className="flex items-center gap-2 text-[11px] text-blue-600 dark:text-blue-400 bg-blue-50/50 dark:bg-blue-900/20 p-2 rounded border border-blue-50 dark:border-blue-900/30">
                                                <MapPin className="w-3.5 h-3.5 shrink-0" />
                                                <a 
                                                    href={`https://www.google.com/maps?q=${shift.startLocation.lat},${shift.startLocation.lng}`}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    className="hover:underline line-clamp-1 font-medium"
                                                >
                                                    Lokasi Absen Masuk
                                                </a>
                                            </div>
                                        )}
                                    </div>
                                ) : (
                                    /* Period View Left Side Info */
                                    <div className="space-y-4">
                                        <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-800/50 border border-slate-100 dark:border-slate-700">
                                            <div className="flex justify-between items-center mb-2">
                                                <span className="text-xs text-slate-500">Performa</span>
                                                <span className="text-xs font-bold text-slate-700 dark:text-slate-300">
                                                    {orders.total > 0 ? Math.round((orders.completed / orders.total) * 100) : 0}%
                                                </span>
                                            </div>
                                            <div className="w-full bg-slate-200 dark:bg-slate-700 rounded-full h-1.5">
                                                <div 
                                                    className="bg-emerald-500 h-1.5 rounded-full transition-all duration-500" 
                                                    style={{ width: `${orders.total > 0 ? (orders.completed / orders.total) * 100 : 0}%` }}
                                                ></div>
                                            </div>
                                        </div>
                                        <div className="grid grid-cols-2 gap-2 text-center">
                                            <div className="p-2 border border-slate-100 dark:border-slate-700 rounded bg-white dark:bg-slate-800">
                                                <span className="block text-xl font-bold text-emerald-600">{orders.completed}</span>
                                                <span className="text-[10px] text-slate-400 uppercase font-bold">Done</span>
                                            </div>
                                            <div className="p-2 border border-slate-100 dark:border-slate-700 rounded bg-white dark:bg-slate-800">
                                                <span className="block text-xl font-bold text-red-500">{orders.cancelled}</span>
                                                <span className="text-[10px] text-slate-400 uppercase font-bold">Batal</span>
                                            </div>
                                        </div>
                                    </div>
                                )}
                            </div>

                            {/* Right: Stats & Timeline */}
                            <div className="flex-1 p-6">
                                {/* Stats Row */}
                                <div className="grid grid-cols-2 sm:grid-cols-4 gap-6 mb-8 border-b border-dashed border-slate-100 dark:border-slate-700 pb-6">
                                    <div>
                                        <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider mb-1">TOTAL PESANAN</p>
                                        <p className="text-2xl font-bold text-slate-900 dark:text-slate-100">{orders.total}</p>
                                    </div>
                                    {activeTab === 'daily' && (
                                    <div>
                                        <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider mb-1">SELESAI</p>
                                        <p className="text-2xl font-bold text-emerald-600">{orders.completed}</p>
                                    </div>
                                    )}
                                    <div>
                                        <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider mb-1">DURASI KERJA</p>
                                        <div className="flex items-center gap-1.5 text-slate-800 dark:text-slate-200">
                                            <Clock className="w-4 h-4 text-blue-500" />
                                            <span className="text-lg font-bold">{formatTime(metrics.workTime)}</span>
                                        </div>
                                        <p className="text-[10px] text-slate-400 mt-1">
                                            {activeTab === 'daily' ? 'Estimasi total pengerjaan' : 'Total jam kerja'}
                                        </p>
                                    </div>
                                    <div>
                                        <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider mb-1">PERJALANAN</p>
                                        <div className="flex items-center gap-1.5 text-slate-800 dark:text-slate-200">
                                            <Map className="w-4 h-4 text-amber-500" />
                                            <span className="text-lg font-bold">{formatTime(metrics.travelTime)}</span>
                                        </div>
                                        <p className="text-[10px] text-slate-400 mt-1">
                                            {activeTab === 'daily' ? 'Estimasi waktu OTW' : 'Total perjalanan'}
                                        </p>
                                    </div>
                                </div>

                                {/* Timeline / List */}
                                <div>
                                    <div className="flex items-center justify-between mb-4">
                                        <h5 className="text-xs font-bold text-slate-900 dark:text-slate-100 uppercase tracking-wide">
                                            {activeTab === 'daily' ? 'DAFTAR KUNJUNGAN' : 'RIWAYAT PEKERJAAN'}
                                        </h5>
                                        {activeTab === 'daily' && (
                                            <span className="text-[10px] font-medium text-slate-500 dark:text-slate-400 px-2 py-0.5 bg-slate-100 dark:bg-slate-800 rounded-full border border-slate-200 dark:border-slate-700">
                                                Urutan waktu
                                            </span>
                                        )}
                                    </div>
                                    
                                    {orders.list.length === 0 ? (
                                        <div className="w-full h-24 border-2 border-dashed border-slate-100 dark:border-slate-700 rounded-xl flex items-center justify-center text-slate-300 text-sm">
                                            {activeTab === 'daily' ? 'Tidak ada jadwal kunjungan' : 'Tidak ada data pekerjaan'}
                                        </div>
                                    ) : (
                                        <div className={cn("space-y-2", activeTab === 'period' && "max-h-[300px] overflow-y-auto pr-2 custom-scrollbar")}>
                                            {orders.list
                                                .sort((a,b) => {
                                                    const dateA = new Date(`${a.serviceDate}T${a.serviceTime || '00:00'}`);
                                                    const dateB = new Date(`${b.serviceDate}T${b.serviceTime || '00:00'}`);
                                                    return activeTab === 'daily' 
                                                        ? dateA.getTime() - dateB.getTime() // Ascending for daily
                                                        : dateB.getTime() - dateA.getTime(); // Descending for period (newest first)
                                                })
                                                .map((order: any, idx) => (
                                                <div key={order.id} className="flex items-center gap-4 p-3 rounded-lg border border-slate-100 dark:border-slate-800 hover:border-blue-200 dark:hover:border-blue-700 hover:bg-blue-50/30 dark:hover:bg-blue-900/20 transition-all group bg-white dark:bg-slate-900">
                                                    <div className="w-8 h-8 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center font-bold text-xs text-slate-500 dark:text-slate-400 shrink-0 group-hover:bg-white group-hover:shadow-sm">
                                                        {idx + 1}
                                                    </div>
                                                    
                                                    <div className="min-w-[100px]">
                                                        {activeTab === 'period' && (
                                                            <p className="text-[10px] text-slate-400 font-semibold mb-0.5">
                                                                {format(parseISO(order.serviceDate), "d MMM yyyy")}
                                                            </p>
                                                        )}
                                                        <p className="text-sm font-bold text-slate-800 dark:text-slate-200">{order.serviceTime}</p>
                                                        <Badge variant="outline" className={cn(
                                                            "text-[10px] h-5 px-1.5 border-none mt-1 font-medium",
                                                            order.status === 'done' || order.status === 'teknisi_completed' ? "bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300" :
                                                            order.status === 'cancelled' ? "bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300" :
                                                            order.status === 'pending' || order.status === 'waiting' ? "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400" :
                                                            "bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300"
                                                        )}>
                                                            {order.status === 'teknisi_completed' ? 'Done' : order.status}
                                                        </Badge>
                                                    </div>
                                                    
                                                    <div className="flex-1 min-w-0 border-l border-slate-100 dark:border-slate-700 pl-4">
                                                        <div className="flex justify-between items-start">
                                                            <div>
                                                                <p className="text-sm font-bold text-slate-900 dark:text-slate-100 truncate">{order.customerName}</p>
                                                                <p className="text-xs text-slate-500 dark:text-slate-400 truncate mt-0.5 w-full max-w-[200px] sm:max-w-md">
                                                                    {order.serviceCategory} • {order.address}
                                                                </p>
                                                            </div>
                                                        </div>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                    </Card>
                ))}
            </div>
          )}
      </div>
    </div>
  );
}

function ShiftEditDialog({ tech, shift, date, onSave }: { tech: any, shift: any, date: Date, onSave: () => void }) {
    const [open, setOpen] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    
    // Form States
    const [status, setStatus] = useState(shift?.status || 'idle');
    const [startTime, setStartTime] = useState(shift?.startTime ? format(parseISO(shift.startTime), 'HH:mm') : '');
    const [endTime, setEndTime] = useState(shift?.endTime ? format(parseISO(shift.endTime), 'HH:mm') : '');

    // Reset form on open
    useEffect(() => {
        if (open) {
            setStatus(shift?.status || 'idle');
            setStartTime(shift?.startTime ? format(parseISO(shift.startTime), 'HH:mm') : '');
            setEndTime(shift?.endTime ? format(parseISO(shift.endTime), 'HH:mm') : '');
        }
    }, [open, shift]);

    const handleSave = async () => {
        setIsLoading(true);
        try {
            // Construct ISO strings
            const dateStr = format(date, 'yyyy-MM-dd');
            
            let startIso = null;
            if (startTime) {
                // Use the selected date but with the new time
                const [h, m] = startTime.split(':').map(Number);
                const d = new Date(date);
                d.setHours(h, m, 0, 0);
                // Adjust for timezone offset if necessary, but ISO string usually uses UTC or local
                // Here we want to preserve local time intention. 
                // Using toISOString() converts to UTC.
                // If the backend expects ISO, that's fine.
                // However, `date-fns` `format` uses local time. 
                // Let's ensure we construct a date object that represents the local time entered.
                startIso = format(d, "yyyy-MM-dd'T'HH:mm:ss");
            }
            
            let endIso = null;
            if (endTime) {
                const [h, m] = endTime.split(':').map(Number);
                const d = new Date(date);
                d.setHours(h, m, 0, 0);
                endIso = format(d, "yyyy-MM-dd'T'HH:mm:ss");
            }

            const newData = {
                ...shift, // preserve location if any
                status,
                startTime: startIso,
                endTime: endIso
            };

            const url = buildMakeServerUrl('/shifts');
            const headers = await getSessionBackedEdgeHeaders({ includeJsonContentType: true });
            await fetch(url, {
                 method: 'POST',
                 headers,
                 body: JSON.stringify({ userId: tech.id, date: dateStr, data: newData })
             });
             
             toast.success("Shift berhasil diperbarui");
             onSave();
             setOpen(false);
        } catch (e) {
            console.error(e);
            toast.error("Gagal menyimpan shift");
        } finally {
            setIsLoading(false);
        }
    }

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
                <Button variant="ghost" size="sm" className="h-6 w-6 p-0 text-slate-400 hover:text-blue-600 rounded-full ml-2">
                    <Edit className="w-3 h-3" />
                </Button>
            </DialogTrigger>
            <DialogContent className="fieldActivityDialog masterDataFormDialogContent sm:max-w-[425px] bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 z-[9999]">
                <DialogHeader>
                    <DialogTitle>Edit Absensi: {tech.name}</DialogTitle>
                    <DialogDescription>
                        Perbarui status dan waktu shift teknisi secara manual.
                    </DialogDescription>
                </DialogHeader>
                <div className="grid gap-4 py-4">
                    <div className="grid grid-cols-4 items-center gap-4">
                        <Label className="text-right text-slate-600 dark:text-slate-400">Status</Label>
                        <Select value={status} onValueChange={setStatus}>
                            <SelectTrigger className="col-span-3">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent className="z-[10000]">
                                <SelectItem value="idle">Belum Mulai</SelectItem>
                                <SelectItem value="active">Masuk (Active)</SelectItem>
                                <SelectItem value="completed">Selesai</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                    <div className="grid grid-cols-4 items-center gap-4">
                        <Label className="text-right text-slate-600 dark:text-slate-400">Jam Masuk</Label>
                        <Input 
                            type="time" 
                            className="col-span-3"
                            value={startTime}
                            onChange={e => setStartTime(e.target.value)}
                        />
                    </div>
                    <div className="grid grid-cols-4 items-center gap-4">
                        <Label className="text-right text-slate-600 dark:text-slate-400">Jam Pulang</Label>
                        <Input 
                            type="time" 
                            className="col-span-3"
                            value={endTime}
                            onChange={e => setEndTime(e.target.value)}
                        />
                    </div>
                </div>
                <DialogFooter>
                    <Button onClick={handleSave} disabled={isLoading}>
                        {isLoading ? 'Menyimpan...' : 'Simpan Perubahan'}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
