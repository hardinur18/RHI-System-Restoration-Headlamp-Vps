import React, { useState, useMemo } from 'react';
import { useMasterData } from '@/app/pages/master-data/context';
import { usePermissions } from '@/app/hooks/usePermissions';
import { 
  ChevronDown, 
  ChevronRight, 
  TrendingUp, 
  Target, 
  Globe, 
  MessageCircle,
  Lock,
  Wrench,
  CalendarDays,
  Download,
  Eye,
  EyeOff
} from 'lucide-react';
import { TargetManager } from '../monitoring/TargetManager';
import { Button } from "@/app/components/ui/button";
import { Card } from "@/app/components/ui/card";
import { Badge } from "@/app/components/ui/badge";
import { Progress } from "@/app/components/ui/progress";
import { cn } from "@/app/components/ui/utils";
import { format, parseISO, startOfMonth, endOfMonth, eachDayOfInterval, addMonths, subMonths } from 'date-fns';
import { id } from 'date-fns/locale';
import { isCompletedOrderLike } from './openclaw-foundation';
import { getSessionBackedEdgeHeaders } from '@/app/services/internal/sessionClientHeaders';
import { buildMakeServerUrl } from '@/app/services/internal/functionsBaseUrl';
import { isAdvertiserRole, isCsRole, isTechnicianRole } from '@/app/data/roleHelpers';
import { resolveAdAccountAttribution } from './adAccountAttribution';
import {
  OperationalEmptyState,
  OperationalFilterPanel,
  OperationalKpiCard,
  OperationalKpiGrid,
  OperationalPageHeader,
  OperationalPageShell,
  OperationalTableCard,
} from '@/app/components/ui/operational-page';
import { ActionGroup } from '@/app/components/ui/control-layout';

const isActiveRecord = (status?: string) => status?.toLowerCase() === 'active';

export function MarketingMonitoringPage() {
  const { 
      orders = [], 
      users = [], 
      branches = [], 
      platforms = [], 
      dailyAds = [],
      adAccounts = [],
      adAccountAssignments = [],
      adAccountOwnerAssignments = [],
      currentUser,
      ensureOrdersForDateRange,
  } = useMasterData();

  const { hasPermission } = usePermissions();
  const currentRole = currentUser?.role;
  const canManageTargets = hasPermission('targets.manage');
  
  const [selectedMonth, setSelectedMonth] = useState(new Date());
  const [expandedDates, setExpandedDates] = useState<string[]>([]);
  const [hiddenBranches, setHiddenBranches] = useState<string[]>([]);
  const [isSummaryOpen, setIsSummaryOpen] = useState(true);
  const [isTargetConsoleOpen, setIsTargetConsoleOpen] = useState(false);
  const [targetRefresh, setTargetRefresh] = useState(0);
  const [dbTargets, setDbTargets] = useState<any[]>([]);
  const [visibleDayLimit, setVisibleDayLimit] = useState(8);

  React.useEffect(() => {
    void ensureOrdersForDateRange({
      from: format(startOfMonth(selectedMonth), 'yyyy-MM-dd'),
      to: format(endOfMonth(selectedMonth), 'yyyy-MM-dd'),
      mode: 'created',
    }).catch((error) => {
      console.error('Failed to fetch monthly orders for ads monitoring', error);
    });
  }, [ensureOrdersForDateRange, selectedMonth]);

  // FETCH TARGETS
  React.useEffect(() => {
    let isActive = true;
    const controller = new AbortController();

    const fetchTargets = async () => {
        try {
            const monthKey = format(selectedMonth, 'yyyy-MM');
            const url = buildMakeServerUrl(`/targets/${monthKey}`);
            const headers = await getSessionBackedEdgeHeaders();
            if (!isActive) return;

            const res = await fetch(url, { headers, signal: controller.signal });
            if (!isActive) return;

            if (res.ok) {
                const data = await res.json();
                const list = Array.isArray(data) ? data : (data.targets || []);
                if (isActive) setDbTargets(list);
            } else {
                if (isActive) setDbTargets([]);
            }
        } catch (e) {
            if ((e as Error)?.name === 'AbortError') return;
            console.error("Failed to fetch targets for monitoring", e);
            if (isActive) setDbTargets([]);
        }
    };
    fetchTargets();

    return () => {
      isActive = false;
      controller.abort();
    };
  }, [selectedMonth, targetRefresh]);

  // Handlers for Month Filter
  const handlePrevMonth = () => setSelectedMonth(prev => subMonths(prev, 1));
  const handleNextMonth = () => setSelectedMonth(prev => addMonths(prev, 1));

  const totalDaysInSelectedMonth = useMemo(() => (
    eachDayOfInterval({
      start: startOfMonth(selectedMonth),
      end: endOfMonth(selectedMonth)
    }).length
  ), [selectedMonth]);

  React.useEffect(() => {
    const today = new Date();
    setExpandedDates(
      format(today, 'yyyy-MM') === format(selectedMonth, 'yyyy-MM')
        ? [format(today, 'yyyy-MM-dd')]
        : [],
    );
    setHiddenBranches([]);
    setVisibleDayLimit(8);
  }, [selectedMonth]);
  
  const toggleBranch = (branchKey: string) => {
    setHiddenBranches(prev => 
      prev.includes(branchKey) ? prev.filter(k => k !== branchKey) : [...prev, branchKey]
    );
  };

  // --- SCOPING LOGIC (Reused for Summary & Daily) ---
  const {
    scopedOrders,
    scopedDailyAds,
    scopedTargets,
    visibleAdvIds,
    visibleCsIds,
    visibleBranchIds,
    visibleTechnicianIds,
    isRestrictedScope,
    scopeLabel,
  } = useMemo(() => {
    const isAdv = isAdvertiserRole(currentRole);
    const isCS = isCsRole(currentRole);
    const isTechnician = isTechnicianRole(currentRole);
    
    let visibleAdvIds: string[] | null = null; 
    let visibleCsIds: string[] | null = null; 
    let visibleBranchIds: string[] | null = null;
    let visibleTechnicianIds: string[] | null = null;
    let scopedOrders = orders;
    const resolvedDailyAds = dailyAds.map((ad) => {
        const account = adAccounts.find((item) => item.id === ad.adAccountId);
        if (!account) return ad;

        const resolved = resolveAdAccountAttribution({
            account,
            date: ad.date,
            ownerAssignments: adAccountOwnerAssignments,
            csAssignments: adAccountAssignments,
            preferredCsId: isCS && currentUser ? currentUser.id : ad.csId,
            fallbackToLatestCsAssignment: true,
        });

        return {
            ...ad,
            advertiserId: resolved.advertiserId || ad.advertiserId,
            platformId: resolved.platformId || ad.platformId,
            subChannelId: resolved.subChannelId || ad.subChannelId,
            csId: resolved.csId || ad.csId,
        };
    });
    let scopedDailyAds = resolvedDailyAds;
    let scopeLabel = 'Global';
    
    if (isAdv && currentUser) {
        scopedOrders = orders.filter(o => o.advertiserId === currentUser.id);
        scopedDailyAds = resolvedDailyAds.filter(ad => ad.advertiserId === currentUser.id);
        visibleAdvIds = [currentUser.id];
        const orderCS = Array.from(new Set(scopedOrders.map(o => o.csId).filter(Boolean)));
        const adsCS = Array.from(new Set(scopedDailyAds.map(ad => ad.csId).filter(Boolean)));
        visibleCsIds = Array.from(new Set([...adsCS, ...orderCS]));
        visibleBranchIds = Array.from(new Set(scopedOrders.map(o => o.branchId).filter(Boolean)));
        visibleTechnicianIds = [];
        scopeLabel = 'Advertiser';
    } else if (isCS && currentUser) {
        scopedOrders = orders.filter(o => o.csId === currentUser.id);
        visibleCsIds = [currentUser.id];
        const orderAdvs = Array.from(new Set(scopedOrders.map(o => o.advertiserId).filter(Boolean)));
        scopedDailyAds = resolvedDailyAds.filter(ad => ad.csId === currentUser.id);
        const adsAdvs = Array.from(new Set(scopedDailyAds.map(ad => ad.advertiserId).filter(Boolean)));
        visibleAdvIds = Array.from(new Set([...adsAdvs, ...orderAdvs]));
        visibleBranchIds = Array.from(new Set(scopedOrders.map(o => o.branchId).filter(Boolean)));
        visibleTechnicianIds = [];
        scopeLabel = 'CS';
    } else if (isTechnician && currentUser) {
        scopedOrders = orders.filter(o => o.technicianId === currentUser.id || o.branchId === currentUser.branchId);
        scopedDailyAds = [];
        visibleBranchIds = Array.from(new Set([currentUser.branchId, ...scopedOrders.map(o => o.branchId)].filter(Boolean)));
        visibleTechnicianIds = [currentUser.id];
        scopeLabel = 'Teknisi';
    }

    const isRestrictedScope = Boolean(isAdv || isCS || isTechnician);
    const scopedTargets = isRestrictedScope
      ? dbTargets.filter((target: any) => {
          if (visibleAdvIds && target.advertiserId) return visibleAdvIds.includes(target.advertiserId);
          if (visibleCsIds && target.csId) return visibleCsIds.includes(target.csId);
          if (visibleBranchIds && target.branchId) return visibleBranchIds.includes(target.branchId);
          return false;
        })
      : dbTargets;
    
    return {
      scopedOrders,
      scopedDailyAds,
      scopedTargets,
      visibleAdvIds,
      visibleCsIds,
      visibleBranchIds,
      visibleTechnicianIds,
      isRestrictedScope,
      scopeLabel,
    };
  }, [
    adAccountAssignments,
    adAccountOwnerAssignments,
    adAccounts,
    orders,
    dailyAds,
    dbTargets,
    currentRole,
    currentUser,
  ]);

  // --- SUMMARY METRICS CALCULATION ---
  const summaryMetrics = useMemo(() => {
    const start = startOfMonth(selectedMonth);
    const end = endOfMonth(selectedMonth);
    const monthlyTargetLeads = scopedTargets.reduce((acc, t) => acc + (t.leadsTarget || 0), 0);
    const daysInCurrentMonth = eachDayOfInterval({ start, end }).length;
    const dailyTargetEst = Math.ceil(monthlyTargetLeads / daysInCurrentMonth);

    const advStatsById = new Map<string, { leads: number; closing: number; spend: number }>();
    const csStatsById = new Map<string, { leads: number; closing: number; omzet: number }>();
    const platformStatsById = new Map<string, { leads: number; closing: number }>();
    let totalLeads = 0;
    let totalClosing = 0;

    scopedOrders.forEach((order) => {
        if (!order.created_at) return;
        const orderDate = parseISO(order.created_at);
        if (orderDate < start || orderDate > end) return;

        totalLeads += 1;
        const closed = isCompletedOrderLike(order);
        if (closed) totalClosing += 1;

        if (order.advertiserId) {
            const current = advStatsById.get(order.advertiserId) || { leads: 0, closing: 0, spend: 0 };
            current.leads += 1;
            if (closed) current.closing += 1;
            advStatsById.set(order.advertiserId, current);
        }

        if (order.csId) {
            const current = csStatsById.get(order.csId) || { leads: 0, closing: 0, omzet: 0 };
            current.leads += 1;
            if (closed) {
                current.closing += 1;
                current.omzet += order.price || 0;
            }
            csStatsById.set(order.csId, current);
        }

        if (order.platformId) {
            const current = platformStatsById.get(order.platformId) || { leads: 0, closing: 0 };
            current.leads += 1;
            if (closed) current.closing += 1;
            platformStatsById.set(order.platformId, current);
        }
    });

    scopedDailyAds.forEach((ad) => {
        if (!ad.date || !ad.advertiserId) return;
        const adDate = new Date(ad.date);
        if (adDate < start || adDate > end) return;

        const current = advStatsById.get(ad.advertiserId) || { leads: 0, closing: 0, spend: 0 };
        current.spend += ad.amountSpent || 0;
        advStatsById.set(ad.advertiserId, current);
    });

    let advs = users.filter(u => isAdvertiserRole(u.role) && isActiveRecord(u.status));
    if (visibleAdvIds) advs = advs.filter(a => visibleAdvIds.includes(a.id));

    const advSummary = advs.map(adv => {
        const stats = advStatsById.get(adv.id) || { leads: 0, closing: 0, spend: 0 };
        return {
            id: adv.id,
            name: adv.name,
            leads: stats.leads,
            spend: stats.spend,
            cpl: stats.leads > 0 ? stats.spend / stats.leads : 0,
            cpr: stats.closing > 0 ? stats.spend / stats.closing : 0
        };
    }).sort((a, b) => b.leads - a.leads);

    let css = users.filter(u => isCsRole(u.role) && isActiveRecord(u.status));
    if (visibleCsIds) css = css.filter(c => visibleCsIds.includes(c.id));

    const csSummary = css.map(cs => {
        const stats = csStatsById.get(cs.id) || { leads: 0, closing: 0, omzet: 0 };
        return {
            id: cs.id,
            name: cs.name,
            leads: stats.leads,
            closing: stats.closing,
            closingRate: stats.leads > 0 ? (stats.closing / stats.leads) * 100 : 0,
            omzet: stats.omzet
        };
    }).sort((a, b) => b.closing - a.closing);

    const activePlatformList = platforms.filter(p => isActiveRecord(p.status));
    const platformSummary = activePlatformList.map(p => {
        const stats = platformStatsById.get(p.id) || { leads: 0, closing: 0 };
        return {
            id: p.id,
            name: p.name,
            leads: stats.leads,
            closing: stats.closing,
            closingRate: stats.leads > 0 ? (stats.closing / stats.leads) * 100 : 0
        };
    }).sort((a, b) => b.leads - a.leads);

    const totalSpend = advSummary.reduce((acc, a) => acc + a.spend, 0);
    const totalOmzet = csSummary.reduce((acc, c) => acc + c.omzet, 0);
    const cpl = totalLeads > 0 ? totalSpend / totalLeads : 0;
    const cpr = totalClosing > 0 ? totalSpend / totalClosing : 0;
    const spendWithTax = totalSpend * 1.11;

    return {
        advSummary,
        csSummary,
        platformSummary,
        totalLeads,
        totalClosing,
        totalSpend,
        totalOmzet,
        cpl,
        cpr,
        spendWithTax,
        closingRate: totalLeads > 0 ? (totalClosing / totalLeads) * 100 : 0,
        monthlyTargetLeads,
        dailyTargetEst
    };
  }, [selectedMonth, scopedOrders, scopedDailyAds, users, visibleAdvIds, visibleCsIds, platforms, scopedTargets]);

  const monitoringLookups = useMemo(() => {
    const activeUsers = users.filter(u =>
      isActiveRecord(u.status)
    );
    const activeBranches = branches.filter(b =>
      isActiveRecord(b.status) &&
      (!visibleBranchIds || visibleBranchIds.includes(b.id))
    );
    const activeAdvertisers = activeUsers.filter(u =>
      isAdvertiserRole(u.role) &&
      (!visibleAdvIds || visibleAdvIds.includes(u.id))
    );
    const activeCsUsers = activeUsers.filter(u =>
      isCsRole(u.role) &&
      (!visibleCsIds || visibleCsIds.includes(u.id))
    );
    const activePlatforms = platforms.filter(p => isActiveRecord(p.status));

    const globalOrdersByDate = new Map<string, typeof orders>();
    const scopedOrdersByDate = new Map<string, typeof scopedOrders>();
    const dailyAdsByDateAdvertiser = new Map<string, typeof scopedDailyAds>();
    const techniciansByBranch = new Map<string, typeof activeUsers>();

    const addToMap = <T,>(map: Map<string, T[]>, key: string, item: T) => {
      const list = map.get(key);
      if (list) list.push(item);
      else map.set(key, [item]);
    };

    const capacityOrders = isRestrictedScope ? scopedOrders : orders;
    capacityOrders.forEach((order) => {
      if (!order.created_at) return;
      addToMap(globalOrdersByDate, format(parseISO(order.created_at), 'yyyy-MM-dd'), order);
    });

    scopedOrders.forEach((order) => {
      if (!order.created_at) return;
      addToMap(scopedOrdersByDate, format(parseISO(order.created_at), 'yyyy-MM-dd'), order);
    });

    scopedDailyAds.forEach((ad) => {
      if (!ad.date || !ad.advertiserId) return;
      addToMap(dailyAdsByDateAdvertiser, `${ad.date}|${ad.advertiserId}`, ad);
    });

    activeUsers.forEach((user) => {
      if (!isTechnicianRole(user.role) || !user.branchId) return;
      if (visibleTechnicianIds && !visibleTechnicianIds.includes(user.id)) return;
      addToMap(techniciansByBranch, user.branchId, user);
    });

    return {
      activeBranches,
      activeAdvertisers,
      activeCsUsers,
      activePlatforms,
      globalOrdersByDate,
      scopedOrdersByDate,
      dailyAdsByDateAdvertiser,
      techniciansByBranch,
    };
  }, [orders, scopedOrders, scopedDailyAds, users, branches, platforms, visibleAdvIds, visibleCsIds, visibleBranchIds, visibleTechnicianIds, isRestrictedScope]);

  // 1. FILTER DATA BASED ON ROLE & SELECTED MONTH
  const monitoringData = useMemo(() => {
    // Calculate Monthly Target Metrics
    const monthlyLeadsTarget = scopedTargets.reduce((acc, t) => acc + (t.leadsTarget || 0), 0);
    // Weighted Average Daily Target (Sum of (Target / Days))
    const dailyLeadsTarget = scopedTargets.reduce((acc, t) => acc + ((t.leadsTarget || 0) / (t.workingDays || 26)), 0);
    
    // A. DETERMINE VISIBILITY SCOPE
    // (Moved to top useMemo)

    // C. GENERATE DAYS
    const daysInMonth = eachDayOfInterval({
        start: startOfMonth(selectedMonth),
        end: endOfMonth(selectedMonth)
    });
    const activeBranchIds = new Set(monitoringLookups.activeBranches.map((branch) => branch.id));
    const totalDailyCapacity = monitoringLookups.activeBranches.reduce((acc, branch) => {
      const branchTechnicians = monitoringLookups.techniciansByBranch.get(branch.id) || [];
      return acc + branchTechnicians.length * 6;
    }, 0);

    const today = new Date();
    const todayKey = format(today, 'yyyy-MM-dd');
    const todayInSelectedMonth = format(today, 'yyyy-MM') === format(selectedMonth, 'yyyy-MM');
    const orderedDaysInMonth = todayInSelectedMonth
      ? [
          ...daysInMonth.filter((date) => format(date, 'yyyy-MM-dd') <= todayKey).reverse(),
          ...daysInMonth.filter((date) => format(date, 'yyyy-MM-dd') > todayKey),
        ]
      : [...daysInMonth].reverse();

    const visibleDaysInMonth = orderedDaysInMonth.slice(0, visibleDayLimit);
    const days = visibleDaysInMonth.map((date) => {
        const dateKey = format(date, 'yyyy-MM-dd');
        const totalDaysInMonth = daysInMonth.length;
        const shouldBuildExpandedDetails = expandedDates.includes(dateKey);
        
        // Calculate Daily Target: Distribute monthly target evenly across ALL days in the month
        // (Ignoring Sunday/Holiday logic as per request: "setiap hari ada jadwal")
        const dayTargetLeads = Math.ceil(scopedTargets.reduce((acc, t) => {
            const dailyVal = (t.leadsTarget || 0) / totalDaysInMonth;
            return acc + dailyVal;
        }, 0));
      
      // Filter Orders for this date (Global & Scoped)
      // We use Global for Tech Capacity (Real Availability)
      // We use Scoped for Leads/Sales/Performance (User View)
      
      const globalDayOrders = monitoringLookups.globalOrdersByDate.get(dateKey) || [];
      const scopedDayOrders = monitoringLookups.scopedOrdersByDate.get(dateKey) || [];

      if (!shouldBuildExpandedDetails) {
        let totalClosing = 0;
        let totalOmzet = 0;
        scopedDayOrders.forEach((order) => {
          if (!isCompletedOrderLike(order)) return;
          totalClosing += 1;
          totalOmzet += order.price || 0;
        });

        const totalOccupied = globalDayOrders.reduce((acc, order) => {
          if (!order.branchId || !activeBranchIds.has(order.branchId) || !order.technicianId) return acc;
          return acc + 1;
        }, 0);
        const totalReal = scopedDayOrders.length;
        const closingRate = totalReal > 0 ? (totalClosing / totalReal) * 100 : 0;

        return {
          date: format(date, 'dd MMMM yyyy', { locale: id }),
          dateKey,
          dayShort: format(date, 'dd MMM', { locale: id }),
          totalTarget: dayTargetLeads,
          totalReal,
          totalCapacity: totalDailyCapacity,
          totalOccupied,
          totalClosing,
          totalOmzet,
          closingRate,
          branches: [],
          dayAdvStats: [],
          dayCsStats: [],
          dayPlatformStats: []
        };
      }

      // Group by Branch (Active Only)
      const globalOrdersByBranch = new Map<string, typeof globalDayOrders>();
      const scopedOrdersByBranch = new Map<string, typeof scopedDayOrders>();

      globalDayOrders.forEach((order) => {
        if (!order.branchId) return;
        const list = globalOrdersByBranch.get(order.branchId);
        if (list) list.push(order);
        else globalOrdersByBranch.set(order.branchId, [order]);
      });

      scopedDayOrders.forEach((order) => {
        if (!order.branchId) return;
        const list = scopedOrdersByBranch.get(order.branchId);
        if (list) list.push(order);
        else scopedOrdersByBranch.set(order.branchId, [order]);
      });

      const branchData = monitoringLookups.activeBranches.map(branch => {
        const branchName = branch.name;
        const branchId = branch.id;
        
        // Data Separation
        const globalBranchOrders = globalOrdersByBranch.get(branchId) || [];
        const scopedBranchOrders = scopedOrdersByBranch.get(branchId) || [];

        // 2. Technician Capacity Stats (Based on GLOBAL orders for reality check)
        const branchTechnicians = monitoringLookups.techniciansByBranch.get(branchId) || [];
        const techTotal = branchTechnicians.length; 
        const dailyTechCapacity = 6; 
        
        const techJobCounts = new Map<string, number>();
        globalBranchOrders.forEach((order) => {
          if (!order.technicianId) return;
          techJobCounts.set(order.technicianId, (techJobCounts.get(order.technicianId) || 0) + 1);
        });

        const techStatusMap = shouldBuildExpandedDetails ? branchTechnicians.map(t => {
            const jobCount = techJobCounts.get(t.id) || 0;
            return {
                ...t,
                jobCount,
                maxCapacity: dailyTechCapacity,
                isBusy: jobCount > 0,
                isFull: jobCount >= dailyTechCapacity
            };
        }) : [];
        
        const totalCapacity = branchTechnicians.length * dailyTechCapacity;
        const totalJobs = Array.from(techJobCounts.values()).reduce((acc, count) => acc + count, 0);
        const availableSlots = Math.max(0, totalCapacity - totalJobs);
        const techUsage = totalCapacity > 0 ? Math.round((totalJobs / totalCapacity) * 100) : 0;
        const isTechFull = techUsage >= 90;

        // 1. Marketing Stats (Based on SCOPED orders)
        const totalLeads = scopedBranchOrders.length;
        const closingOrders = scopedBranchOrders.filter(o => isCompletedOrderLike(o));
        const totalClosing = closingOrders.length;
        const omzet = closingOrders.reduce((acc, curr) => acc + (curr.price || 0), 0);
        
        // Target (Based on Available Slots)
        const targetLeads = availableSlots;

        // 3. Advertiser Stats (Filtered List)
        let branchAdvertisers = monitoringLookups.activeAdvertisers;
        
        // Apply Visibility Filter
        if (visibleAdvIds) {
            branchAdvertisers = branchAdvertisers.filter(a => visibleAdvIds!.includes(a.id));
        }

        const scopedBranchOrdersByAdvertiser = new Map<string, number>();
        const scopedBranchOrdersByCs = new Map<string, { leads: number; closing: number }>();
        const scopedBranchOrdersByPlatform = new Map<string, { leads: number; closing: number }>();

        if (shouldBuildExpandedDetails) {
          scopedBranchOrders.forEach((order) => {
            if (order.advertiserId) {
              scopedBranchOrdersByAdvertiser.set(
                order.advertiserId,
                (scopedBranchOrdersByAdvertiser.get(order.advertiserId) || 0) + 1,
              );
            }
            if (order.csId) {
              const current = scopedBranchOrdersByCs.get(order.csId) || { leads: 0, closing: 0 };
              current.leads += 1;
              if (isCompletedOrderLike(order)) current.closing += 1;
              scopedBranchOrdersByCs.set(order.csId, current);
            }
            if (order.platformId) {
              const current = scopedBranchOrdersByPlatform.get(order.platformId) || { leads: 0, closing: 0 };
              current.leads += 1;
              if (isCompletedOrderLike(order)) current.closing += 1;
              scopedBranchOrdersByPlatform.set(order.platformId, current);
            }
          });
        }

        const advStats = shouldBuildExpandedDetails ? branchAdvertisers.map(adv => {
            const myDailyAds = monitoringLookups.dailyAdsByDateAdvertiser.get(`${dateKey}|${adv.id}`) || [];
            const totalSpend = myDailyAds.reduce((acc, curr) => acc + (curr.amountSpent || 0), 0);
            const totalDashboardLeads = myDailyAds.reduce((acc, curr) => acc + (curr.leadsDashboard || 0), 0);

            return {
                name: adv.name,
                platform: 'Ads',
                target: 20,
                real: scopedBranchOrdersByAdvertiser.get(adv.id) || 0,
                spend: totalSpend,
                leadsDashboard: totalDashboardLeads
            };
        }) : [];

        // 4. CS Stats (Filtered List)
        let branchCS = monitoringLookups.activeCsUsers;

        // Apply Visibility Filter
        if (visibleCsIds) {
            branchCS = branchCS.filter(c => visibleCsIds!.includes(c.id));
        }
        
        const csStats = shouldBuildExpandedDetails ? branchCS.map(cs => {
            const stats = scopedBranchOrdersByCs.get(cs.id) || { leads: 0, closing: 0 };
            return {
                name: cs.name,
                target: 15,
                leads: stats.leads,
                closing: stats.closing,
                status: stats.leads > 0 ? ((stats.closing/stats.leads) > 0.5 ? 'good' : 'warning') : 'good'
            };
        }) : [];

        // 5. Platform Stats (Based on Scoped Orders)
        const platformStats = shouldBuildExpandedDetails ? monitoringLookups.activePlatforms.map(p => {
             const stats = scopedBranchOrdersByPlatform.get(p.id) || { leads: 0, closing: 0 };
             return {
                 id: p.id,
                 name: p.name,
                 leads: stats.leads,
                 closing: stats.closing
             };
        }) : [];

        return {
          id: branchId,
          name: branchName,
          target: targetLeads,
          real: totalLeads,
          closing: totalClosing,
          omzet: omzet,
          sdm: { 
            total: totalCapacity, 
            occupied: totalJobs,  
            available: availableSlots 
          },
          techStatusMap,
          advertisers: advStats,
          cs: csStats,
          platforms: platformStats
        };
      });

      // Calculate Daily Totals
      const totalReal = branchData.reduce((acc, b) => acc + b.real, 0);
      const totalTarget = branchData.reduce((acc, b) => acc + b.target, 0);
      const totalCapacity = branchData.reduce((acc, b) => acc + (b.sdm?.total || 0), 0);
      const totalOccupied = branchData.reduce((acc, b) => acc + (b.sdm?.occupied || 0), 0);
      const totalClosing = branchData.reduce((acc, b) => acc + b.closing, 0);
      const totalOmzet = branchData.reduce((acc, b) => acc + (b.omzet || 0), 0);
      const closingRate = totalReal > 0 ? (totalClosing / totalReal) * 100 : 0;

      // 6. Calculate Daily Aggregates (Across all branches)
      // Advertisers
      let dayAdvertisers = monitoringLookups.activeAdvertisers;
      if (visibleAdvIds) dayAdvertisers = dayAdvertisers.filter(a => visibleAdvIds!.includes(a.id));
      
      const scopedDayOrdersByAdvertiser = new Map<string, number>();
      const scopedDayOrdersByCs = new Map<string, { leads: number; closing: number; omzet: number }>();
      const scopedDayOrdersByPlatform = new Map<string, { leads: number; closing: number }>();

      if (shouldBuildExpandedDetails) {
        scopedDayOrders.forEach((order) => {
          if (order.advertiserId) {
            scopedDayOrdersByAdvertiser.set(
              order.advertiserId,
              (scopedDayOrdersByAdvertiser.get(order.advertiserId) || 0) + 1,
            );
          }
          if (order.csId) {
            const current = scopedDayOrdersByCs.get(order.csId) || { leads: 0, closing: 0, omzet: 0 };
            current.leads += 1;
            if (isCompletedOrderLike(order)) {
              current.closing += 1;
              current.omzet += order.price || 0;
            }
            scopedDayOrdersByCs.set(order.csId, current);
          }
          if (order.platformId) {
            const current = scopedDayOrdersByPlatform.get(order.platformId) || { leads: 0, closing: 0 };
            current.leads += 1;
            if (isCompletedOrderLike(order)) current.closing += 1;
            scopedDayOrdersByPlatform.set(order.platformId, current);
          }
        });
      }

      const dayAdvStats = shouldBuildExpandedDetails ? dayAdvertisers.map(adv => {
          const leads = scopedDayOrdersByAdvertiser.get(adv.id) || 0;
          const myDailyAds = monitoringLookups.dailyAdsByDateAdvertiser.get(`${dateKey}|${adv.id}`) || [];
          const totalSpend = myDailyAds.reduce((acc, curr) => acc + (curr.amountSpent || 0), 0);
          
          return {
             id: adv.id,
             name: adv.name,
             leads,
             spend: totalSpend,
             cpl: leads > 0 ? totalSpend / leads : 0
          };
      }).sort((a,b) => b.leads - a.leads) : [];

      // CS
      let dayCS = monitoringLookups.activeCsUsers;
      if (visibleCsIds) dayCS = dayCS.filter(c => visibleCsIds!.includes(c.id));

      const dayCsStats = shouldBuildExpandedDetails ? dayCS.map(cs => {
          const stats = scopedDayOrdersByCs.get(cs.id) || { leads: 0, closing: 0, omzet: 0 };
          return {
             id: cs.id,
             name: cs.name,
             leads: stats.leads,
             closing: stats.closing,
             omzet: stats.omzet,
             closingRate: stats.leads > 0 ? (stats.closing/stats.leads)*100 : 0
          };
      }).sort((a,b) => b.closing - a.closing) : [];

      // Platforms
      const dayPlatformStats = shouldBuildExpandedDetails ? monitoringLookups.activePlatforms.map(p => {
          const stats = scopedDayOrdersByPlatform.get(p.id) || { leads: 0, closing: 0 };
          return {
             id: p.id,
             name: p.name,
             leads: stats.leads,
             closing: stats.closing,
             closingRate: stats.leads > 0 ? (stats.closing/stats.leads)*100 : 0
          };
      }).sort((a,b) => b.leads - a.leads) : [];

      return {
        date: format(date, 'dd MMMM yyyy', { locale: id }),
        dateKey,
        dayShort: format(date, 'dd MMM', { locale: id }),
        totalTarget: dayTargetLeads, // Use the NEW Target Leads
        totalReal,
        totalCapacity, // Keep Tech Capacity separated
        totalOccupied,
        totalClosing,
        totalOmzet,
        closingRate,
        branches: branchData,
        dayAdvStats,
        dayCsStats,
        dayPlatformStats
      };
    });

    return days;
  }, [selectedMonth, monitoringLookups, visibleAdvIds, visibleCsIds, scopedTargets, expandedDates, visibleDayLimit]);

  // Helper for Currency
  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('id-ID', {
      style: 'currency',
      currency: 'IDR',
      maximumFractionDigits: 0,
      minimumFractionDigits: 0
    }).format(amount);
  };

  // Helper for Number
  const formatNumber = (num: number) => {
      return new Intl.NumberFormat('id-ID').format(num);
  }

  const toggleDate = (date: string) => {
    setExpandedDates(prev => 
      prev.includes(date) ? [] : [date]
    );
  };

  const visibleMonitoringData = monitoringData;

  // --- PERMISSION CHECK ---
  if (!hasPermission('monitoring.marketing.view')) {
    return (
        <OperationalPageShell className="marketingMonitoringPage">
            <OperationalEmptyState
                icon={Lock}
                title="Akses Dibatasi"
                description="Mohon maaf, Anda tidak memiliki izin untuk mengakses halaman Monitoring Marketing ini. Silakan hubungi Administrator untuk request akses."
            />
        </OperationalPageShell>
    );
  }

  return (
    <OperationalPageShell className="marketingMonitoringPage">
      <div className="marketingMonitoringStack flex flex-col space-y-4 pb-20">
      <OperationalPageHeader
        eyebrow="Operasional"
        icon={TrendingUp}
        title="Monitoring Performance"
        subtitle="Pantau target vs realisasi harian untuk advertiser, CS, platform, dan cabang."
        actions={
          <ActionGroup className="marketingMonitoringHeaderActions flex flex-wrap items-center gap-2">
            <Button
              variant="ghost"
              className="marketingMonitoringHeaderButton"
              onClick={() => setIsSummaryOpen(!isSummaryOpen)}
              title={isSummaryOpen ? 'Sembunyikan Ringkasan' : 'Lihat Ringkasan'}
              aria-label={isSummaryOpen ? 'Sembunyikan ringkasan' : 'Lihat ringkasan'}
            >
                {isSummaryOpen ? <EyeOff className="mr-2 h-4 w-4" /> : <Eye className="mr-2 h-4 w-4" />}
                <span className="marketingMonitoringHeaderButtonText">{isSummaryOpen ? 'Sembunyikan Ringkasan' : 'Lihat Ringkasan'}</span>
            </Button>

            {canManageTargets && (
                <Button
                    variant="outline"
                    className={cn(
                       "marketingMonitoringHeaderButton",
                       isTargetConsoleOpen ? "bg-blue-50 text-blue-600 border-blue-200" : ""
                    )}
                    onClick={() => setIsTargetConsoleOpen(!isTargetConsoleOpen)}
                    title="Input Target"
                    aria-label="Input target"
                >
                    <Target className="w-4 h-4" />
                    <span className="marketingMonitoringHeaderButtonText">Input Target</span>
                </Button>
            )}

            <Button
              className="marketingMonitoringHeaderButton"
              title="Download Report"
              aria-label="Download report"
            >
              <Download className="w-4 h-4 mr-2" />
              <span className="marketingMonitoringHeaderButtonText">Download Report</span>
            </Button>
          </ActionGroup>
        }
      />

      <OperationalFilterPanel className="marketingMonitoringPeriodPanel flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="marketingMonitoringPeriodLabel flex items-center gap-2 text-sm font-medium text-slate-600 dark:text-slate-300">
          <CalendarDays className="h-4 w-4 text-slate-400" />
          Periode Monitoring
        </div>
        <ActionGroup className="marketingMonitoringMonthControl flex w-full items-center gap-2 sm:w-auto">
           <Button variant="outline" size="icon" className="marketingMonitoringMonthArrow" onClick={handlePrevMonth}>
             <ChevronDown className="w-4 h-4 rotate-90" />
           </Button>
           <div className="uiControlDisplay marketingMonitoringMonthValue min-w-0 flex-1 rounded-md border border-slate-200 bg-white px-4 py-2 text-center text-sm font-medium dark:border-slate-800 dark:bg-slate-900 sm:min-w-[160px]">
              {format(selectedMonth, 'MMMM yyyy', { locale: id })}
           </div>
           <Button variant="outline" size="icon" className="marketingMonitoringMonthArrow" onClick={handleNextMonth}>
             <ChevronDown className="w-4 h-4 -rotate-90" />
           </Button>
        </ActionGroup>
      </OperationalFilterPanel>

      <OperationalKpiGrid className="marketingMonitoringKpiGrid">
        <OperationalKpiCard label="Target Leads" value={formatNumber(summaryMetrics.monthlyTargetLeads || 0)} icon={Target} tone="blue" />
        <OperationalKpiCard label="Total Order" value={formatNumber(summaryMetrics.totalLeads)} icon={TrendingUp} />
        <OperationalKpiCard label="Selesai" value={formatNumber(summaryMetrics.totalClosing)} icon={MessageCircle} tone="emerald" />
        <OperationalKpiCard label="Omzet Selesai" value={formatCurrency(summaryMetrics.totalOmzet)} icon={Globe} tone="blue" />
      </OperationalKpiGrid>

      {/* Target Console */}
      {canManageTargets && isTargetConsoleOpen && (
          <div className="animate-in slide-in-from-top-4 duration-300">
              <TargetManager 
                  month={selectedMonth} 
                  onClose={() => setIsTargetConsoleOpen(false)} 
                  onUpdate={() => setTargetRefresh(prev => prev + 1)} 
                  className="marketingMonitoringTargetManager h-auto min-h-[500px] border-slate-200 shadow-md mb-2"
                  defaultShowPrompt={true}
              />
          </div>
      )}

      {/* SUMMARY PANEL (HEADER SUMMARY) */}
      {isSummaryOpen && (
        <div className="marketingMonitoringSummaryShell animate-in slide-in-from-top-2 duration-300">
            <div className="marketingMonitoringSummaryGrid grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                {/* 1. Global Stats */}
                <div className="marketingMonitoringSummaryCard marketingMonitoringTotalCard bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-4 shadow-sm flex flex-col justify-between">
                    <div>
                        <h3 className="marketingMonitoringTotalTitle text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">Total Bulan Ini</h3>
                        <div className="marketingMonitoringTotalStats">
                            <div className="marketingMonitoringTotalMetric">
                                <p className="marketingMonitoringTotalValue marketingMonitoringTotalValue--blue">{formatNumber(summaryMetrics.monthlyTargetLeads || 0)}</p>
                                <div className="marketingMonitoringTotalText">
                                    <p className="marketingMonitoringTotalLabel">Target Leads</p>
                                    <p className="marketingMonitoringTotalSubtext">Est: {summaryMetrics.dailyTargetEst} / hari</p>
                                </div>
                            </div>
                            <div className="marketingMonitoringTotalMetric">
                                <p className="marketingMonitoringTotalValue text-slate-800 dark:text-slate-100">{formatNumber(summaryMetrics.totalLeads)}</p>
                                <div className="marketingMonitoringTotalText">
                                    <p className="marketingMonitoringTotalLabel">Total Order</p>
                                    <p className="marketingMonitoringTotalSubtext">
                                        CPL: {formatCurrency(summaryMetrics.cpl)}
                                    </p>
                                </div>
                            </div>
                            <div className="marketingMonitoringTotalMetric">
                                <p className="marketingMonitoringTotalValue marketingMonitoringTotalValue--green">{formatNumber(summaryMetrics.totalClosing)}</p>
                                <div className="marketingMonitoringTotalText">
                                    <p className="marketingMonitoringTotalLabel">Selesai</p>
                                    <p className="marketingMonitoringTotalSubtext marketingMonitoringTotalSubtext--green">CPR: {formatCurrency(summaryMetrics.cpr)}</p>
                                </div>
                            </div>
                            <div className="marketingMonitoringTotalMetric">
                                <p className="marketingMonitoringTotalValue marketingMonitoringTotalValue--money">{formatCurrency(summaryMetrics.totalOmzet)}</p>
                                <p className="marketingMonitoringTotalLabel">Omzet</p>
                            </div>
                        </div>
                    </div>
                    <div className="marketingMonitoringTotalProgress mt-4 pt-3 border-t border-slate-100 dark:border-slate-800">
                        <div className="marketingMonitoringTotalProgressRow flex justify-between items-center text-xs mb-1">
                             <span>Achievement</span>
                             <strong className="text-blue-600">
                                {summaryMetrics.monthlyTargetLeads > 0 ? ((summaryMetrics.totalLeads / summaryMetrics.monthlyTargetLeads) * 100).toFixed(1) : 0}%
                             </strong>
                        </div>
                        <Progress value={summaryMetrics.monthlyTargetLeads > 0 ? (summaryMetrics.totalLeads / summaryMetrics.monthlyTargetLeads) * 100 : 0} className="h-1.5 bg-blue-100 [&>div]:bg-blue-600" />
                        
                        <div className="marketingMonitoringTotalProgressRow flex justify-between items-center text-xs mt-3">
                            <span>Closing Rate</span>
                            <strong className="text-emerald-600">{summaryMetrics.closingRate.toFixed(1)}%</strong>
                        </div>
                        <Progress value={summaryMetrics.closingRate} className="h-1.5 mt-1.5 bg-emerald-100 [&>div]:bg-emerald-600" />
                    </div>
                </div>

                {/* 2. Top Advertisers */}
                <div className="marketingMonitoringSummaryCard bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-4 shadow-sm overflow-hidden flex flex-col">
                    <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3 flex items-center justify-between">
                        <span>Top Advertiser</span>
                        <span className="text-[10px] bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded">By Order</span>
                    </h3>
                    <div className="marketingMonitoringRankList flex-1 overflow-y-auto pr-1 space-y-3 custom-scrollbar">
                        {summaryMetrics.advSummary.length === 0 ? (
                            <div className="text-center py-4 text-xs text-slate-400 italic">Belum ada data</div>
                        ) : (
                            summaryMetrics.advSummary.map((adv, idx) => (
                                <div key={adv.id} className="flex items-center justify-between">
                                    <div className="flex items-center gap-2">
                                        <div className={cn("w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold", idx === 0 ? "bg-amber-100 text-amber-700" : "bg-slate-100 text-slate-600")}>
                                            {idx + 1}
                                        </div>
                                        <div className="flex flex-col">
                                            <span className="text-xs font-semibold text-slate-700 dark:text-slate-200 truncate max-w-[100px]">{adv.name}</span>
                                            <span className="text-[9px] text-slate-400">
                                              {formatCurrency(adv.spend)}
                                              {adv.spend > 0 && <span className="text-slate-300 mx-1">|</span>}
                                              {adv.spend > 0 && `${formatCurrency(adv.cpl)}/lead`}
                                              {adv.cpr > 0 && <span className="text-slate-300 mx-1">|</span>}
                                              {adv.cpr > 0 && `${formatCurrency(adv.cpr)}/CPR`}
                                            </span>
                                        </div>
                                    </div>
                                    <div className="text-right">
                                        <div className="text-xs font-bold text-slate-800 dark:text-slate-100">{adv.leads}</div>
                                        <div className="text-[9px] text-slate-400">Order</div>
                                    </div>
                                </div>
                            ))
                        )}
                    </div>
                </div>

                {/* 3. Top CS */}
                <div className="marketingMonitoringSummaryCard bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-4 shadow-sm overflow-hidden flex flex-col">
                    <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3 flex items-center justify-between">
                        <span>Top CS</span>
                        <span className="text-[10px] bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded">By Selesai</span>
                    </h3>
                    <div className="marketingMonitoringRankList flex-1 overflow-y-auto pr-1 space-y-3 custom-scrollbar">
                        {summaryMetrics.csSummary.length === 0 ? (
                            <div className="text-center py-4 text-xs text-slate-400 italic">Belum ada data</div>
                        ) : (
                            summaryMetrics.csSummary.map((cs, idx) => (
                                <div key={cs.id} className="flex items-center justify-between">
                                    <div className="flex items-center gap-2">
                                        <div className={cn("w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold", idx === 0 ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-600")}>
                                            {idx + 1}
                                        </div>
                                        <div className="flex flex-col">
                                            <span className="text-xs font-semibold text-slate-700 dark:text-slate-200 truncate max-w-[100px]">{cs.name}</span>
                                            <span className="text-[9px] text-slate-400">{cs.leads} Order</span>
                                        </div>
                                    </div>
                                    <div className="text-right">
                                        <div className="text-xs font-bold text-emerald-600">{cs.closing}</div>
                                        <div className="text-[9px] text-slate-400">Selesai</div>
                                    </div>
                                </div>
                            ))
                        )}
                    </div>
                </div>

                {/* 4. Top Platform */}
                <div className="marketingMonitoringSummaryCard bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-4 shadow-sm overflow-hidden flex flex-col">
                    <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3 flex items-center justify-between">
                        <span>Top Platform</span>
                        <span className="text-[10px] bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded">By Order</span>
                    </h3>
                    <div className="marketingMonitoringRankList flex-1 overflow-y-auto pr-1 space-y-3 custom-scrollbar">
                        {summaryMetrics.platformSummary.length === 0 ? (
                            <div className="text-center py-4 text-xs text-slate-400 italic">Belum ada data</div>
                        ) : (
                            summaryMetrics.platformSummary.map((p, idx) => (
                                <div key={p.id} className="flex items-center justify-between">
                                    <div className="flex items-center gap-2">
                                        <div className={cn("w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold", idx === 0 ? "bg-blue-100 text-blue-700" : "bg-slate-100 text-slate-600")}>
                                            {idx + 1}
                                        </div>
                                        <div className="flex flex-col">
                                            <span className="text-xs font-semibold text-slate-700 dark:text-slate-200 truncate max-w-[100px]">{p.name}</span>
                                            <span className="text-[9px] text-slate-400">{p.closingRate.toFixed(0)}% Rate</span>
                                        </div>
                                    </div>
                                    <div className="text-right">
                                        <div className="text-xs font-bold text-slate-800 dark:text-slate-100">{p.leads}</div>
                                        <div className="text-[9px] text-slate-400">Order</div>
                                    </div>
                                </div>
                            ))
                        )}
                    </div>
                </div>
            </div>
        </div>
      )}

      {/* Main Grid List */}
      <OperationalTableCard className="marketingMonitoringListCard p-4">
        {monitoringData.length === 0 ? (
          <OperationalEmptyState
            icon={TrendingUp}
            title="Belum ada data monitoring"
            description="Data target dan realisasi akan muncul setelah ada order atau target pada periode ini."
          />
        ) : (
          <div className="marketingMonitoringDayShell">
          <div className="marketingMonitoringListHeader">
            <div>
              <h2>Realisasi Harian</h2>
              <p>Hari terdekat ditampilkan lebih dulu agar monitoring mobile tidak perlu scroll jauh.</p>
            </div>
            <Badge variant="outline" className="marketingMonitoringListBadge">
              {visibleMonitoringData.length} / {totalDaysInSelectedMonth} hari
            </Badge>
          </div>
          <div className="marketingMonitoringDayList space-y-3">
          {visibleMonitoringData.map((day, idx) => {
          const isExpanded = expandedDates.includes(day.dateKey);
          // Achievement based on Total Real (Order) / Total Target (Sisa Slot/Capacity)
          const achievement = day.totalTarget > 0 ? Math.round((day.totalReal / day.totalTarget) * 100) : 0;
          const isBadDay = achievement < 70; // If utilization is low, it might be bad? Or maybe standard?
          
          return (
            <div key={idx} className={cn(
              "marketingMonitoringDayCard border rounded-xl bg-white dark:bg-slate-900 overflow-hidden transition-all duration-200",
              isExpanded ? "ring-2 ring-blue-100 dark:ring-blue-900 border-blue-200 dark:border-blue-800 shadow-md" : "border-slate-200 dark:border-slate-800 hover:border-blue-300"
            )}>
              {/* Row Header (Summary Harian) */}
              <div 
                onClick={() => toggleDate(day.dateKey)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    toggleDate(day.dateKey);
                  }
                }}
                role="button"
                tabIndex={0}
                className="marketingMonitoringDayHeader flex flex-col md:flex-row items-stretch md:items-center gap-4 p-4 cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/50"
              >
                {/* 1. Date Section (Fixed Width) */}
                <div className="marketingMonitoringDateCell flex items-center gap-4 w-full md:w-[240px] shrink-0">
                  <div className={cn(
                    "w-10 h-10 rounded-xl flex items-center justify-center transition-transform duration-200 shadow-sm border",
                    isExpanded ? "bg-blue-600 text-white border-blue-600 rotate-90" : "bg-white text-slate-400 border-slate-200"
                  )}>
                    <ChevronRight className="w-5 h-5" />
                  </div>
                  <div>
                    <div className="font-bold text-lg text-slate-900 dark:text-slate-100 leading-tight">{day.date}</div>
                    <div className="text-xs text-slate-500 flex items-center gap-2 mt-1">
                       <span className={cn("px-2 py-0.5 rounded text-[10px] font-bold uppercase border", 
                          isBadDay ? "bg-red-50 text-red-600 border-red-100" : "bg-emerald-50 text-emerald-600 border-emerald-100"
                       )}>
                          {isBadDay ? "Underperform" : "On Track"}
                       </span>
                    </div>
                  </div>
                </div>

                {/* 2. Metrics Grid (Flexible) */}
                <div className="marketingMonitoringMetricsGrid flex-1 grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-y-4 gap-x-6 items-center border-t md:border-t-0 border-slate-100 pt-4 md:pt-0">
                   
                   {/* Target vs Real */}
                   <div className="flex flex-col">
                      <span className="text-[10px] text-slate-400 uppercase font-bold tracking-wider mb-1">Order / Target</span>
                      <div className="flex items-baseline gap-1.5">
                          <span className={cn("text-xl font-bold", isBadDay ? "text-red-600" : "text-slate-900 dark:text-white")}>{day.totalReal}</span>
                          <span className="text-xs text-slate-400 font-medium">
                            ({day.totalTarget > 0 ? Math.round((day.totalReal / day.totalTarget) * 100) : 0}%)
                            <span className="ml-1 text-slate-300">/ {day.totalTarget}</span>
                          </span>
                      </div>
                   </div>

                   {/* Selesai & Rate */}
                   <div className="flex flex-col">
                      <span className="text-[10px] text-slate-400 uppercase font-bold tracking-wider mb-1">Selesai (Rate)</span>
                      <div className="flex items-baseline gap-1.5">
                          <span className="text-xl font-bold text-emerald-600">{day.totalClosing}</span>
                          <span className="text-xs text-slate-400 font-medium">({day.closingRate.toFixed(0)}%)</span>
                      </div>
                   </div>

                   {/* Omset */}
                   <div className="marketingMonitoringMoneyMetric flex flex-col col-span-2 md:col-span-1 lg:col-span-1 gap-1.5">
                      {/* Estimasi Omset = Total Order x Rp 350.000 */}
                      <div className="flex flex-col">
                        <span className="text-[10px] text-slate-400 uppercase font-bold tracking-wider mb-0.5">Estimasi Omset</span>
                        <span className="marketingMonitoringMoneyValue marketingMonitoringMoneyValue--estimate text-xl font-bold text-blue-600 tracking-tight">
                          {formatCurrency(day.totalReal * 350000)}
                        </span>
                      </div>
                      {/* Baris 2: Omset Real Selesai */}
                      <div className="flex flex-col">
                        <span className="text-[10px] text-slate-400 uppercase font-bold tracking-wider mb-0.5">Real Selesai</span>
                        <span className="marketingMonitoringMoneyValue marketingMonitoringMoneyValue--real text-base font-semibold text-emerald-600 tracking-tight">
                          {formatCurrency(day.totalOmzet)}
                        </span>
                      </div>
                   </div>

                   {/* Progress Bar */}
                   <div className="col-span-2 md:col-span-1 lg:col-span-2 flex flex-col justify-center pl-0 lg:pl-6 border-l-0 lg:border-l border-slate-100">
                      <div className="flex justify-between text-[10px] mb-2 font-bold uppercase tracking-wider text-slate-400">
                        <span>Pencapaian Target</span>
                        <span className={cn(isBadDay ? "text-red-500" : "text-emerald-500")}>{achievement}%</span>
                      </div>
                      <Progress value={achievement} className={cn("h-2.5 rounded-full", isBadDay ? "bg-red-100 [&>div]:bg-red-500" : "bg-emerald-100 [&>div]:bg-emerald-500")} />
                   </div>
                </div>
              </div>

              {/* EXPANDED DETAILS */}
              {isExpanded && (
                <div className="marketingMonitoringExpanded border-t border-slate-100 bg-white p-4 md:p-6 space-y-6 dark:border-slate-800 dark:bg-slate-900">
                  
                  {/* DAILY TEAM PERFORMANCE SUMMARY */}
                  <div className="marketingMonitoringExpandedSummary grid grid-cols-1 lg:grid-cols-3 gap-6">
                      {/* Left: Top Advertisers Today */}
                       <div className="marketingMonitoringMiniCard rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
                          <h4 className="text-sm font-bold text-slate-700 dark:text-slate-200 mb-4 flex items-center justify-between">
                              <span className="flex items-center gap-2">
                                <Target className="w-4 h-4 text-amber-500" />
                                Top Advertiser Hari Ini
                              </span>
                              <span className="text-[10px] bg-slate-100 dark:bg-slate-900 px-2 py-1 rounded text-slate-500">{scopeLabel}</span>
                          </h4>
                          <div className="space-y-3">
                              {day.dayAdvStats && day.dayAdvStats.slice(0, 5).map((adv: any, i: number) => (
                                  <div key={i} className="flex items-center justify-between text-sm">
                                      <div className="flex items-center gap-3">
                                          <div className={cn("w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold", i===0 ? "bg-amber-100 text-amber-700" : "bg-slate-100 text-slate-500")}>
                                              {i + 1}
                                          </div>
                                          <div>
                                              <div className="font-semibold text-slate-700 dark:text-slate-200">{adv.name}</div>
                                              <div className="text-[10px] text-slate-400">{formatCurrency(adv.spend)} | {formatCurrency(adv.cpl)}/lead</div>
                                          </div>
                                      </div>
                                      <div className="text-right">
                                          <div className="font-bold text-slate-800 dark:text-slate-100">{adv.leads} Order</div>
                                      </div>
                                  </div>
                              ))}
                              {(!day.dayAdvStats || day.dayAdvStats.length === 0) && (
                                  <div className="text-center py-4 text-xs text-slate-400 italic">Tidak ada data advertiser hari ini</div>
                              )}
                          </div>
                      </div>

                      {/* Middle: Top CS Today */}
                       <div className="marketingMonitoringMiniCard rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
                          <h4 className="text-sm font-bold text-slate-700 dark:text-slate-200 mb-4 flex items-center justify-between">
                              <span className="flex items-center gap-2">
                                <MessageCircle className="w-4 h-4 text-emerald-500" />
                                Top CS Hari Ini
                              </span>
                              <span className="text-[10px] bg-slate-100 dark:bg-slate-900 px-2 py-1 rounded text-slate-500">{scopeLabel}</span>
                          </h4>
                          <div className="space-y-3">
                              {day.dayCsStats && day.dayCsStats.slice(0, 5).map((cs: any, i: number) => (
                                  <div key={i} className="flex items-center justify-between text-sm">
                                      <div className="flex items-center gap-3">
                                          <div className={cn("w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold", i===0 ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500")}>
                                              {i + 1}
                                          </div>
                                          <div>
                                              <div className="font-semibold text-slate-700 dark:text-slate-200">{cs.name}</div>
                                              <div className="text-[10px] text-slate-400">{cs.leads} Order Masuk</div>
                                          </div>
                                      </div>
                                      <div className="text-right">
                                          <div className="font-bold text-emerald-600">{cs.closing} Selesai</div>
                                          <div className="text-[10px] text-slate-400">Rate: {cs.closingRate.toFixed(0)}%</div>
                                      </div>
                                  </div>
                              ))}
                              {(!day.dayCsStats || day.dayCsStats.length === 0) && (
                                  <div className="text-center py-4 text-xs text-slate-400 italic">Tidak ada data CS hari ini</div>
                              )}
                          </div>
                      </div>

                      {/* Right: Top Platform Today */}
                       <div className="marketingMonitoringMiniCard rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
                          <h4 className="text-sm font-bold text-slate-700 dark:text-slate-200 mb-4 flex items-center justify-between">
                              <span className="flex items-center gap-2">
                                <Globe className="w-4 h-4 text-blue-500" />
                                Top Platform Hari Ini
                              </span>
                              <span className="text-[10px] bg-slate-100 dark:bg-slate-900 px-2 py-1 rounded text-slate-500">{scopeLabel}</span>
                          </h4>
                          <div className="space-y-3">
                              {day.dayPlatformStats && day.dayPlatformStats.slice(0, 5).map((p: any, i: number) => (
                                  <div key={i} className="flex items-center justify-between text-sm">
                                      <div className="flex items-center gap-3">
                                          <div className={cn("w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold", i===0 ? "bg-blue-100 text-blue-700" : "bg-slate-100 text-slate-500")}>
                                              {i + 1}
                                          </div>
                                          <div>
                                              <div className="font-semibold text-slate-700 dark:text-slate-200">{p.name}</div>
                                              <div className="text-[10px] text-slate-400">Rate: {p.closingRate.toFixed(0)}%</div>
                                          </div>
                                      </div>
                                      <div className="text-right">
                                          <div className="font-bold text-slate-800 dark:text-slate-100">{p.leads} Order</div>
                                      </div>
                                  </div>
                              ))}
                              {(!day.dayPlatformStats || day.dayPlatformStats.length === 0) && (
                                  <div className="text-center py-4 text-xs text-slate-400 italic">Tidak ada data platform hari ini</div>
                              )}
                          </div>
                      </div>
                  </div>

                  {/* BRANCH BREAKDOWN HEADER */}
                  <div className="flex items-center gap-4 py-2">
                      <div className="h-px bg-slate-200 dark:bg-slate-700 flex-1"></div>
                      <span className="text-xs font-bold text-slate-400 uppercase tracking-widest">Detail Per Cabang</span>
                      <div className="h-px bg-slate-200 dark:bg-slate-700 flex-1"></div>
                  </div>

                  {day.branches.map((branch, bIdx) => {
                    const branchKey = `${day.dateKey}-${branch.id}`;
                    const isHidden = hiddenBranches.includes(branchKey);
                    
                    const techTotal = branch.sdm.total || 1; 
                    const techOccupied = branch.sdm.occupied;
                    const techAvailable = branch.sdm.available;
                    const techUsage = Math.round((techOccupied / techTotal) * 100);
                    const isTechFull = techUsage >= 90;

                    return (
                      <Card key={bIdx} className="marketingMonitoringBranchCard p-4 border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900 transition-all duration-200">
                        {/* Branch Header */}
                        <div className="marketingMonitoringBranchHeader flex flex-col xl:flex-row justify-between items-start xl:items-center gap-4">
                          <div className="flex items-center gap-3 flex-1">
                            <button 
                                onClick={() => toggleBranch(branchKey)}
                                className={cn(
                                    "marketingMonitoringBranchToggle w-6 h-6 rounded-full flex items-center justify-center transition-transform duration-200 hover:bg-slate-100 dark:hover:bg-slate-700",
                                    !isHidden ? "rotate-90 text-blue-600 bg-blue-50" : "text-slate-400 bg-white"
                                )}
                            >
                                <ChevronRight className="w-4 h-4" />
                            </button>

                            <div className="p-2 bg-indigo-50 dark:bg-indigo-900/30 rounded-lg">
                                <Globe className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
                            </div>
                            <div>
                                <h3 className="font-bold text-slate-800 dark:text-slate-100 text-lg">{branch.name}</h3>
                                <div className="text-sm text-slate-500 mt-0.5 font-medium">
                                    {branch.real} Order <span className="mx-1">|</span> {branch.closing} Selesai
                                </div>
                            </div>
                          </div>
                          
                          {/* Technician Capacity & List Widget */}
                          <div className="w-full xl:w-auto flex flex-col gap-2">
                              <div className="marketingMonitoringCapacityCard flex items-center gap-4 rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
                                  <div className="flex items-center gap-3">
                                      <div className={cn("p-2 rounded-full", isTechFull ? "bg-red-100 text-red-600" : "bg-blue-100 text-blue-600")}>
                                          <Wrench className="w-4 h-4" />
                                      </div>
                                      <div className="flex flex-col min-w-[120px]">
                                          <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">Kapasitas Teknisi</span>
                                          <div className="flex items-center gap-2">
                                            <span className={cn("text-base font-bold", isTechFull ? "text-red-600" : "text-slate-700 dark:text-slate-300")}>
                                                {techOccupied} / {techTotal} Terisi
                                            </span>
                                            {techAvailable > 0 && (
                                                <Badge variant="outline" className="h-5 bg-emerald-50 text-emerald-600 border-emerald-200 text-[10px] px-1.5">
                                                    {techAvailable} Kosong
                                                </Badge>
                                            )}
                                          </div>
                                      </div>
                                  </div>
                                  <div className="hidden md:block w-32 border-l border-slate-200 pl-4 ml-2">
                                      <Progress value={techUsage} className={cn("h-2", isTechFull ? "bg-red-100 [&>div]:bg-red-500" : "bg-blue-100 [&>div]:bg-blue-500")} />
                                  </div>
                              </div>
                          </div>
                        </div>

                        {/* Collapsible Content */}
                        {!isHidden && (
                            <div className="marketingMonitoringBranchBody mt-6 pt-4 border-t border-slate-100 dark:border-slate-700 animate-in fade-in slide-in-from-top-1 duration-200">
                                {branch.techStatusMap && branch.techStatusMap.length > 0 && (
                                    <div className="marketingMonitoringTechPills flex flex-wrap gap-2 justify-end mb-4 -mt-2">
                                        {branch.techStatusMap.map((t: any) => (
                                            <div key={t.id} className={cn(
                                                "text-[10px] px-2 py-0.5 rounded-full border flex items-center gap-1.5 transition-colors",
                                                t.isFull
                                                    ? "bg-red-50 border-red-200 text-red-700" 
                                                    : t.isBusy 
                                                        ? "bg-blue-50 border-blue-200 text-blue-700"
                                                        : "bg-emerald-50 border-emerald-200 text-emerald-700 font-medium"
                                            )}>
                                                <div className={cn("w-1.5 h-1.5 rounded-full", 
                                                    t.isFull ? "bg-red-500" :
                                                    t.isBusy ? "bg-blue-500" : "bg-emerald-500"
                                                )} />
                                                {t.name.split(' ')[0]} 
                                                <span className="opacity-80 font-mono ml-0.5 font-semibold">
                                                    {t.jobCount}/{t.maxCapacity}
                                                </span>
                                            </div>
                                        ))}
                                    </div>
                                )}

                                <div className="marketingMonitoringBreakdownGrid grid grid-cols-1 lg:grid-cols-3 gap-4">
                            {/* KIRI: ADVERTISERS */}
                            <div>
                                <h4 className="text-[10px] font-bold text-slate-400 uppercase mb-2 flex items-center gap-2">
                                    <Target className="w-3 h-3" /> Performance Advertiser
                                </h4>
                                <div className="space-y-2">
                                    {branch.advertisers.length === 0 ? (
                                        <div className="marketingMonitoringInlineEmpty text-[10px] text-slate-400 italic p-2 border border-dashed rounded bg-white">Belum ada data advertiser aktif.</div>
                                    ) : branch.advertisers.map((adv, aIdx) => {
                                        const advAch = adv.target > 0 ? Math.round((adv.real / adv.target) * 100) : 0;
                                        return (
                                            <div key={aIdx} className="marketingMonitoringBreakdownItem flex items-center justify-between p-2.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 hover:border-blue-200 transition-colors">
                                                <div className="flex items-center gap-2.5">
                                                    <div className="w-6 h-6 rounded-full bg-white border border-slate-200 flex items-center justify-center text-[10px] font-bold text-slate-600 shadow-sm">
                                                        {adv.name.charAt(0)}
                                                    </div>
                                                    <div className="flex flex-col">
                                                        <span className="text-xs font-semibold text-slate-700 dark:text-slate-200">{adv.name}</span>
                                                        <span className="text-[9px] text-slate-400">Ads {scopeLabel}</span>
                                                    </div>
                                                </div>
                                                <div className="flex items-center gap-3">
                                                    <div className="flex flex-col items-end mr-1 border-r border-slate-200 pr-3">
                                                        <div className="text-[10px] font-semibold text-slate-600 dark:text-slate-300">
                                                            {formatCurrency(adv.spend)}
                                                        </div>
                                                        <div className="text-[9px] text-slate-400">
                                                            {adv.leadsDashboard} Dash
                                                        </div>
                                                    </div>

                                                    <div className="text-right">
                                                        <div className={cn("font-bold text-sm", adv.real === 0 ? "text-slate-400" : advAch < 80 ? "text-red-500" : "text-emerald-600")}>
                                                            {adv.real}<span className="text-slate-300 text-[9px] font-normal">/{adv.target}</span>
                                                        </div>
                                                        <div className="text-[9px] text-slate-400">Order</div>
                                                    </div>
                                                </div>
                                            </div>
                                        )
                                    })}
                                </div>
                            </div>

                            {/* TENGAH: CS */}
                            <div>
                                <h4 className="text-[10px] font-bold text-slate-400 uppercase mb-2 flex items-center gap-2">
                                    <MessageCircle className="w-3 h-3" /> Performance CS
                                </h4>
                                <div className="grid grid-cols-1 gap-2">
                                    {branch.cs.length === 0 ? (
                                        <div className="marketingMonitoringInlineEmpty text-[10px] text-slate-400 italic p-2 border border-dashed rounded bg-white">Belum ada CS aktif.</div>
                                    ) : branch.cs.map((cs, cIdx) => {
                                        return (
                                        <div key={cIdx} className="marketingMonitoringBreakdownItem flex items-center justify-between p-2.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 hover:border-blue-200 transition-colors">
                                            <div className="flex items-center gap-2.5">
                                                 <div className="w-6 h-6 rounded-full bg-white border border-slate-200 flex items-center justify-center text-[10px] font-bold text-slate-600 shadow-sm">
                                                        {cs.name.charAt(0)}
                                                 </div>
                                                 <div className="flex flex-col">
                                                     <span className="text-xs font-semibold text-slate-700 dark:text-slate-200">{cs.name}</span>
                                                     <span className="text-[9px] text-slate-400">CS Sales</span>
                                                 </div>
                                            </div>
                                            <div className="text-right flex items-center gap-3">
                                                <div className="flex flex-col items-end border-r border-slate-200 pr-3 mr-1">
                                                    <span className="text-xs font-bold text-slate-700 dark:text-slate-300">{cs.closing}</span>
                                                    <span className="text-[9px] text-slate-400">Selesai</span>
                                                </div>
                                                <div className="flex flex-col items-end">
                                                    <span className={cn("text-xs font-bold", cs.leads === 0 ? "text-slate-400" : "text-emerald-600")}>
                                                        {cs.leads}
                                                    </span>
                                                    <span className="text-[9px] text-slate-400">Order</span>
                                                </div>
                                            </div>
                                        </div>
                                        );
                                    })}
                                </div>
                            </div>

                            {/* KANAN: PLATFORMS */}
                            <div>
                                <h4 className="text-[10px] font-bold text-slate-400 uppercase mb-2 flex items-center gap-2">
                                    <Globe className="w-3 h-3" /> Performance Platform
                                </h4>
                                <div className="space-y-2">
                                    {branch.platforms.map((p, pIdx) => (
                                        <div key={pIdx} className="marketingMonitoringBreakdownItem flex items-center justify-between p-2.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
                                            <span className="text-xs font-medium text-slate-600 dark:text-slate-300">{p.name}</span>
                                            <div className="flex items-center gap-2 text-xs">
                                                <span className="font-bold text-slate-700 dark:text-slate-200">{p.leads}</span>
                                                <span className="text-slate-400">Order</span>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                          </div>
                        </div>
                      )}
                      </Card>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
          {visibleDayLimit < totalDaysInSelectedMonth && (
            <div className="flex justify-center pt-2">
              <Button
                variant="outline"
                className="marketingMonitoringLoadMore bg-white"
                onClick={() => setVisibleDayLimit((limit) => Math.min(limit + 8, totalDaysInSelectedMonth))}
              >
                Tampilkan Hari Lainnya
              </Button>
            </div>
          )}
          </div>
          </div>
        )}
      </OperationalTableCard>
      </div>
    </OperationalPageShell>
  );
}
