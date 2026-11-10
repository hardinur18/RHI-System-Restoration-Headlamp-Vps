import './orders/order-filters.css';
import { useOrderDateLoading } from './orders/hooks/useOrderDateLoading';
import React, { useState, useMemo, useEffect, useCallback } from 'react';
import {
  Search, Plus, MapPin, Calendar, Clock, Map as MapIcon, Eye, MoreVertical,
  CheckCircle2, XCircle, Timer, Truck, Edit, Trash2, Package, RefreshCw, Banknote, Loader2, MessageCircle, Camera, CreditCard,
  User as UserIcon, Building2, ChevronDown, Settings, Megaphone, Filter, FileSpreadsheet, FileDown, FileUp, FileText, Ruler, Lock, AlertTriangle, Phone, ArrowUpDown, ArrowUp, ArrowDown, ClipboardList, QrCode
} from 'lucide-react';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Checkbox } from '../components/ui/checkbox';
import {
  TableBody, TableCell, TableHead, TableHeader, TableRow
} from '../components/ui/table';
import { DataTable, createDataTableColumns } from '../components/ui/data-table';
import { Badge } from '../components/ui/badge';
import { Modal } from '../components/ui/Modal';
import {
  TooltipProvider,
} from "../components/ui/tooltip"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../components/ui/dropdown-menu"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "../components/ui/alert-dialog"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "../components/ui/sheet"
import { Dialog, DialogFooter } from "../components/ui/dialog"
import { Label } from "../components/ui/label"
import { useMasterData } from '@/app/pages/master-data/context';
import { usePermissions } from '@/app/hooks/usePermissions';
import { logActivity } from '@/app/services/auditService';
import { AdAccount, AdAccountAssignment, Branch, Order, User, WATemplate } from './master-data/data';
import { getTodayDateKey } from './master-data/dateKeys';
import { FoundationDateRangePicker } from '../components/ui/date-range-picker';
import { startOfDay, endOfDay } from 'date-fns';
import { OrderStatusReasonFields } from './orders/OrderStatusReasonFields';
import { toast } from 'sonner';
import { isReasonRequiredStatus } from './orders/cancelReasonOptions';
import { getCoordinatesFromUrl, expandShortUrl } from '../../utils/mapUtils';
import { supabase } from '../../lib/supabaseClient';
import { copyToClipboard } from '@/lib/clipboard';
import {
  OperationalEmptyState,
  OperationalFilterPanel,
  OperationalKpiCard,
  OperationalKpiGrid,
  OperationalPageHeader,
  OperationalPageShell,
  OperationalTableCard,
} from '../components/ui/operational-page';
import {
  MasterDataDialogBody,
  MasterDataFormDialogContent,
  MasterDataFormHeader,
} from '../components/ui/master-data-ui';
import { MasterDataTableTitle } from '../components/ui/master-data-table-title';
import { Switch } from '../components/ui/switch';
import { Skeleton } from '../components/ui/skeleton';
import {
  buildActiveScheduleConflictMap,
  getScheduleConflictItemKey,
  getScheduleSlotConflictKey,
  getTechnicianDaySchedule,
} from '@/app/services/orderScheduleValidation';
import {
  saveOrderToCrmContact,
  saveOrdersToCrmContacts,
} from '@/app/services/crmContactsService';
import { WhatsappIcon } from './orders/WhatsappIcon';
import { getStatusLabel, getStatusBadgeVariant, getStatusReasonSummary, normalizeReasonFilterValue } from './orders/orderHelpers';
import { useOrderLookupMaps } from './orders/hooks/useOrderLookupMaps';
import { useOrderFilters } from './orders/hooks/useOrderFilters';
import { useOrderPagination } from './orders/hooks/useOrderPagination';
import { useOrderExport } from './orders/hooks/useOrderExport';
import { useOrderImport } from './orders/hooks/useOrderImport';
import { useOrderBulkActions } from './orders/hooks/useOrderBulkActions';
import { useOrderStatusActions } from './orders/hooks/useOrderStatusActions';
import { getOrderCrudErrorMessage } from './orders/orderCrudErrors';
import {
  getInitialPhotoTab,
  getOrderDocumentationSummary,
  type OrderDocumentationKey,
} from './orders/orderDocumentation';
import { OrderPhotoViewerDialog } from './orders/OrderPhotoViewerDialog';
import { prepareOrderPaymentProofUpload, validateOrderPaymentProofFile } from './orders/orderPhotoUpload';
import {
  ORDER_ACTION_ICON_CLASS,
  ORDER_MENU_CONTENT_CLASS,
  ORDER_MENU_ITEM_CLASS,
  OrderActionButton,
  OrderMobileSkeleton,
  OrderTableSkeleton,
} from './orders/orderPageUi';
import { OrderViewModeTabs, type OrderViewMode } from './orders/OrderViewModeTabs';

const MapCard = React.lazy(() =>
  import('../components/ui/MapCard').then((module) => ({ default: module.MapCard })),
);

const OrderForm = React.lazy(() =>
  import('./orders/OrderForm').then((module) => ({ default: module.OrderForm })),
);

const OrderDetailDialog = React.lazy(() =>
  import('./orders/OrderDetailDialog').then((module) => ({ default: module.OrderDetailDialog })),
);

const OrderPaymentDialog = React.lazy(() =>
  import('./orders/OrderPaymentDialog').then((module) => ({ default: module.OrderPaymentDialog })),
);

const ImportPreviewModal = React.lazy(() =>
  import('./orders/ImportPreviewModal').then((module) => ({ default: module.ImportPreviewModal })),
);

const ORDER_TABLE_PAGE_SIZE_OPTIONS = [50, 100, 300, 500];
const ORDER_TABLE_INTERACTIVE_SELECTOR =
  'button, a, input, textarea, select, [data-slot="checkbox"], [role="button"], [role="checkbox"], [role="menuitem"]';
const ORDER_FILTER_CONTROL_CLASS =
  'orderFilterControl bg-white text-slate-800 shadow-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100';
const ORDER_STATUS_FILTER_OPTIONS = [
  { value: 'pending', label: 'Terjadwal' },
  { value: 'otw', label: 'OTW Jalan' },
  { value: 'working', label: 'Pengerjaan' },
  { value: 'qc', label: 'Menunggu QC' },
  { value: 'processing', label: 'Proses' },
  { value: 'done', label: 'Selesai' },
  { value: 'reschedule', label: 'Jadwal Ulang' },
  { value: 'cancelled', label: 'Cancel' },
] as const;

const isOrderDateFilterMode = (value: string): value is 'service' | 'lead' =>
  value === 'service' || value === 'lead';

const getUnknownErrorMessage = (error: unknown, fallback: string) =>
  error instanceof Error ? error.message : fallback;

const uniqueById = <T extends { id: string }>(items: T[]) =>
  Array.from(new Map(items.map((item) => [item.id, item])).values());

export function Pesanan() {
  // --- Context & Permissions ---
  const {
    orders = [],
    users = [],
    services = [],
    vehicles = [],
    deleteOrder,
    updateOrder,
    updateOrderPatch,
    addOrder,
    branches: allBranches = [],
    activeBranches: branches = [],
    areas = [],
    currentRole,
    payments = [],
    waTemplates = [],
    currentUser,
    leads = [],
    platforms = [],
    subChannels = [],
    cancelReasons = [],
    technicianSchedules = [],
    prospectBookings = [],
    adAccounts = [],
    adAccountAssignments = [],
    adAccountOwnerAssignments = [],
    isOrdersLoading,
    ensureOrdersForDateRange,
  } = useMasterData();
  const { hasPermission, isOrderLocked } = usePermissions();
  const ordersInitialLoading = isOrdersLoading && orders.length === 0;
  const [serviceNameFallbackMap, setServiceNameFallbackMap] = useState<Record<string, string>>({});
  const [vehicleNameFallbackMap, setVehicleNameFallbackMap] = useState<Record<string, string>>({});
  const [userLookupFallbackMap, setUserLookupFallbackMap] = useState<Record<string, Pick<User, 'id' | 'name' | 'phone' | 'branchId'>>>({});
  const [branchLookupFallbackMap, setBranchLookupFallbackMap] = useState<Record<string, Pick<Branch, 'id' | 'name' | 'code' | 'city' | 'status'>>>({});

  const openWhatsAppTemplateManager = useCallback(() => {
    window.location.assign('/leads/templates');
  }, []);

  const nonScheduleLeadIds = useMemo(
    () => new Set(
      leads
        .filter((lead) => lead.status === 'Cancel' || lead.status === 'Closing')
        .map((lead) => lead.id),
    ),
    [leads],
  );
  const activeOrderScheduleSlots = useMemo(() => {
    const slots = new Set<string>();

    orders.forEach((order) => {
      const slotKey = getScheduleSlotConflictKey({
        technicianId: order.technicianId,
        serviceDate: order.serviceDate,
        serviceTime: order.serviceTime,
      });
      if (slotKey) slots.add(slotKey);
    });

    return slots;
  }, [orders]);
  const scheduleBlockingProspectBookings = useMemo(
    () => prospectBookings.filter((booking) => {
      if (booking.leadId && nonScheduleLeadIds.has(booking.leadId)) {
        return false;
      }

      const slotKey = getScheduleSlotConflictKey({
        technicianId: booking.technicianId,
        serviceDate: booking.scheduleDate,
        serviceTime: booking.scheduleTime,
      });

      return Boolean(slotKey && activeOrderScheduleSlots.has(slotKey));
    }),
    [activeOrderScheduleSlots, nonScheduleLeadIds, prospectBookings],
  );
  const scheduleConflictByItemKey = useMemo(
    () => buildActiveScheduleConflictMap(orders, scheduleBlockingProspectBookings),
    [orders, scheduleBlockingProspectBookings]
  );
  const conflictOrderIds = useMemo(() => {
    const ids = new Set<string>();

    scheduleConflictByItemKey.forEach((_, itemKey) => {
      if (itemKey.startsWith('order:')) {
        ids.add(itemKey.slice('order:'.length));
      }
    });

    return ids;
  }, [scheduleConflictByItemKey]);

  // --- Hooks ---
  const { userMap, branchMap, areaMap, platformMap, subChannelMap, paymentMap } =
    useOrderLookupMaps({ users, branches: allBranches, areas, services, platforms, subChannels, payments, vehicles });

  const filters = useOrderFilters({
    orders, users, services, vehicles, branches, platforms, subChannels, cancelReasons, currentUser, currentRole,
    conflictOrderIds,
  });

  const {
    search, setSearch,
    statusFilter, setStatusFilter,
    cancelReasonFilter, setCancelReasonFilter,
    technicianFilter, setTechnicianFilter,
    csFilter, setCsFilter,
    serviceFilter, setServiceFilter,
    serviceCategoryFilter, setServiceCategoryFilter,
    vehicleFilter, setVehicleFilter,
    platformFilter, setPlatformFilter,
    advertiserFilter, setAdvertiserFilter,
    branchFilter, setBranchFilter,
    areaFilter, setAreaFilter,
    paymentTypeFilter, setPaymentTypeFilter,
    paymentMethodFilter, setPaymentMethodFilter,
    paymentStatusFilter, setPaymentStatusFilter,
    paymentValidationFilter, setPaymentValidationFilter,
    affiliateFilter, setAffiliateFilter,
    subChannelFilter, setSubChannelFilter,
    scheduleConflictFilter, setScheduleConflictFilter,
    dateRange, setDateRange,
    dateFilterMode, setDateFilterMode,
    filteredOrdersBase, filteredOrders, statusCounts, cancelReasonFilterOptions,
    stats, activeFilterCount, accessibleOrders,
    availableBranches, availableTechnicians, availableCS, availablePlatforms, availableSubChannels,
    technicians, csUsers, advertisers, activeServices, serviceCategories, affiliateNames,
    resetSheetFilters,
    canAccessAllOrders, isAdminManagementUser, isAdvertiserUser, isCsUser, isTechnicianUser, isFinanceUser,
  } = filters;
  const { loading: isDateRangeLoading, error: ordersLoadError, retry: retryOrderLoad } =
    useOrderDateLoading(dateRange, dateFilterMode, ensureOrdersForDateRange, !isOrdersLoading,
      isTechnicianUser ? currentUser?.id : undefined);
  const ordersRangeLoading = isDateRangeLoading && filteredOrdersBase.length === 0;
  const ordersTableLoading = ordersInitialLoading || ordersRangeLoading;

  const pagination = useOrderPagination({
    filteredOrders, filteredOrdersBase, statusFilter, cancelReasonFilter,
  });
  const {
    currentPage, setCurrentPage, itemsPerPage, setItemsPerPage,
    selectedIds, setSelectedIds, sortConfig, requestSort, setPriceSortDirection,
    sortedOrders, totalPages, paginatedOrders, handleSelectAll, handleSelectRow,
  } = pagination;

  const loadedServiceIds = useMemo(
    () => new Set(services.map((service) => service.id)),
    [services],
  );
  const loadedVehicleIds = useMemo(
    () => new Set(vehicles.map((vehicle) => vehicle.id)),
    [vehicles],
  );
  const loadedUserIds = useMemo(
    () => new Set(users.map((user) => user.id)),
    [users],
  );
  const loadedBranchIds = useMemo(
    () => new Set(allBranches.map((branch) => branch.id)),
    [allBranches],
  );
  const missingOrderServiceLookupKey = useMemo(() => {
    const ids = new Set<string>();
    paginatedOrders.forEach((order) => {
      if (order.serviceId && !loadedServiceIds.has(order.serviceId) && !serviceNameFallbackMap[order.serviceId]) {
        ids.add(order.serviceId);
      }
    });
    return Array.from(ids).sort().join('|');
  }, [loadedServiceIds, paginatedOrders, serviceNameFallbackMap]);
  const missingOrderVehicleLookupKey = useMemo(() => {
    const ids = new Set<string>();
    paginatedOrders.forEach((order) => {
      if (order.vehicleId && !loadedVehicleIds.has(order.vehicleId) && !vehicleNameFallbackMap[order.vehicleId]) {
        ids.add(order.vehicleId);
      }
    });
    return Array.from(ids).sort().join('|');
  }, [loadedVehicleIds, paginatedOrders, vehicleNameFallbackMap]);
  const missingOrderUserLookupKey = useMemo(() => {
    const ids = new Set<string>();
    paginatedOrders.forEach((order) => {
      [order.technicianId, order.csId].forEach((userId) => {
        if (userId && !loadedUserIds.has(userId) && !userLookupFallbackMap[userId]) {
          ids.add(userId);
        }
      });
    });
    return Array.from(ids).sort().join('|');
  }, [loadedUserIds, paginatedOrders, userLookupFallbackMap]);
  const missingOrderBranchLookupKey = useMemo(() => {
    const ids = new Set<string>();
    paginatedOrders.forEach((order) => {
      if (order.branchId && !loadedBranchIds.has(order.branchId) && !branchLookupFallbackMap[order.branchId]) {
        ids.add(order.branchId);
      }
    });
    return Array.from(ids).sort().join('|');
  }, [branchLookupFallbackMap, loadedBranchIds, paginatedOrders]);

  useEffect(() => {
    const serviceIds = missingOrderServiceLookupKey ? missingOrderServiceLookupKey.split('|') : [];
    const vehicleIds = missingOrderVehicleLookupKey ? missingOrderVehicleLookupKey.split('|') : [];
    const userIds = missingOrderUserLookupKey ? missingOrderUserLookupKey.split('|') : [];
    const branchIds = missingOrderBranchLookupKey ? missingOrderBranchLookupKey.split('|') : [];
    if (serviceIds.length === 0 && vehicleIds.length === 0 && userIds.length === 0 && branchIds.length === 0) return;

    let isCancelled = false;

    const fetchMissingOrderLookupNames = async () => {
      const [serviceResult, vehicleResult, userResult, branchResult] = await Promise.all([
        serviceIds.length > 0
          ? supabase.from('services').select('id,name').in('id', serviceIds)
          : Promise.resolve({ data: [], error: null }),
        vehicleIds.length > 0
          ? supabase.from('vehicle_types').select('id,name').in('id', vehicleIds)
          : Promise.resolve({ data: [], error: null }),
        userIds.length > 0
          ? supabase.from('profiles').select('id,name,phone,branch_id').in('id', userIds)
          : Promise.resolve({ data: [], error: null }),
        branchIds.length > 0
          ? supabase.from('branches').select('id,name,code,city,status').in('id', branchIds)
          : Promise.resolve({ data: [], error: null }),
      ]);

      if (isCancelled) return;

      if (serviceResult.error && import.meta.env.DEV) {
        console.warn('[Pesanan] failed to resolve service names', serviceResult.error);
      }
      if (vehicleResult.error && import.meta.env.DEV) {
        console.warn('[Pesanan] failed to resolve vehicle names', vehicleResult.error);
      }
      if (userResult.error && import.meta.env.DEV) {
        console.warn('[Pesanan] failed to resolve operational users', userResult.error);
      }
      if (branchResult.error && import.meta.env.DEV) {
        console.warn('[Pesanan] failed to resolve operational branches', branchResult.error);
      }

      if (serviceResult.data?.length) {
        setServiceNameFallbackMap((current) => {
          const next = { ...current };
          serviceResult.data.forEach((service: { id?: string; name?: string | null }) => {
            if (service.id && service.name) next[service.id] = service.name;
          });
          return next;
        });
      }

      if (vehicleResult.data?.length) {
        setVehicleNameFallbackMap((current) => {
          const next = { ...current };
          vehicleResult.data.forEach((vehicle: { id?: string; name?: string | null }) => {
            if (vehicle.id && vehicle.name) next[vehicle.id] = vehicle.name;
          });
          return next;
        });
      }

      if (userResult.data?.length) {
        setUserLookupFallbackMap((current) => {
          const next = { ...current };
          userResult.data.forEach((profile: { id?: string; name?: string | null; phone?: string | null; branch_id?: string | null }) => {
            if (profile.id && profile.name) {
              next[profile.id] = {
                id: profile.id,
                name: profile.name,
                phone: profile.phone || '',
                branchId: profile.branch_id || undefined,
              };
            }
          });
          return next;
        });
      }

      if (branchResult.data?.length) {
        setBranchLookupFallbackMap((current) => {
          const next = { ...current };
          branchResult.data.forEach((branch: { id?: string; name?: string | null; code?: string | null; city?: string | null; status?: Branch['status'] | null }) => {
            if (branch.id && branch.name) {
              next[branch.id] = {
                id: branch.id,
                name: branch.name,
                code: branch.code || undefined,
                city: branch.city || '',
                status: branch.status || 'active',
              };
            }
          });
          return next;
        });
      }
    };

    void fetchMissingOrderLookupNames();

    return () => {
      isCancelled = true;
    };
  }, [missingOrderBranchLookupKey, missingOrderServiceLookupKey, missingOrderUserLookupKey, missingOrderVehicleLookupKey]);

  const statusActions = useOrderStatusActions({ updateOrder, currentUser });
  const {
    quickStatusChange, quickStatusReason, quickStatusReasonNote,
    setQuickStatusReason, setQuickStatusReasonNote,
    editingPriceId, setEditingPriceId, tempPrice, setTempPrice,
    resetQuickStatusChange, buildStatusUpdatePayload,
    openQuickStatusChange, handleInlineStatusChange, handleConfirmQuickStatusChange,
  } = statusActions;

  const { handleExportCSV, handleExportXLSX, handleExportPDF, handleDownloadTemplate } =
    useOrderExport({ filteredOrders, users, services, vehicles, branches, areas, platforms, payments });

  const {
    isImportPreviewOpen, setIsImportPreviewOpen,
    importPreviewData, setImportPreviewData, fileInputRef,
    handleImportClick, handleConfirmImport, handleImportOrders,
  } = useOrderImport({ users, services, vehicles, branches, areas, platforms, payments, addOrder });

  const todayKey = getTodayDateKey();
  const isActiveAdAssignment = useCallback(
    (assignment: { startDate?: string | null; endDate?: string | null; status?: string | null }) => {
      if (assignment.status && assignment.status !== 'active') return false;
      if (assignment.startDate && assignment.startDate > todayKey) return false;
      if (assignment.endDate && assignment.endDate < todayKey) return false;
      return true;
    },
    [todayKey],
  );
  const activeAdAccounts = useMemo<AdAccount[]>(
    () => adAccounts.filter((account) => account.status === 'active'),
    [adAccounts],
  );
  const activeOwnerByAccountId = useMemo(() => {
    const map = new Map<string, string>();
    [...adAccountOwnerAssignments]
      .filter(isActiveAdAssignment)
      .sort((left, right) => (right.startDate || '').localeCompare(left.startDate || ''))
      .forEach((assignment) => {
        if (!map.has(assignment.adAccountId)) {
          map.set(assignment.adAccountId, assignment.advertiserId);
        }
      });
    return map;
  }, [adAccountOwnerAssignments, isActiveAdAssignment]);
  const activeCsAssignmentsByAccountId = useMemo(() => {
    const map = new Map<string, AdAccountAssignment[]>();
    adAccountAssignments
      .filter(isActiveAdAssignment)
      .forEach((assignment) => {
        const list = map.get(assignment.adAccountId) || [];
        list.push(assignment);
        map.set(assignment.adAccountId, list);
      });
    return map;
  }, [adAccountAssignments, isActiveAdAssignment]);
  const getAccountAdvertiserId = useCallback(
    (account: AdAccount) => activeOwnerByAccountId.get(account.id) || account.advertiserId,
    [activeOwnerByAccountId],
  );
  const getScopedOrderAdAccounts = useCallback(
    (scope?: { advertiserId?: string; platformId?: string; subChannelId?: string; csId?: string }) => {
      let accounts = activeAdAccounts;

      if (isAdvertiserUser && currentUser) {
        accounts = accounts.filter((account) => getAccountAdvertiserId(account) === currentUser.id);
      } else if (isCsUser && currentUser) {
        accounts = accounts.filter((account) =>
          (activeCsAssignmentsByAccountId.get(account.id) || []).some((assignment) => assignment.csId === currentUser.id),
        );
      }

      if (scope?.advertiserId) {
        accounts = accounts.filter((account) => getAccountAdvertiserId(account) === scope.advertiserId);
      }
      if (scope?.platformId) {
        accounts = accounts.filter((account) => account.platformId === scope.platformId);
      }
      if (scope?.subChannelId) {
        accounts = accounts.filter((account) =>
          account.subChannelId === scope.subChannelId ||
          (activeCsAssignmentsByAccountId.get(account.id) || []).some((assignment) => assignment.subChannelId === scope.subChannelId),
        );
      }
      if (scope?.csId) {
        accounts = accounts.filter((account) =>
          (activeCsAssignmentsByAccountId.get(account.id) || []).some((assignment) => assignment.csId === scope.csId),
        );
      }

      return accounts;
    },
    [
      activeAdAccounts,
      activeCsAssignmentsByAccountId,
      currentUser,
      getAccountAdvertiserId,
      isAdvertiserUser,
      isCsUser,
    ],
  );
  const bulkAdvertisers = useMemo(() => {
    const scopedAccounts = getScopedOrderAdAccounts();
    if (scopedAccounts.length === 0) return advertisers;

    const advertiserIds = new Set(scopedAccounts.map(getAccountAdvertiserId).filter(Boolean));
    const fromAdAccounts = advertisers.filter((advertiser) => advertiserIds.has(advertiser.id));
    return fromAdAccounts.length > 0 ? uniqueById(fromAdAccounts) : advertisers;
  }, [advertisers, getAccountAdvertiserId, getScopedOrderAdAccounts]);
  const bulkCsUsers = useMemo(() => {
    const scopedAccounts = getScopedOrderAdAccounts();
    if (scopedAccounts.length === 0) return csUsers;

    const csIds = new Set<string>();
    scopedAccounts.forEach((account) => {
      (activeCsAssignmentsByAccountId.get(account.id) || []).forEach((assignment) => {
        if (assignment.csId) csIds.add(assignment.csId);
      });
    });
    const fromAdAccounts = csUsers.filter((cs) => csIds.has(cs.id));
    return fromAdAccounts.length > 0 ? uniqueById(fromAdAccounts) : csUsers;
  }, [activeCsAssignmentsByAccountId, csUsers, getScopedOrderAdAccounts]);
  const canApplyOrderBulkUpdate = useCallback(
    (order: Order, field: string, value: string) => {
      if (!['advertiserId', 'csId'].includes(field) || activeAdAccounts.length === 0) {
        return true;
      }

      const nextAdvertiserId = field === 'advertiserId' ? value : order.advertiserId;
      const nextCsId = field === 'csId' ? value : order.csId;
      const scopedAccounts = getScopedOrderAdAccounts({
        advertiserId: nextAdvertiserId,
        platformId: order.platformId,
        subChannelId: order.subChannelId,
        csId: nextCsId,
      });

      return scopedAccounts.length > 0;
    },
    [activeAdAccounts.length, getScopedOrderAdAccounts],
  );

  const bulkActions = useOrderBulkActions({
    orders, services, selectedIds, setSelectedIds,
    updateOrder, deleteOrder, currentUser, buildStatusUpdatePayload,
    canApplyBulkUpdate: canApplyOrderBulkUpdate,
  });
  const {
    isBulkEditOpen, setIsBulkEditOpen,
    bulkField, setBulkField, bulkValue, setBulkValue,
    bulkStatusReason, setBulkStatusReason, bulkStatusReasonNote, setBulkStatusReasonNote,
    isMassDeleteOpen, setIsMassDeleteOpen,
    resetBulkEditor, handleBulkUpdate, handleMassDelete, confirmMassDelete,
  } = bulkActions;

  // --- Permissions (derived) ---
  const canViewOrderDetails =
    Boolean(currentUser) ||
    hasPermission('order.view_details') ||
    hasPermission('order.view');
  const canEditOrders = hasPermission('order.edit');
  const canDeleteOrders = hasPermission('order.delete');
  const canViewOrderPayments = hasPermission('order.payment.view');
  const canViewCustomerContact = hasPermission('customer.contact.view');
  const canViewStaffContact = hasPermission('staff.contact.view');
  const canViewRoute = hasPermission('map.view_route');
  const canAssignTechnician = hasPermission('order.assign_technician') || canEditOrders;
  const canEditOrderPrice =
    canEditOrders ||
    hasPermission('order.payment.edit_type') ||
    hasPermission('order.payment.edit_status') ||
    hasPermission('finance.manage');
  const canUploadPaymentProof =
    hasPermission('order.payment.edit_status') ||
    hasPermission('finance.manage') ||
    canAccessAllOrders ||
    isCsUser;
  const canShowOrderActions =
    canViewCustomerContact ||
    canViewRoute ||
    canViewOrderDetails ||
    canViewOrderPayments ||
    canEditOrders ||
    canDeleteOrders;


  // --- Local UI State ---
  const [viewMode, setViewMode] = useState<OrderViewMode>('table');
  const [showOrderSelection, setShowOrderSelection] = useState(false);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingOrder, setEditingOrder] = useState<Order | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [isDetailOpen, setIsDetailOpen] = useState(false);
  const [detailOrder, setDetailOrder] = useState<Order | null>(null);
  const [isPaymentDialogOpen, setIsPaymentDialogOpen] = useState(false);
  const [paymentOrder, setPaymentOrder] = useState<Order | null>(null);
  const [photoViewerOrder, setPhotoViewerOrder] = useState<Order | null>(null);
  const [photoViewerTab, setPhotoViewerTab] = useState<OrderDocumentationKey>('before');
  const [expandedPhotoTabs, setExpandedPhotoTabs] = useState<Partial<Record<OrderDocumentationKey, boolean>>>({});
  const [isUploading, setIsUploading] = useState(false);
  const [uploadedFiles, setUploadedFiles] = useState<File[]>([]);
  const [savingOrderActionKey, setSavingOrderActionKey] = useState<string | null>(null);
  const [isFilterDialogOpen, setIsFilterDialogOpen] = useState(false);
  const [waSheetOpen, setWaSheetOpen] = useState(false);
  const [waTargetOrder, setWaTargetOrder] = useState<Order | null>(null);
  const orderTableDragRef = React.useRef({
    active: false,
    dragging: false,
    orderId: null as string | null,
    pointerId: null as number | null,
    scrollLeft: 0,
    startX: 0,
  });
  const suppressNextOrderRowClickRef = React.useRef(false);
  const suppressOrderTableClickRef = React.useRef(false);
  const orderStatusDragRef = React.useRef({
    active: false,
    dragging: false,
    pointerId: null as number | null,
    scrollLeft: 0,
    startX: 0,
  });
  const suppressOrderStatusClickRef = React.useRef(false);
  const photoViewerOpenGuardRef = React.useRef<{ orderId: string; at: number } | null>(null);
  const orderSortSelectValue = sortConfig?.key === 'price'
    ? `price-${sortConfig.direction}`
    : 'default';
  const clearOrderTableInteractionGuards = useCallback(() => {
    suppressOrderTableClickRef.current = false;
    suppressNextOrderRowClickRef.current = false;
    orderTableDragRef.current.dragging = false;
  }, []);
  const handleOrderSortSelectChange = useCallback((value: string) => {
    if (value === 'price-desc') {
      setPriceSortDirection('desc');
      return;
    }

    if (value === 'price-asc') {
      setPriceSortDirection('asc');
      return;
    }

    setPriceSortDirection(null);
  }, [setPriceSortDirection]);
  const deleteOrderTarget = useMemo(
    () => (deleteId ? orders.find((order) => order.id === deleteId) || null : null),
    [deleteId, orders],
  );
  const orderTableColumnCount = (showOrderSelection ? 1 : 0) + 9 + (canShowOrderActions ? 1 : 0);

  // --- Helpers ---
  const getTechnicianName = useCallback((id?: string) => users.find(u => u.id === id)?.name || '-', [users]);
  const getServiceName = useCallback(
    (id?: string) => (id ? services.find(s => s.id === id)?.name || serviceNameFallbackMap[id] || '-' : '-'),
    [serviceNameFallbackMap, services],
  );
  const getVehicleName = useCallback(
    (id?: string) => (id ? vehicles.find(v => v.id === id)?.name || vehicleNameFallbackMap[id] || '-' : '-'),
    [vehicleNameFallbackMap, vehicles],
  );
  const getTechnicianOffSchedule = useCallback(
    (technicianId?: string | null, serviceDate?: string | null) =>
      getTechnicianDaySchedule(technicianId, serviceDate, technicianSchedules),
    [technicianSchedules]
  );

  // --- Upload ---
  const uploadToStorage = async (file: File, path: string) => {
    try {
      const rawExt = file.name.split('.').pop()?.toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
      const fileExt = rawExt === 'jpeg' ? 'jpg' : rawExt;
      const randomPart =
        typeof crypto !== 'undefined' && 'randomUUID' in crypto
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      const fileName = `${path}/${Date.now()}-${randomPart}.${fileExt}`;
      const { error: uploadError } = await supabase.storage.from('orders').upload(fileName, file, {
        cacheControl: '31536000',
        contentType: file.type || undefined,
        upsert: false,
      });
      if (uploadError) throw uploadError;
      const { data } = supabase.storage.from('orders').getPublicUrl(fileName);
      return data.publicUrl;
    } catch (e: unknown) {
      console.error('Upload failed:', e);
      throw e;
    }
  };

  const handleSavePaymentProof = async () => {
    if (!photoViewerOrder || uploadedFiles.length === 0) return;
    setIsUploading(true);
    try {
      const preparedFiles = await Promise.all(
        uploadedFiles.map((file, index) => prepareOrderPaymentProofUpload(file, index))
      );
      const uploadPromises = preparedFiles.map(file =>
        uploadToStorage(file, `${photoViewerOrder.id}/payment`)
      );
      const newPhotos = await Promise.all(uploadPromises);
      const currentPhotos = photoViewerOrder.photos || {};
      const existingPaymentPhotos = currentPhotos.payment || [];
      const updatedPhotos = {
        ...currentPhotos,
        payment: [...existingPaymentPhotos, ...newPhotos],
        paymentDeleted: false,
        paymentDeletedAt: undefined,
      };
      await updateOrder({ ...photoViewerOrder, photos: updatedPhotos });
      setPhotoViewerOrder(prev => prev ? ({ ...prev, photos: updatedPhotos }) : null);
      toast.success("Bukti pembayaran berhasil diupload");
      setUploadedFiles([]);
    } catch (e: unknown) {
      toast.error(getOrderCrudErrorMessage(e, 'Gagal upload bukti pembayaran'));
    } finally {
      setIsUploading(false);
    }
  };

  // --- Coordinate Resolution ---
  const attemptedResolution = React.useRef<Set<string>>(new Set());

  useEffect(() => {
    const resolveMissingCoordinates = async () => {
      const ordersToFix = orders.filter(o =>
        o.mapsUrl &&
        !attemptedResolution.current.has(o.id) &&
        (!o.lat || !o.lng || (Math.abs(o.lat - -6.2088) < 0.0001 && Math.abs((o.lng || 0) - 106.8456) < 0.0001))
      );

      if (ordersToFix.length === 0) return;

      for (const order of ordersToFix.slice(0, 5)) {
        attemptedResolution.current.add(order.id);
        try {
          let url = order.mapsUrl;
          if (url && (url.includes('goo.gl') || url.includes('maps.app.goo.gl'))) {
            const expanded = await expandShortUrl(url);
            if (expanded) url = expanded;
          }
          if (url) {
            const coords = getCoordinatesFromUrl(url);
            if (coords && !(Math.abs(coords.lat - -6.2088) < 0.0001 && Math.abs(coords.lng - 106.8456) < 0.0001)) {
              await updateOrder({ ...order, lat: coords.lat, lng: coords.lng });
            }
          }
        } catch (e) {
          console.error('Failed to resolve coordinates for order:', order.id, e);
        }
      }
    };

    resolveMissingCoordinates();
  }, [orders, updateOrder]);

  // --- Handlers ---
  const handleViewDetail = useCallback((order: Order) => {
    setDetailOrder(order);
    setIsDetailOpen(true);
  }, []);

  const handleOpenPhotoViewer = useCallback((
    order: Order,
    event?: React.SyntheticEvent<HTMLElement>,
  ) => {
    event?.preventDefault();
    event?.stopPropagation();
    const now = Date.now();
    const recentOpen = photoViewerOpenGuardRef.current;
    if (recentOpen?.orderId === order.id && now - recentOpen.at < 400) {
      return;
    }
    photoViewerOpenGuardRef.current = { orderId: order.id, at: now };
    setPhotoViewerTab(getInitialPhotoTab(order));
    setExpandedPhotoTabs({});
    setUploadedFiles([]);
    setPhotoViewerOrder(order);
  }, []);

  const handleClosePhotoViewer = useCallback(() => {
    setPhotoViewerOrder(null);
    setExpandedPhotoTabs({});
    setUploadedFiles([]);
  }, []);

  useEffect(() => {
    if (!photoViewerOrder) return;
    const latestOrder = orders.find((order) => order.id === photoViewerOrder.id);
    if (latestOrder && latestOrder !== photoViewerOrder) {
      setPhotoViewerOrder(latestOrder);
    }
  }, [orders, photoViewerOrder]);

  const isOrderRowInteractiveTarget = (target: EventTarget | null, currentTarget?: HTMLElement) => {
    if (!(target instanceof HTMLElement)) return false;
    const interactiveElement = target.closest(ORDER_TABLE_INTERACTIVE_SELECTOR);
    if (!interactiveElement) return false;
    // Radix dropdown content is portaled outside the table row, but React still bubbles
    // menu item clicks through the row component tree. Treat those as row-safe actions.
    return interactiveElement !== currentTarget;
  };

  const isOrderCardInteractiveTarget = (target: EventTarget | null, currentTarget: HTMLElement) => {
    if (!(target instanceof HTMLElement)) return false;
    const interactiveElement = target.closest(ORDER_TABLE_INTERACTIVE_SELECTOR);
    return Boolean(interactiveElement && interactiveElement !== currentTarget);
  };

  const resetOrderTableDrag = (target: HTMLDivElement, pointerId?: number) => {
    if (pointerId !== undefined && target.hasPointerCapture?.(pointerId)) {
      target.releasePointerCapture(pointerId);
    }
    target.removeAttribute('data-dragging');
    orderTableDragRef.current.active = false;
    orderTableDragRef.current.dragging = false;
    orderTableDragRef.current.orderId = null;
    orderTableDragRef.current.pointerId = null;
  };

  const resetOrderStatusDrag = (target: HTMLDivElement, pointerId?: number) => {
    if (pointerId !== undefined && target.hasPointerCapture?.(pointerId)) {
      target.releasePointerCapture(pointerId);
    }
    target.removeAttribute('data-dragging');
    orderStatusDragRef.current.active = false;
    orderStatusDragRef.current.dragging = false;
    orderStatusDragRef.current.pointerId = null;
  };

  const handleOrderStatusPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;

    const scroller = event.currentTarget;
    if (scroller.scrollWidth <= scroller.clientWidth) return;

    suppressOrderStatusClickRef.current = false;
    orderStatusDragRef.current = {
      active: true,
      dragging: false,
      pointerId: event.pointerId,
      scrollLeft: scroller.scrollLeft,
      startX: event.clientX,
    };
    scroller.setPointerCapture?.(event.pointerId);
  };

  const handleOrderStatusPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = orderStatusDragRef.current;
    if (!drag.active || drag.pointerId !== event.pointerId) return;

    const deltaX = event.clientX - drag.startX;
    if (Math.abs(deltaX) > 6) {
      drag.dragging = true;
      suppressOrderStatusClickRef.current = true;
      event.currentTarget.setAttribute('data-dragging', 'true');
      event.preventDefault();
      event.currentTarget.scrollLeft = drag.scrollLeft - deltaX;
    }
  };

  const handleOrderStatusPointerEnd = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = orderStatusDragRef.current;
    if (!drag.active || drag.pointerId !== event.pointerId) return;

    if (drag.dragging) {
      suppressOrderStatusClickRef.current = true;
      window.setTimeout(() => {
        suppressOrderStatusClickRef.current = false;
      }, 0);
    }
    resetOrderStatusDrag(event.currentTarget, event.pointerId);
  };

  const handleOrderStatusFilterClick = (event: React.MouseEvent<HTMLButtonElement>, nextStatus: string) => {
    if (suppressOrderStatusClickRef.current || orderStatusDragRef.current.dragging) {
      event.preventDefault();
      event.stopPropagation();
      suppressOrderStatusClickRef.current = false;
      return;
    }

    setStatusFilter(nextStatus);
  };

  const handleOrderSelectionModeChange = useCallback((checked: boolean) => {
    setShowOrderSelection(checked);
    if (!checked) {
      setSelectedIds(new Set());
    }
  }, [setSelectedIds]);

  const handleOrderRowClick = (event: React.MouseEvent<HTMLTableRowElement>, order: Order) => {
    if (suppressNextOrderRowClickRef.current) {
      suppressNextOrderRowClickRef.current = false;
      return;
    }
    if (!canViewOrderDetails || isOrderRowInteractiveTarget(event.target, event.currentTarget)) return;

    handleViewDetail(order);
  };

  const handleOrderRowKeyDown = (event: React.KeyboardEvent<HTMLTableRowElement>, order: Order) => {
    if (!canViewOrderDetails || isOrderRowInteractiveTarget(event.target, event.currentTarget)) return;

    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      handleViewDetail(order);
    }
  };

  const handleOrderCardClick = (event: React.MouseEvent<HTMLDivElement>, order: Order) => {
    if (!canViewOrderDetails || isOrderCardInteractiveTarget(event.target, event.currentTarget)) return;
    handleViewDetail(order);
  };

  const handleOrderCardKeyDown = (event: React.KeyboardEvent<HTMLDivElement>, order: Order) => {
    if (!canViewOrderDetails || isOrderCardInteractiveTarget(event.target, event.currentTarget)) return;

    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      handleViewDetail(order);
    }
  };

  const parseInlinePrice = (value: string) => parseInt(value.replace(/\D/g, ''), 10) || 0;

  const handleOrderTableClickCapture = (event: React.MouseEvent<HTMLDivElement>) => {
    if (suppressOrderTableClickRef.current || orderTableDragRef.current.dragging) {
      event.preventDefault();
      event.stopPropagation();
      suppressOrderTableClickRef.current = false;
      suppressNextOrderRowClickRef.current = false;
    }
  };

  const openInlinePriceEditor = (order: Order) => {
    setEditingPriceId(order.id);
    setTempPrice(order.price.toLocaleString('id-ID'));
  };

  const saveOrderPatch = async (
    order: Order,
    patch: Partial<Order>,
    successMessage: string,
    actionKey: string,
  ) => {
    const key = `${order.id}:${actionKey}`;
    setSavingOrderActionKey(key);
    try {
      await updateOrderPatch(order.id, patch, { silent: true });
      toast.success(successMessage);
    } catch (error: unknown) {
      console.error('Failed to update order:', error);
      toast.error(getOrderCrudErrorMessage(error, 'Gagal memperbarui pesanan'));
      throw error;
    } finally {
      setSavingOrderActionKey((currentKey) => currentKey === key ? null : currentKey);
    }
  };

  const handleSaveInlinePrice = async (order: Order) => {
    const rawPrice = parseInlinePrice(tempPrice);

    try {
      await saveOrderPatch(order, { price: rawPrice }, 'Harga berhasil diperbarui', 'price');
      setEditingPriceId(null);
    } catch (error) {
      console.error('Failed to update order price:', error);
    }
  };

  const handleOrderTablePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || isOrderRowInteractiveTarget(event.target)) return;

    const scroller = event.currentTarget;
    if (scroller.scrollWidth <= scroller.clientWidth) return;
    const orderRow = event.target instanceof HTMLElement
      ? event.target.closest<HTMLTableRowElement>('tr[data-order-id]')
      : null;

    suppressOrderTableClickRef.current = false;
    suppressNextOrderRowClickRef.current = false;
    orderTableDragRef.current = {
      active: true,
      dragging: false,
      orderId: orderRow?.dataset.orderId || null,
      pointerId: event.pointerId,
      scrollLeft: scroller.scrollLeft,
      startX: event.clientX,
    };
    scroller.setPointerCapture?.(event.pointerId);
  };

  const handleOrderTablePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = orderTableDragRef.current;
    if (!drag.active || drag.pointerId !== event.pointerId) return;

    const deltaX = event.clientX - drag.startX;
    if (Math.abs(deltaX) > 8) {
      drag.dragging = true;
      suppressOrderTableClickRef.current = true;
      event.currentTarget.setAttribute('data-dragging', 'true');
      event.preventDefault();
      event.currentTarget.scrollLeft = drag.scrollLeft - deltaX;
    }
  };

  const handleOrderTablePointerEnd = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = orderTableDragRef.current;
    if (!drag.active || drag.pointerId !== event.pointerId) return;

    const shouldOpenDetail =
      !drag.dragging &&
      canViewOrderDetails &&
      !!drag.orderId &&
      !isOrderRowInteractiveTarget(event.target);

    const targetOrder = shouldOpenDetail
      ? paginatedOrders.find((order) => order.id === drag.orderId) || orders.find((order) => order.id === drag.orderId)
      : null;

    if (drag.dragging) {
      suppressOrderTableClickRef.current = true;
      window.setTimeout(() => {
        suppressOrderTableClickRef.current = false;
      }, 0);
    } else if (targetOrder) {
      suppressNextOrderRowClickRef.current = true;
      handleViewDetail(targetOrder);
      window.setTimeout(() => {
        suppressNextOrderRowClickRef.current = false;
      }, 0);
    }
    resetOrderTableDrag(event.currentTarget, event.pointerId);
  };

  const handleViewPayment = useCallback((order: Order) => {
    setPaymentOrder(order);
    setIsPaymentDialogOpen(true);
  }, []);

  const handleEdit = useCallback((order: Order) => {
    setEditingOrder(order);
    setIsFormOpen(true);
  }, []);

  const handleDelete = useCallback((id: string) => {
    setDeleteId(id);
  }, []);

  const confirmDelete = useCallback(async () => {
    if (deleteId) {
      const orderToDelete = orders.find(o => o.id === deleteId);
      try {
        await deleteOrder(deleteId);
        toast.success('Pesanan berhasil dihapus');
        if (currentUser && orderToDelete) {
          logActivity(
            { id: currentUser.id, name: currentUser.name, role: currentUser.role },
            'DELETE',
            'Pesanan',
            `Menghapus pesanan: ${orderToDelete.customerName}`,
            deleteId
          );
        }
        setDeleteId(null);
      } catch (error: unknown) {
        toast.error(getUnknownErrorMessage(error, 'Gagal menghapus pesanan'));
      }
    }
  }, [deleteId, orders, deleteOrder, currentUser]);

  // --- WhatsApp ---
  const isTemplateUsed = useCallback((order: Order, templateId: string) => {
    return order.templateHistory?.some(h => h.templateId === templateId);
  }, []);

  const handleWhatsappTemplate = useCallback((order: Order, template?: WATemplate) => {
    const phone = order.customerPhone.replace(/^0/, '62').replace(/\D/g, '');
    let message = "";

    if (template) {
      message = template.message;
      message = message.replace(/\[Nama\]/g, order.customerName);
      message = message.replace(/\[Mobil\]/g, getVehicleName(order.vehicleId));
      message = message.replace(/\[Order ID\]/g, '\`\`\`' + order.id + '\`\`\`');

      const newHistory = {
        templateId: template.id,
        templateName: template.title,
        sentAt: new Date().toISOString(),
        sentBy: currentUser?.id
      };

      updateOrder({
        ...order,
        templateHistory: [...(order.templateHistory || []), newHistory]
      });
    }

    const url = `https://wa.me/${phone}${message ? `?text=${encodeURIComponent(message)}` : ''}`;
    window.open(url, '_blank');
  }, [getVehicleName, currentUser, updateOrder]);

  const handleSaveOrderToContacts = useCallback(async (order: Order) => {
    const toastId = toast.loading('Menyimpan pelanggan ke Kontak CRM...');
    try {
      const result = await saveOrderToCrmContact(order, {
        savedBy: currentUser?.id,
        savedFrom: 'pesanan',
      });
      toast.dismiss(toastId);
      if (!result.available) {
        toast.warning('Tabel Kontak CRM belum tersedia, pelanggan belum tersimpan.');
        return;
      }
      toast.success('Pelanggan tersimpan ke Kontak CRM');
    } catch (error: unknown) {
      toast.dismiss(toastId);
      toast.error(getUnknownErrorMessage(error, 'Gagal menyimpan pelanggan ke Kontak CRM'));
    }
  }, [currentUser?.id]);

  const handleSaveSelectedOrdersToContacts = useCallback(async () => {
    const selectedOrders = orders.filter((order) => selectedIds.has(order.id));
    if (!selectedOrders.length) {
      toast.info('Pilih pesanan dulu untuk disimpan ke Kontak CRM.');
      return;
    }

    const toastId = toast.loading(`Menyimpan ${selectedOrders.length} pelanggan ke Kontak CRM...`);
    try {
      const result = await saveOrdersToCrmContacts(selectedOrders, {
        savedBy: currentUser?.id,
        savedFrom: 'pesanan_massal',
      });
      toast.dismiss(toastId);
      if (!result.available) {
        toast.warning('Tabel Kontak CRM belum tersedia, pelanggan belum tersimpan.');
        return;
      }
      if (result.saved > 0) {
        toast.success(`${result.saved} pelanggan tersimpan ke Kontak CRM`);
      }
      if (result.failed > 0) {
        toast.warning(`${result.failed} pelanggan gagal disimpan ke Kontak CRM`);
      }
      setSelectedIds(new Set());
    } catch (error: unknown) {
      toast.dismiss(toastId);
      toast.error(getUnknownErrorMessage(error, 'Gagal menyimpan pelanggan ke Kontak CRM'));
    }
  }, [currentUser?.id, orders, selectedIds, setSelectedIds]);

  const renderOrderActions = (order: Order, layout: 'desktop' | 'mobile' = 'desktop') => {
    const locked = isOrderLocked(order.status);
    const iconClass = layout === 'mobile' ? 'h-9 w-9' : '';
    const usedTemplateCount = new Set(order.templateHistory?.map((history) => history.templateId)).size;
    const orderTemplates = waTemplates.filter((template) =>
      template.category === 'Orders' || template.category === 'General' || !template.category
    );
    const documentationSummary = getOrderDocumentationSummary(order);
    const documentationToneClass = documentationSummary.isComplete
      ? 'text-emerald-600 hover:text-emerald-700'
      : documentationSummary.isEmpty
        ? 'text-slate-500 hover:text-slate-700'
        : 'text-amber-600 hover:text-amber-700';
    const documentationBadgeClass = documentationSummary.isComplete
      ? 'bg-emerald-500 text-white'
      : documentationSummary.isEmpty
        ? 'bg-red-500 text-white'
        : 'bg-amber-500 text-white';

    const hasMenuActions =
      canViewOrderDetails ||
      canViewOrderPayments ||
      canViewCustomerContact ||
      (canViewRoute && !!order.mapsUrl) ||
      ((canEditOrders || canDeleteOrders) && !locked) ||
      ((canEditOrders || canDeleteOrders) && locked);

    if (!hasMenuActions) return null;

    return (
      <TooltipProvider delayDuration={150}>
        <div className="rowActions orderRowActions">
          {canViewCustomerContact && (
            layout === 'mobile' ? (
              <OrderActionButton
                label="WhatsApp customer"
                onClick={() => {
                  setWaTargetOrder(order);
                  setWaSheetOpen(true);
                }}
                className={`${iconClass} text-[#128C7E] hover:text-[#075E54]`}
              >
                <WhatsappIcon className="h-4 w-4" />
                {usedTemplateCount > 0 && (
                  <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-blue-600 px-1 text-[9px] font-bold text-white ring-2 ring-white dark:ring-slate-900">
                    {usedTemplateCount}
                  </span>
                )}
              </OrderActionButton>
            ) : (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label="WhatsApp customer"
                  title="WhatsApp customer"
                  className={`${ORDER_ACTION_ICON_CLASS} ${iconClass} text-[#128C7E] hover:text-[#075E54]`}
                >
                  <WhatsappIcon className="h-4 w-4" />
                  {usedTemplateCount > 0 && (
                    <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-blue-600 px-1 text-[9px] font-bold text-white ring-2 ring-white dark:ring-slate-900">
                      {usedTemplateCount}
                    </span>
                  )}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="z-[60] w-[320px] border-slate-100 bg-white p-0 shadow-xl dark:border-slate-700 dark:bg-slate-800">
                <div className="flex items-start justify-between border-b border-slate-100 bg-slate-50/60 px-4 py-3 dark:border-slate-700 dark:bg-slate-800">
                  <div>
                    <h4 className="text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300">Template WhatsApp</h4>
                    <p className="mt-0.5 text-[10px] text-slate-400">
                      {usedTemplateCount} dari {orderTemplates.length} digunakan
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 -mr-2 -mt-1 text-slate-400 hover:bg-transparent hover:text-slate-600"
                    title="Kelola template"
                    aria-label="Kelola template WhatsApp"
                    onPointerDown={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      openWhatsAppTemplateManager();
                    }}
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      openWhatsAppTemplateManager();
                    }}
                  >
                    <Settings className="h-3.5 w-3.5" />
                  </Button>
                </div>

                <div className="max-h-[300px] overflow-y-auto py-1 custom-scrollbar">
                  {orderTemplates.map((template) => {
                    const isUsed = isTemplateUsed(order, template.id);
                    return (
                      <DropdownMenuItem
                        key={template.id}
                        onClick={() => handleWhatsappTemplate(order, template)}
                        className={`mx-1 my-0.5 flex cursor-pointer flex-col items-start gap-1 rounded-md px-4 py-3 hover:bg-slate-50 dark:hover:bg-slate-700/50 ${isUsed ? 'bg-blue-50/50 dark:bg-blue-900/20' : ''}`}
                      >
                        <div className="flex w-full items-center justify-between">
                          <span className={`text-sm font-medium ${isUsed ? 'text-blue-700 dark:text-blue-400' : 'text-slate-900 dark:text-slate-200'}`}>
                            {template.title}
                          </span>
                          {isUsed && <CheckCircle2 className="h-3.5 w-3.5 text-blue-600 dark:text-blue-500" />}
                        </div>
                        <span className="line-clamp-1 w-full text-left text-xs font-normal leading-relaxed text-slate-500 dark:text-slate-400">
                          {template.message.replace(/\[Nama\]/g, order.customerName).substring(0, 50)}...
                        </span>
                      </DropdownMenuItem>
                    );
                  })}
                </div>

                <div className="border-t border-slate-100 bg-slate-50/40 p-2 dark:border-slate-700 dark:bg-slate-800/30">
                  <Button
                    type="button"
                    variant="ghost"
                    className="h-9 w-full justify-center border border-transparent text-xs text-slate-600 shadow-sm transition-all hover:border-slate-200 hover:bg-white hover:text-slate-900 dark:text-slate-400"
                    onClick={() => handleWhatsappTemplate(order)}
                  >
                    Chat Manual
                  </Button>
                </div>
              </DropdownMenuContent>
            </DropdownMenu>
            )
          )}

          {canViewOrderDetails && layout === 'mobile' && (
            <OrderActionButton label="Detail Pesanan" onClick={() => handleViewDetail(order)} className={iconClass}>
              <Eye className="h-4 w-4" />
            </OrderActionButton>
          )}

          {canViewOrderDetails && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={documentationSummary.isEmpty ? 'Dokumentasi' : documentationSummary.tooltip}
              title={documentationSummary.isEmpty ? 'Dokumentasi' : documentationSummary.tooltip}
              onPointerDownCapture={(event) => {
                event.stopPropagation();
                suppressOrderTableClickRef.current = false;
                suppressNextOrderRowClickRef.current = false;
              }}
              onPointerUp={(event) => {
                if (event.pointerType === 'mouse' && event.button !== 0) return;
                handleOpenPhotoViewer(order, event);
              }}
              onTouchEnd={(event) => {
                handleOpenPhotoViewer(order, event);
              }}
              onClick={(event) => {
                handleOpenPhotoViewer(order, event);
              }}
              className={`${ORDER_ACTION_ICON_CLASS} ${iconClass} ${documentationToneClass}`.trim()}
            >
              <Camera className="h-4 w-4" />
              {!documentationSummary.isEmpty && (
                <span className={`absolute -right-1 -top-1 flex h-4 min-w-5 items-center justify-center rounded-full px-1 text-[9px] font-bold ring-2 ring-white dark:ring-slate-900 ${documentationBadgeClass}`}>
                  {documentationSummary.label}
                </span>
              )}
            </Button>
          )}

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label="Menu aksi pesanan"
                title="Menu aksi"
                className={`${ORDER_ACTION_ICON_CLASS} ${iconClass}`}
              >
                <MoreVertical className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className={ORDER_MENU_CONTENT_CLASS}>
              <DropdownMenuLabel className="flex flex-col gap-0.5">
                <span className="text-xs font-bold uppercase tracking-wider text-slate-500">Aksi Pesanan</span>
                <span className="truncate text-xs font-normal text-slate-400">#{order.id}</span>
              </DropdownMenuLabel>
              <DropdownMenuSeparator className="bg-slate-100 dark:bg-slate-700" />

              {canViewOrderDetails && (
                <DropdownMenuItem onClick={() => handleViewDetail(order)} className={ORDER_MENU_ITEM_CLASS}>
                  <Eye className="h-4 w-4" /> Detail Pesanan
                </DropdownMenuItem>
              )}
              {canViewOrderDetails && (
                <DropdownMenuItem
                  onClick={(event) => {
                    handleOpenPhotoViewer(order, event);
                  }}
                  className={ORDER_MENU_ITEM_CLASS}
                >
                  <Camera className="h-4 w-4" /> Dokumentasi
                  {!documentationSummary.isEmpty && (
                    <span className={`ml-auto rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${documentationSummary.isComplete ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300' : 'bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300'}`}>
                      {documentationSummary.label}
                    </span>
                  )}
                </DropdownMenuItem>
              )}
              {canViewOrderPayments && (
                <DropdownMenuItem onClick={() => handleViewPayment(order)} className={ORDER_MENU_ITEM_CLASS}>
                  <CreditCard className="h-4 w-4" /> Pembayaran
                </DropdownMenuItem>
              )}
              {canViewRoute && order.mapsUrl && (
                <DropdownMenuItem
                  onClick={() => window.open(order.mapsUrl, '_blank', 'noopener,noreferrer')}
                  className={ORDER_MENU_ITEM_CLASS}
                >
                  <MapIcon className="h-4 w-4" /> Buka Maps
                </DropdownMenuItem>
              )}

              {canViewCustomerContact && (
                <>
                  <DropdownMenuSeparator className="bg-slate-100 dark:bg-slate-700" />
                  <DropdownMenuItem onClick={() => void handleSaveOrderToContacts(order)} className={ORDER_MENU_ITEM_CLASS}>
                    <UserIcon className="h-4 w-4" /> Simpan Kontak CRM
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => handleWhatsappTemplate(order)} className={ORDER_MENU_ITEM_CLASS}>
                    <MessageCircle className="h-4 w-4" /> Chat Manual
                  </DropdownMenuItem>
                </>
              )}

              {(canEditOrders || canDeleteOrders) && (
                <>
                  <DropdownMenuSeparator className="bg-slate-100 dark:bg-slate-700" />
                  {locked ? (
                    <DropdownMenuItem disabled className="gap-2 text-sm">
                      <Lock className="h-4 w-4" /> Order terkunci
                    </DropdownMenuItem>
                  ) : (
                    <>
                      {canEditOrders && (
                        <DropdownMenuItem onClick={() => handleEdit(order)} className={ORDER_MENU_ITEM_CLASS}>
                          <Edit className="h-4 w-4" /> Edit Pesanan
                        </DropdownMenuItem>
                      )}
                      {canDeleteOrders && (
                        <DropdownMenuItem
                          onClick={() => handleDelete(order.id)}
                          className="cursor-pointer gap-2 text-sm text-red-600 focus:bg-red-50 focus:text-red-600 dark:focus:bg-red-950/30"
                        >
                          <Trash2 className="h-4 w-4" /> Hapus Pesanan
                        </DropdownMenuItem>
                      )}
                    </>
                  )}
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </TooltipProvider>
    );
  };

  // --- Map Data ---
  const isMapView = viewMode === 'map';
  const routeGroups = useMemo(() => {
    if (!isMapView) return [];

    const getDistance = (lat1?: number, lon1?: number, lat2?: number, lon2?: number) => {
      if (!lat1 || !lon1 || !lat2 || !lon2) return 0;
      const R = 6371;
      const dLat = (lat2 - lat1) * (Math.PI / 180);
      const dLon = (lon2 - lon1) * (Math.PI / 180);
      const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);
      const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
      return R * c;
    };

    const TECH_COLORS = [
      '#0E7490', '#E11D48', '#D97706', '#4F46E5', '#059669', '#7C3AED', '#DB2777',
    ];

    const groupedOrders: { [key: string]: Order[] } = {};
    filteredOrders.forEach(order => {
      const techId = order.technicianId || 'unassigned';
      if (!groupedOrders[techId]) groupedOrders[techId] = [];
      groupedOrders[techId].push(order);
    });

    return Object.entries(groupedOrders).map(([techId, techOrders], groupIndex) => {
      const technician = users.find(u => u.id === techId);
      const technicianName = technician ? technician.name : (techId === 'unassigned' ? 'Belum Ditugaskan' : 'Unknown');
      const color = TECH_COLORS[groupIndex % TECH_COLORS.length];

      const sorted = [...techOrders].sort((a, b) => {
        const timeA = a.serviceTime || '23:59';
        const timeB = b.serviceTime || '23:59';
        return timeA.localeCompare(timeB);
      });

      const points = sorted.map((order, index) => {
        let lat = order.lat;
        let lng = order.lng;
        let isFallback = false;

        if ((!lat || !lng) && order.mapsUrl) {
          const coords = getCoordinatesFromUrl(order.mapsUrl);
          if (coords) { lat = coords.lat; lng = coords.lng; }
        }

        const isDefaultLoc = (l: number, g: number) =>
          (Math.abs(l - -6.2088) < 0.0001 && Math.abs(g - 106.8456) < 0.0001);

        if (!lat || !lng || isDefaultLoc(lat, lng)) {
          lat = -6.2088;
          lng = 106.8456;
          isFallback = true;
        }

        if (isFallback) {
          const angle = index * (Math.PI / 3);
          const radius = 0.0004 + (index * 0.00005);
          lat += Math.cos(angle) * radius;
          lng += Math.sin(angle) * radius;
        }

        let distance = '0 km';
        let travelTimeEstimate = '';

        if (index > 0) {
          const prev = sorted[index - 1];
          let prevLat = prev.lat;
          let prevLng = prev.lng;

          if ((!prevLat || !prevLng) && prev.mapsUrl) {
            const prevCoords = getCoordinatesFromUrl(prev.mapsUrl);
            if (prevCoords) { prevLat = prevCoords.lat; prevLng = prevCoords.lng; }
          }

          if (!prevLat || !prevLng) { prevLat = -6.2088; prevLng = 106.8456; }

          if (lat && lng && prevLat && prevLng) {
            const d = getDistance(prevLat, prevLng, lat, lng);
            distance = `${d.toFixed(1)} km`;
            const minutes = Math.round(d * 2);
            const finalMinutes = minutes + (d > 0.5 ? 5 : 0);
            travelTimeEstimate = `\u00b1 ${finalMinutes} mnt`;
          }
        }

        return {
          id: order.id, name: order.customerName, address: order.address,
          lat: lat || 0, lng: lng || 0, status: order.status,
          time: order.serviceTime, distance, travelTimeEstimate,
          technicianName, isFallback, orderIndex: index + 1
        };
      });

      return { id: techId, technicianName, color, points };
    }).filter(group => group.points.length > 0);
  }, [filteredOrders, isMapView, users]);

  const branchPoints = useMemo(() => {
    if (!isMapView) return [];

    const parseBranchCoords = (url?: string) => {
      if (!url) return null;
      try {
        const patterns = [
          /@(-?\d+\.\d+),(-?\d+\.\d+)/,
          /[?&]q=(-?\d+\.\d+),(-?\d+\.\d+)/,
          /search\/.*\/(-?\d+\.\d+),(-?\d+\.\d+)/
        ];
        for (const pattern of patterns) {
          const match = url.match(pattern);
          if (match) return { lat: parseFloat(match[1]), lng: parseFloat(match[2]) };
        }
      } catch (e) { console.error(e); }
      return null;
    };

    return branches.map(branch => {
      let lat = branch.lat;
      let lng = branch.lng;
      let radius = branch.radius;

      if (branch.mapsUrl) {
        const coords = parseBranchCoords(branch.mapsUrl);
        if (coords) {
          return { id: branch.id, name: branch.name, code: branch.code, lat: coords.lat, lng: coords.lng, address: branch.address, radius: radius || 0 };
        }
      }

      if (lat && lng) {
        return { id: branch.id, name: branch.name, code: branch.code, lat, lng, address: branch.address, radius: radius || 0 };
      }

      return null;
    }).filter(Boolean) as { id: string; name: string; code?: string; lat: number; lng: number; address?: string; radius: number }[];
  }, [branches, isMapView]);


  // Access Control Check (Render Level)
  if (!hasPermission('order.view')) {
    return (
      <div className="flex flex-col items-center justify-center h-[80vh] text-center p-8">
        <div className="bg-slate-100 dark:bg-slate-800 p-6 rounded-full mb-4">
           <svg className="w-12 h-12 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
           </svg>
        </div>
        <h2 className="text-2xl font-bold text-slate-900 dark:text-slate-100">Akses Ditolak</h2>
        <p className="text-slate-500 dark:text-slate-400 mt-2 max-w-md">
          Anda tidak memiliki izin untuk mengakses halaman Pesanan.
        </p>
      </div>
    );
  }

  return (
    <OperationalPageShell className="orderPage">
      <div className="flex flex-col space-y-4">
        <OperationalPageHeader
          title="Pesanan & Layanan"
          subtitle="Kelola pesanan, penugasan teknisi, jadwal, pembayaran, dan komunikasi customer."
          eyebrow="Operasional"
          icon={ClipboardList}
          actions={
            <div className="orderHeaderActions">
             {/* Export Button - Hidden for Advertiser */}
             {!isAdvertiserUser && (
             <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="outline"
                      size="icon"
                      className="orderHeaderIconButton"
                      title="Export / Import Data"
                    >
                      <FileSpreadsheet className="w-4 h-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-56 bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700">
                    <DropdownMenuLabel>Data Management</DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={handleExportCSV} className="cursor-pointer dark:text-slate-200 dark:focus:bg-slate-700">
                      <FileDown className="w-4 h-4 mr-2 text-blue-600 dark:text-blue-400" />
                      Export ke CSV
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={handleExportXLSX} className="cursor-pointer dark:text-slate-200 dark:focus:bg-slate-700">
                      <FileSpreadsheet className="w-4 h-4 mr-2 text-green-600 dark:text-green-400" />
                      Export ke Excel
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={handleExportPDF} className="cursor-pointer dark:text-slate-200 dark:focus:bg-slate-700">
                      <FileText className="w-4 h-4 mr-2 text-red-600 dark:text-red-400" />
                      Export ke PDF
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={handleImportClick} className="cursor-pointer dark:text-slate-200 dark:focus:bg-slate-700">
                      <FileUp className="w-4 h-4 mr-2 text-blue-600 dark:text-blue-400" />
                      Import Excel/CSV
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={handleDownloadTemplate} className="cursor-pointer dark:text-slate-200 dark:focus:bg-slate-700">
                      <FileText className="w-4 h-4 mr-2 text-slate-600 dark:text-slate-400" />
                      Download Template
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
             )}
             {hasPermission('order.create') && (
             <>
                 {/* Mobile Add Button (Square Icon) */}
                 <div className="orderMobileOnly">
                   <Button
                      className="orderHeaderPrimaryIcon"
                      aria-label="Tambah Pesanan"
                      onClick={() => {
                         setEditingOrder(null);
                         setIsFormOpen(true);
                      }}
                   >
                      <Plus className="h-5 w-5" />
                   </Button>
                 </div>

                 {/* Desktop Add Button (Full Text) */}
                 <div className="orderDesktopOnly">
                   <Button
                      className="orderHeaderPrimaryButton"
                      onClick={() => {
                         setEditingOrder(null);
                         setIsFormOpen(true);
                      }}
                   >
                      <Plus className="h-4 w-4" /> Tambah Pesanan
                   </Button>
                 </div>
             </>
             )}
            </div>
          }
        />

        <OrderViewModeTabs
          value={viewMode}
          onChange={setViewMode}
          isAdvertiserUser={isAdvertiserUser}
        />

        <OperationalKpiGrid className="orderKpiGrid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-7">
          <OperationalKpiCard
            label="Total"
            value={ordersTableLoading ? <Skeleton className="h-6 w-14 rounded-md" /> : stats.total.toLocaleString('id-ID')}
            icon={Package}
          />
          <OperationalKpiCard
            label="Selesai"
            value={
              ordersTableLoading ? (
                <Skeleton className="h-6 w-24 rounded-md" />
              ) : (
              <div className="flex items-end gap-2">
                <span>{stats.done.toLocaleString('id-ID')}</span>
                <span className="mb-1 text-xs font-medium opacity-70">({stats.doneUnits.toLocaleString('id-ID')} Unit)</span>
              </div>
              )
            }
            icon={CheckCircle2}
            tone="emerald"
          />
          <OperationalKpiCard
            label="Terjadwal"
            value={ordersTableLoading ? <Skeleton className="h-6 w-14 rounded-md" /> : stats.pending.toLocaleString('id-ID')}
            icon={Calendar}
            tone="amber"
          />
          <OperationalKpiCard
            label="Reschedule"
            value={ordersTableLoading ? <Skeleton className="h-6 w-14 rounded-md" /> : stats.reschedule.toLocaleString('id-ID')}
            icon={RefreshCw}
            tone="violet"
          />
          <OperationalKpiCard
            label="Cancel"
            value={ordersTableLoading ? <Skeleton className="h-6 w-14 rounded-md" /> : stats.cancelled.toLocaleString('id-ID')}
            icon={XCircle}
            tone="rose"
          />
          <OperationalKpiCard
            label="Proses"
            value={ordersTableLoading ? <Skeleton className="h-6 w-14 rounded-md" /> : stats.processing.toLocaleString('id-ID')}
            icon={Loader2}
            tone="blue"
          />
          <OperationalKpiCard
            label="Revenue"
            value={
              ordersTableLoading ? (
                <Skeleton className="h-6 w-20 rounded-md" />
              ) : (
                <span title={`Rp ${stats.revenue.toLocaleString('id-ID')}`}>Rp {(stats.revenue / 1000).toLocaleString('id-ID')}K</span>
              )
            }
            icon={Banknote}
            tone="emerald"
            className="col-span-2 md:col-span-1"
          />
        </OperationalKpiGrid>

        {/* Content Card */}
        <OperationalTableCard className="orderContentPanel">
          
          {/* Toolbar */}
          <OperationalFilterPanel className="orderFilterPanel orderControlPanel rounded-none border-0 border-b border-slate-100 p-4 shadow-none dark:border-slate-700 md:p-5">
            
            {/* Row 1: Status Filter */}
            <div className="orderStatusRail">
              <div
                className="orderStatusStrip"
                role="tablist"
                aria-label="Filter status pesanan"
                onPointerDown={handleOrderStatusPointerDown}
                onPointerMove={handleOrderStatusPointerMove}
                onPointerUp={handleOrderStatusPointerEnd}
                onPointerCancel={handleOrderStatusPointerEnd}
              >
                <Button
                  variant={statusFilter === 'all' ? 'default' : 'outline'}
                  size="sm"
                  onClick={(event) => handleOrderStatusFilterClick(event, 'all')}
                  className={`orderStatusChip ${statusFilter === 'all' ? 'isActive' : ''}`}
                >
                  Semua
                  <span className="orderStatusCount">
                     {filteredOrdersBase.length}
                  </span>
                </Button>
                 {ORDER_STATUS_FILTER_OPTIONS.map(option => (
                    <Button
                      key={option.value}
                      variant={statusFilter === option.value ? 'default' : 'outline'}
                      size="sm"
                      onClick={(event) => handleOrderStatusFilterClick(event, option.value)}
                      className={`orderStatusChip ${statusFilter === option.value ? 'isActive' : ''}`}
                    >
                      {option.label}
                      <span className="orderStatusCount">
                         {statusCounts[option.value] || 0}
                      </span>
                    </Button>
                 ))}
              </div>
            </div>

            {/* Row 2: Filters & Search */}
            <div className="orderFilterGrid">
              <div className="orderFilterMode">
                <Select
                  value={dateFilterMode}
                  onValueChange={(value) => {
                    if (isOrderDateFilterMode(value)) setDateFilterMode(value);
                  }}
                >
                  <SelectTrigger aria-label="Dasar tanggal pesanan" className={ORDER_FILTER_CONTROL_CLASS}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="service">Jadwal Service</SelectItem>
                    <SelectItem value="lead">Tanggal Leads</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="orderFilterDate">
                <FoundationDateRangePicker
                  date={dateRange}
                  setDate={setDateRange}
                  className="orderFilterDateControl"
                  contentClassName="orderDateRangePopover"
                />
              </div>

              <div className="orderSearchSlot relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400 dark:text-slate-500" />
                <Input
                  aria-label="Cari pesanan"
                  placeholder="Cari Order ID, nama, no HP, alamat, atau nominal..."
                  className="orderSearchInput pl-9 bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 dark:text-slate-200 focus:ring-1 focus:ring-blue-500 transition-all w-full shadow-sm placeholder:text-slate-400 dark:placeholder:text-slate-500"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>

              {statusFilter === 'cancelled' && (
                <div className="orderCancelReason">
                  <Select value={cancelReasonFilter} onValueChange={setCancelReasonFilter}>
                    <SelectTrigger aria-label="Alasan cancel" className={ORDER_FILTER_CONTROL_CLASS}>
                      <SelectValue placeholder="Semua alasan cancel" />
                    </SelectTrigger>
                    <SelectContent className="z-[200]">
                      <SelectItem value="all">Semua alasan cancel</SelectItem>
                      {cancelReasonFilterOptions.map((option) => (
                        <SelectItem key={option.label} value={option.label}>
                          {option.label} ({option.count})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {/* Filter Button */}
              <Dialog open={isFilterDialogOpen} onOpenChange={setIsFilterDialogOpen}>
                <div className="orderFilterAction">
                  <Button
                    type="button"
                    variant="outline"
                    className={`orderMoreFilterButton ${activeFilterCount > 0 ? 'isActive' : ''}`}
                    onClick={() => setIsFilterDialogOpen(true)}
                  >
                    <Filter className="h-4 w-4" />
                    Filter
                    {activeFilterCount > 0 && (
                      <span className="orderMoreFilterCount">
                        {activeFilterCount}
                      </span>
                    )}
                  </Button>
                </div>
                <MasterDataFormDialogContent
                  preventOutsideClose={false}
                  size="wide"
                  className="orderFilterDialog"
                >
                  <MasterDataFormHeader
                    icon={Filter}
                    title="Filter Pesanan"
                    description="Sesuaikan filter untuk menemukan data pesanan yang spesifik."
                    className="orderFilterDialogHeader"
                  />
                    
                  <MasterDataDialogBody compact className="orderFilterDialogBody">
                        {/* 1. SDM (Teknisi, CS, Advertiser) */}
                        <div className="space-y-4">
                           <div className="flex items-center gap-2 pb-2 border-b border-slate-200 dark:border-slate-700">
                              <div className="p-1.5 rounded-md bg-purple-50 text-purple-600 dark:bg-purple-900/20 dark:text-purple-400">
                                <UserIcon className="w-4 h-4" />
                              </div>
                              <h4 className="text-sm font-bold text-slate-800 dark:text-slate-200 uppercase tracking-wide">SDM & Tim</h4>
                           </div>
                           <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                {/* CS Filter */}
                                {(isAdminManagementUser || isAdvertiserUser || isTechnicianUser) && (
                                <div className="space-y-2">
                                   <Label className="text-xs font-semibold text-slate-600 dark:text-slate-400 uppercase tracking-wide">Customer Service</Label>
                                   <Select value={csFilter} onValueChange={setCsFilter}>
                                      <SelectTrigger className="bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 h-10"><SelectValue placeholder="Semua CS" /></SelectTrigger>
                                      <SelectContent className="z-[200]">
                                         <SelectItem value="all">Semua CS</SelectItem>
                                         {availableCS.map((cs) => (
                                            <SelectItem key={cs.id} value={cs.id}>{cs.name}</SelectItem>
                                         ))}
                                      </SelectContent>
                                   </Select>
                                </div>
                                )}

                                {/* Technician Filter */}
                                {!isAdvertiserUser && (
                                <div className="space-y-2">
                                   <Label className="text-xs font-semibold text-slate-600 dark:text-slate-400 uppercase tracking-wide">Teknisi</Label>
                                   <Select value={isTechnicianUser && currentUser?.id ? currentUser.id : technicianFilter} onValueChange={setTechnicianFilter} disabled={isTechnicianUser}>
                                      <SelectTrigger className="bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 h-10"><SelectValue placeholder="Semua Teknisi" /></SelectTrigger>
                                      <SelectContent className="z-[200]">
                                         {!isTechnicianUser && <SelectItem value="all">Semua Teknisi</SelectItem>}
                                         {availableTechnicians.map((tech) => {
                                            if (isTechnicianUser && tech.id !== currentUser?.id) return null;
                                            return <SelectItem key={tech.id} value={tech.id}>{tech.name}</SelectItem>;
                                         })}
                                      </SelectContent>
                                   </Select>
                                </div>
                                )}

                                {/* Advertiser Filter */}
                                {isAdminManagementUser && (
                                <div className="space-y-2">
                                   <Label className="text-xs font-semibold text-slate-600 dark:text-slate-400 uppercase tracking-wide">Advertiser</Label>
                                   <Select value={advertiserFilter} onValueChange={setAdvertiserFilter}>
                                      <SelectTrigger className="bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 h-10"><SelectValue placeholder="Semua Adv" /></SelectTrigger>
                                      <SelectContent className="z-[200]">
                                         <SelectItem value="all">Semua Advertiser</SelectItem>
                                         {advertisers.map((adv) => (
                                            <SelectItem key={adv.id} value={adv.id}>{adv.name}</SelectItem>
                                         ))}
                                      </SelectContent>
                                   </Select>
                                </div>
                                )}
                           </div>
                        </div>

                        {/* 2. Layanan & Operasional (Branch, Service, Category, Vehicle) */}
                        <div className="space-y-4">
                           <div className="flex items-center gap-2 pb-2 border-b border-slate-200 dark:border-slate-700">
                              <div className="p-1.5 rounded-md bg-blue-50 text-blue-600 dark:bg-blue-900/20 dark:text-blue-400">
                                <Truck className="w-4 h-4" />
                              </div>
                              <h4 className="text-sm font-bold text-slate-800 dark:text-slate-200 uppercase tracking-wide">Layanan & Operasional</h4>
                           </div>
                           <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                <div className="space-y-2">
                                   <Label className="text-xs font-semibold text-slate-600 dark:text-slate-400 uppercase tracking-wide">Cabang</Label>
                                   <Select value={branchFilter} onValueChange={setBranchFilter}>
                                      <SelectTrigger className="bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 h-10"><SelectValue placeholder="Semua Cabang" /></SelectTrigger>
                                      <SelectContent className="z-[200]">
                                         <SelectItem value="all">Semua Cabang</SelectItem>
                                         {availableBranches.map((branch) => (
                                            <SelectItem key={branch.id} value={branch.id}>{branch.name}</SelectItem>
                                         ))}
                                      </SelectContent>
                                   </Select>
                                </div>
                                <div className="space-y-2">
                                   <Label className="text-xs font-semibold text-slate-600 dark:text-slate-400 uppercase tracking-wide">Jadwal</Label>
                                   <Select value={scheduleConflictFilter} onValueChange={setScheduleConflictFilter}>
                                      <SelectTrigger className="bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 h-10"><SelectValue placeholder="Semua Jadwal" /></SelectTrigger>
                                      <SelectContent className="z-[200]">
                                         <SelectItem value="all">Semua Jadwal</SelectItem>
                                         <SelectItem value="conflict">Hanya Bentrok</SelectItem>
                                      </SelectContent>
                                   </Select>
                                </div>
                                <div className="space-y-2">
                                   <Label className="text-xs font-semibold text-slate-600 dark:text-slate-400 uppercase tracking-wide">Layanan</Label>
                                   <Select value={serviceFilter} onValueChange={setServiceFilter}>
                                      <SelectTrigger className="bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 h-10"><SelectValue placeholder="Semua Layanan" /></SelectTrigger>
                                      <SelectContent className="z-[200]">
                                         <SelectItem value="all">Semua Layanan</SelectItem>
                                         {activeServices.map((svc) => (
                                            <SelectItem key={svc.id} value={svc.id}>{svc.name}</SelectItem>
                                         ))}
                                      </SelectContent>
                                   </Select>
                                </div>
                                <div className="space-y-2">
                                   <Label className="text-xs font-semibold text-slate-600 dark:text-slate-400 uppercase tracking-wide">Kategori</Label>
                                   <Select value={serviceCategoryFilter} onValueChange={setServiceCategoryFilter}>
                                      <SelectTrigger className="bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 h-10"><SelectValue placeholder="Semua Kategori" /></SelectTrigger>
                                      <SelectContent className="z-[200]">
                                         <SelectItem value="all">Semua Kategori</SelectItem>
                                         <SelectItem value="Visit">Visit</SelectItem>
                                         <SelectItem value="Home Service">Home Service</SelectItem>
                                      </SelectContent>
                                   </Select>
                                </div>
                                <div className="space-y-2">
                                   <Label className="text-xs font-semibold text-slate-600 dark:text-slate-400 uppercase tracking-wide">Kendaraan</Label>
                                   <Select value={vehicleFilter} onValueChange={setVehicleFilter}>
                                      <SelectTrigger className="bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 h-10"><SelectValue placeholder="Semua Tipe" /></SelectTrigger>
                                      <SelectContent className="z-[200]">
                                         <SelectItem value="all">Semua Tipe</SelectItem>
                                         {vehicles.map((v) => (
                                            <SelectItem key={v.id} value={v.id}>{v.name}</SelectItem>
                                         ))}
                                      </SelectContent>
                                   </Select>
                                </div>
                           </div>
                        </div>

                        {/* 3. Sumber Order (Platform, Advertiser Specific) */}
                        <div className="space-y-4">
                           <div className="flex items-center gap-2 pb-2 border-b border-slate-200 dark:border-slate-700">
                              <div className="p-1.5 rounded-md bg-orange-50 text-orange-600 dark:bg-orange-900/20 dark:text-orange-400">
                                <Megaphone className="w-4 h-4" />
                              </div>
                              <h4 className="text-sm font-bold text-slate-800 dark:text-slate-200 uppercase tracking-wide">Sumber Order</h4>
                           </div>
                           <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                <div className="space-y-2">
                                   <Label className="text-xs font-semibold text-slate-600 dark:text-slate-400 uppercase tracking-wide">Platform</Label>
                                   <Select value={platformFilter} onValueChange={setPlatformFilter}>
                                      <SelectTrigger className="bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 h-10"><SelectValue placeholder="Semua Platform" /></SelectTrigger>
                                      <SelectContent className="z-[200]">
                                         <SelectItem value="all">Semua Platform</SelectItem>
                                         {platforms.map((p) => (
                                            <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                                         ))}
                                      </SelectContent>
                                   </Select>
                                </div>
                                
                                {isAdvertiserUser && (
                                <div className="space-y-2">
                                   <Label className="text-xs font-semibold text-slate-600 dark:text-slate-400 uppercase tracking-wide">Sub Channel</Label>
                                   <Select value={subChannelFilter} onValueChange={setSubChannelFilter}>
                                      <SelectTrigger className="bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 h-10"><SelectValue placeholder="Semua Sub Channel" /></SelectTrigger>
                                      <SelectContent className="z-[200]">
                                         <SelectItem value="all">Semua Sub Channel</SelectItem>
                                         {availableSubChannels.map((s) => (
                                            <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                                         ))}
                                      </SelectContent>
                                   </Select>
                                </div>
                                )}

                                <div className="space-y-2">
                                   <Label className="text-xs font-semibold text-slate-600 dark:text-slate-400 uppercase tracking-wide">Area</Label>
                                   <Select value={areaFilter} onValueChange={setAreaFilter}>
                                      <SelectTrigger className="bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 h-10"><SelectValue placeholder="Semua Area" /></SelectTrigger>
                                      <SelectContent className="z-[200]">
                                         <SelectItem value="all">Semua Area</SelectItem>
                                         {areas.map((a) => (
                                            <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
                                         ))}
                                      </SelectContent>
                                   </Select>
                                </div>

                                <div className="space-y-2">
                                   <Label className="text-xs font-semibold text-slate-600 dark:text-slate-400 uppercase tracking-wide">Affiliate</Label>
                                   <Select value={affiliateFilter} onValueChange={setAffiliateFilter}>
                                      <SelectTrigger className="bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 h-10"><SelectValue placeholder="Semua Affiliate" /></SelectTrigger>
                                      <SelectContent className="z-[200]">
                                         <SelectItem value="all">Semua Affiliate</SelectItem>
                                         {Array.from(new Set(orders.map(o => o.affiliateName).filter(Boolean))).map(aff => (
                                            <SelectItem key={aff as string} value={aff as string}>{aff}</SelectItem>
                                         ))}
                                      </SelectContent>
                                   </Select>
                                </div>
                           </div>
                        </div>

                        {/* 4. Pembayaran */}
                        <div className="space-y-4">
                           <div className="flex items-center gap-2 pb-2 border-b border-slate-200 dark:border-slate-700">
                              <div className="p-1.5 rounded-md bg-emerald-50 text-emerald-600 dark:bg-emerald-900/20 dark:text-emerald-400">
                                <Banknote className="w-4 h-4" />
                              </div>
                              <h4 className="text-sm font-bold text-slate-800 dark:text-slate-200 uppercase tracking-wide">Pembayaran</h4>
                           </div>
                           <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                              <div className="space-y-2">
                                 <Label className="text-xs font-semibold text-slate-600 dark:text-slate-400 uppercase tracking-wide">Metode</Label>
                                 <Select value={paymentTypeFilter} onValueChange={setPaymentTypeFilter}>
                                    <SelectTrigger className="bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 h-10"><SelectValue placeholder="Semua Metode" /></SelectTrigger>
                                    <SelectContent className="z-[200]">
                                       <SelectItem value="all">Semua Metode</SelectItem>
                                       <SelectItem value="Transfer">Transfer</SelectItem>
                                       <SelectItem value="Cash">Cash</SelectItem>
                                    </SelectContent>
                                 </Select>
                              </div>
                              <div className="space-y-2">
                                 <Label className="text-xs font-semibold text-slate-600 dark:text-slate-400 uppercase tracking-wide">Akun Pembayaran</Label>
                                 <Select value={paymentMethodFilter} onValueChange={setPaymentMethodFilter}>
                                    <SelectTrigger className="bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 h-10"><SelectValue placeholder="Semua Akun" /></SelectTrigger>
                                    <SelectContent className="z-[200]">
                                       <SelectItem value="all">Semua Akun</SelectItem>
                                       {payments.map(p => (
                                           <SelectItem key={p.id} value={p.id}>
                                             {p.accountType === 'qris'
                                               ? `${p.bankName} - ${p.accountHolder || 'QRIS'}`
                                               : `${p.bankName} - ${p.accountNumber}`}
                                           </SelectItem>
                                       ))}
                                    </SelectContent>
                                 </Select>
                              </div>
                              <div className="space-y-2">
                                 <Label className="text-xs font-semibold text-slate-600 dark:text-slate-400 uppercase tracking-wide">Status</Label>
                                 <Select value={paymentStatusFilter} onValueChange={setPaymentStatusFilter}>
                                    <SelectTrigger className="bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 h-10"><SelectValue placeholder="Semua Status" /></SelectTrigger>
                                    <SelectContent className="z-[200]">
                                       <SelectItem value="all">Semua Status</SelectItem>
                                       <SelectItem value="Paid">Lunas (Paid)</SelectItem>
                                       <SelectItem value="Unpaid">Belum Bayar (Unpaid)</SelectItem>
                                       <SelectItem value="Down Payment">DP (Down Payment)</SelectItem>
                                    </SelectContent>
                                 </Select>
                              </div>
                              <div className="space-y-2">
                                 <Label className="text-xs font-semibold text-slate-600 dark:text-slate-400 uppercase tracking-wide">Validasi</Label>
                                 <Select value={paymentValidationFilter} onValueChange={setPaymentValidationFilter}>
                                    <SelectTrigger className="bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 h-10"><SelectValue placeholder="Semua" /></SelectTrigger>
                                    <SelectContent className="z-[200]">
                                       <SelectItem value="all">Semua</SelectItem>
                                       <SelectItem value="Valid">Valid</SelectItem>
                                       <SelectItem value="Invalid">Invalid</SelectItem>
                                       <SelectItem value="Pending">Pending</SelectItem>
                                    </SelectContent>
                                 </Select>
                              </div>
                           </div>
                        </div>
                  </MasterDataDialogBody>

                  <DialogFooter className="orderFilterDialogFooter masterDataFormActions">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={resetSheetFilters}
                    >
                      Reset Filter
                    </Button>
                    <Button
                      type="button"
                      className="bg-blue-600 text-white shadow-sm hover:bg-blue-700"
                      onClick={() => setIsFilterDialogOpen(false)}
                    >
                      Terapkan Filter
                    </Button>
                  </DialogFooter>
                </MasterDataFormDialogContent>
              </Dialog>
            </div>
          </OperationalFilterPanel>
          {isDateRangeLoading && (
            <div role="status" className="flex items-center gap-2 px-5 py-3 text-sm text-slate-600 dark:text-slate-300">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              Memuat pesanan untuk periode yang dipilih… Jumlah data akan diperbarui setelah selesai.
            </div>
          )}
          {ordersLoadError && (
            <div role="alert" className="flex flex-wrap items-center gap-3 px-5 py-3 text-sm text-red-700 dark:text-red-300">
              <span>{ordersLoadError}</span>
              <Button variant="outline" size="sm" onClick={retryOrderLoad}>Coba lagi</Button>
            </div>
          )}

          {/* Data Content: Table, Map, or Calendar */}
          {viewMode === 'calendar' && (
             <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm p-3 md:p-6 overflow-hidden animate-in fade-in zoom-in-95 duration-200">
                <div className="flex items-center justify-between mb-3 md:mb-6">
                   <h3 className="text-sm md:text-lg font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                      <Calendar className="w-4 h-4 md:w-5 md:h-5 text-blue-600" />
                      Kalender Order
                   </h3>
                   <div className="text-[10px] md:text-sm text-slate-500 dark:text-slate-400 bg-slate-50 dark:bg-slate-700/30 px-2 py-1 rounded-md">
                      Total: <span className="font-bold text-slate-900 dark:text-slate-100">{filteredOrdersBase.length}</span> <span className="hidden sm:inline">Order dalam periode ini</span><span className="sm:hidden">Order</span>
                   </div>
                </div>

                <div className="grid grid-cols-7 gap-1 md:gap-4">
                   {(() => {
                      // Determine Date Range
                      let start = dateRange?.from ? startOfDay(dateRange.from) : startOfDay(new Date());
                      let end = dateRange?.to ? endOfDay(dateRange.to) : endOfDay(start);
                      
                      // Default to current month if no range selected (or range too small/invalid)
                      if (!dateRange?.from) {
                          const now = new Date();
                          start = new Date(now.getFullYear(), now.getMonth(), 1);
                          end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
                      }

                      // Generate Days
                      const days = [];
                      // Adjust start to beginning of week (Monday) for better calendar look if needed, 
                      // but keeping logic simple strictly to date range for now as requested.
                      for(let dt=new Date(start); dt<=end; dt.setDate(dt.getDate()+1)){
                          days.push(new Date(dt));
                      }

                      // Group Orders
                      const ordersByDate: Record<string, number> = {};
                      filteredOrdersBase.forEach(o => {
                          const dateToUse = dateFilterMode === 'lead' ? o.leadDate : o.serviceDate;
                          if (dateToUse) {
                              try {
                                const dateKey = new Date(dateToUse).toISOString().split('T')[0];
                                ordersByDate[dateKey] = (ordersByDate[dateKey] || 0) + 1;
                              } catch(e) {}
                          }
                      });

                      const conflictOrdersByDate: Record<string, number> = {};
                      if (dateFilterMode !== 'lead') {
                          filteredOrdersBase.forEach((order) => {
                              const conflictInfo = scheduleConflictByItemKey.get(getScheduleConflictItemKey('order', order.id));
                              if (!conflictInfo || !order.serviceDate) return;

                              try {
                                const dateKey = new Date(order.serviceDate).toISOString().split('T')[0];
                                conflictOrdersByDate[dateKey] = (conflictOrdersByDate[dateKey] || 0) + 1;
                              } catch(e) {}
                          });
                      }

                      return days.map((day) => {
                          const year = day.getFullYear();
                          const month = String(day.getMonth() + 1).padStart(2, '0');
                          const d = String(day.getDate()).padStart(2, '0');
                          const key = `${year}-${month}-${d}`;
                          
                          const count = ordersByDate[key] || 0;
                          const conflictCount = conflictOrdersByDate[key] || 0;
                          const isToday = key === new Date().toISOString().split('T')[0];
                          const hasOrders = count > 0;

                          return (
                              <div 
                                key={key} 
                                className={`
                                    relative flex flex-col items-center justify-center p-1 md:p-4 rounded-md md:rounded-xl border transition-all duration-200
                                    ${isToday 
                                        ? 'bg-blue-50/50 dark:bg-blue-900/10 border-blue-200 dark:border-blue-800' 
                                        : 'bg-white dark:bg-slate-800 border-slate-100 dark:border-slate-700 hover:border-blue-200 dark:hover:border-blue-700'
                                    }
                                    ${hasOrders ? 'hover:shadow-md' : 'opacity-60'}
                                    min-h-[60px] md:min-h-[100px]
                                `}
                              >
                                  <span className="text-[10px] md:text-xs font-medium text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-0.5 md:mb-1">
                                      {day.toLocaleDateString('id-ID', { weekday: 'short' })}
                                  </span>
                                  <span className={`text-xs md:text-2xl font-bold ${isToday ? 'text-blue-600 dark:text-blue-400' : 'text-slate-700 dark:text-slate-200'}`}>
                                      {day.getDate()}
                                  </span>
                                  <span className="hidden md:block text-[10px] text-slate-400 dark:text-slate-500 mt-1">
                                      {day.toLocaleDateString('id-ID', { month: 'short', year: 'numeric' })}
                                  </span>
                                  
                                  {count > 0 && (
                                      <div className="absolute top-1 right-1 md:top-2 md:right-2">
                                          <span className={`flex h-4 w-4 md:h-6 md:w-6 items-center justify-center rounded-full ${dateFilterMode === 'lead' ? 'bg-purple-500' : 'bg-red-500'} text-[9px] md:text-xs font-bold text-white shadow-sm animate-in zoom-in duration-300`}>
                                              {count}
                                          </span>
                                      </div>
                                  )}
                                  {conflictCount > 0 && (
                                      <span className="absolute bottom-1 left-1 right-1 truncate text-center text-[9px] font-semibold text-red-600 dark:text-red-400 md:bottom-2 md:text-[10px]">
                                          Bentrok {conflictCount}
                                      </span>
                                  )}
                              </div>
                          );
                      });
                   })()}
                </div>
             </div>
          )}

          {/* Data Content: Table or Map */}
          {viewMode === 'table' ? (
          <>
          <div className="orderTableSurface hidden border border-slate-100 bg-white md:block dark:border-slate-800 dark:bg-slate-900">
            <div className="orderTableHeader">
              <MasterDataTableTitle title="Data Pesanan" count={filteredOrders.length} icon={ClipboardList} />
              <label className="orderSelectionSwitch">
                <Switch checked={showOrderSelection} onCheckedChange={handleOrderSelectionModeChange} />
                <span>{showOrderSelection ? 'Mode pilih aktif' : 'Pilih baris'}</span>
              </label>
            </div>
            {showOrderSelection && selectedIds.size > 0 && (
              <div className="orderSelectionToolbar">
                <div className="orderSelectionToolbarSummary">
                  <strong>{selectedIds.size} pesanan terpilih</strong>
                  <span>{paginatedOrders.length} data aktif di halaman ini</span>
                </div>
                <div className="orderSelectionToolbarActions">
                  <Button size="sm" variant="ghost" onClick={() => setSelectedIds(new Set())}>
                    Batal
                  </Button>

                  {canViewCustomerContact && (
                    <Button size="sm" variant="outline" onClick={() => void handleSaveSelectedOrdersToContacts()}>
                      <UserIcon className="w-3.5 h-3.5" />
                      Simpan Kontak ({selectedIds.size})
                    </Button>
                  )}

                  {(hasPermission('order.edit') || hasPermission('order.payment.edit_status') || hasPermission('order.status.edit') || hasPermission('order.assign_technician')) && (
                    <Button size="sm" variant="outline" onClick={() => setIsBulkEditOpen(true)}>
                      <Edit className="w-3.5 h-3.5" />
                      Edit ({selectedIds.size})
                    </Button>
                  )}

                  {hasPermission('order.delete') && (
                    <Button size="sm" variant="destructive" onClick={handleMassDelete}>
                      <Trash2 className="w-3.5 h-3.5" />
                      Hapus ({selectedIds.size})
                    </Button>
                  )}
                </div>
              </div>
            )}
            <DataTable
              actionWidth={canShowOrderActions ? 128 : undefined}
              cellY={14}
              className="orderDataTable"
              columns={createDataTableColumns([
                showOrderSelection && 'checkbox',
                'number',
                { preset: 'text', minWidth: 136, width: 'clamp(136px, 10vw, 164px)' },
                'date',
                'wide',
                { preset: 'description', minWidth: 260, width: 'clamp(260px, 18vw, 340px)' },
                { preset: 'text', minWidth: 210, width: 'clamp(210px, 15vw, 280px)' },
                { preset: 'compact', minWidth: 148, width: 'clamp(148px, 10vw, 180px)' },
                'status',
                'status',
                canShowOrderActions && { preset: 'action', minWidth: 128, width: '128px' },
              ])}
              minWidth={showOrderSelection ? 1656 : 1608}
              dragScroll={false}
              onClickCapture={handleOrderTableClickCapture}
              onPointerDown={handleOrderTablePointerDown}
              onPointerMove={handleOrderTablePointerMove}
              onPointerUp={handleOrderTablePointerEnd}
              onPointerCancel={handleOrderTablePointerEnd}
              onPointerLeave={handleOrderTablePointerEnd}
              rowMinHeight={82}
              textMax={340}
            >
            <table>
              <TableHeader className="bg-slate-50 dark:bg-slate-900">
                <TableRow className="border-b border-slate-200 hover:bg-transparent dark:border-slate-800">
                  {showOrderSelection && (
                  <TableHead className="w-[50px] py-4 pl-4">
                    <Checkbox 
                        className="border-slate-400 data-[state=checked]:bg-blue-600 data-[state=checked]:border-blue-600"
                        checked={paginatedOrders.length > 0 && Array.from(selectedIds).filter(id => paginatedOrders.find(o => o.id === id)).length === paginatedOrders.length}
                        onCheckedChange={(checked) => handleSelectAll(checked as boolean)}
                    />
                  </TableHead>
                  )}
                  <TableHead className="w-[50px] font-semibold text-slate-600 dark:text-slate-400 text-[11px] uppercase tracking-wider py-4 text-center">No</TableHead>
                  <TableHead className="font-semibold text-slate-600 dark:text-slate-400 text-[11px] uppercase tracking-wider py-4 pl-4">ID Order</TableHead>
                  <TableHead className="font-semibold text-slate-600 dark:text-slate-400 text-[11px] uppercase tracking-wider py-4">Jadwal</TableHead>
                  <TableHead className="font-semibold text-slate-600 dark:text-slate-400 text-[11px] uppercase tracking-wider py-4">Pelanggan</TableHead>
                  <TableHead className="font-semibold text-slate-900 dark:text-slate-100 text-[11px] uppercase tracking-wider py-4">
                    <span className="inline-flex items-center gap-1.5">
                      <span>Layanan & Harga</span>
                      <button
                        type="button"
                        data-drag-scroll-ignore="true"
                        className="inline-flex h-6 w-6 cursor-pointer items-center justify-center rounded-md text-slate-400 transition-colors hover:bg-orange-50 hover:text-orange-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 dark:hover:bg-orange-950/30 dark:hover:text-orange-400 dark:focus-visible:ring-offset-slate-950"
                        onPointerDown={(event) => {
                          event.stopPropagation();
                          clearOrderTableInteractionGuards();
                        }}
                        onMouseDown={(event) => {
                          event.stopPropagation();
                          clearOrderTableInteractionGuards();
                        }}
                        onClick={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          clearOrderTableInteractionGuards();
                          requestSort('price');
                        }}
                        title={
                          sortConfig?.key === 'price'
                            ? `Harga ${sortConfig.direction === 'asc' ? 'terendah ke tertinggi' : 'tertinggi ke terendah'}`
                            : 'Klik ikon untuk urutkan harga'
                        }
                        aria-label={
                          sortConfig?.key === 'price'
                            ? `Urutan harga ${sortConfig.direction === 'asc' ? 'terendah ke tertinggi' : 'tertinggi ke terendah'}`
                            : 'Urutkan harga'
                        }
                      >
                        {sortConfig?.key === 'price' ? (
                          sortConfig.direction === 'asc'
                            ? <ArrowUp className="w-3.5 h-3.5 text-orange-500" />
                            : <ArrowDown className="w-3.5 h-3.5 text-orange-500" />
                        ) : (
                          <ArrowUpDown className="w-3.5 h-3.5" />
                        )}
                      </button>
                    </span>
                  </TableHead>
                  <TableHead className="font-semibold text-slate-600 dark:text-slate-400 text-[11px] uppercase tracking-wider py-4">Operasional</TableHead>
                  <TableHead className="font-semibold text-slate-600 dark:text-slate-400 text-[11px] uppercase tracking-wider py-4 text-center">Metode Bayar</TableHead>
                  <TableHead className="font-semibold text-slate-600 dark:text-slate-400 text-[11px] uppercase tracking-wider py-4 text-center">Status Bayar</TableHead>
                  <TableHead className="font-semibold text-slate-600 dark:text-slate-400 text-[11px] uppercase tracking-wider py-4 text-center">Status</TableHead>
                  {canShowOrderActions && (
                  <TableHead className="text-right font-semibold text-slate-600 dark:text-slate-400 text-[11px] uppercase tracking-wider py-4 pr-6">Aksi</TableHead>
                  )}
                </TableRow>
              </TableHeader>
              <TableBody>
                {ordersTableLoading ? (
                  <OrderTableSkeleton columns={orderTableColumnCount} />
                ) : paginatedOrders.length === 0 ? (
                   <TableRow>
                     <TableCell colSpan={orderTableColumnCount}>
                        <OperationalEmptyState
                          icon={ClipboardList}
                          title="Tidak ada pesanan ditemukan"
                          description={
                            orders.length === 0
                              ? 'Data database belum masuk ke state lokal. Sistem sudah mencoba muat ulang sekali.'
                              : 'Coba ubah filter, tanggal, atau kata kunci pencarian.'
                          }
                          className="py-14"
                        />
                     </TableCell>
                   </TableRow>
                ) : (
                  paginatedOrders.map((order, index) => {
                    const scheduleConflictInfo = scheduleConflictByItemKey.get(
                      getScheduleConflictItemKey('order', order.id)
                    );

                    return (
                    <TableRow
                      key={order.id}
                      data-order-id={order.id}
                      tabIndex={canViewOrderDetails ? 0 : undefined}
                      aria-label={canViewOrderDetails ? `Buka detail pesanan ${order.id}` : undefined}
                      onClick={(event) => handleOrderRowClick(event, order)}
                      onKeyDown={(event) => handleOrderRowKeyDown(event, order)}
                      className={`border-b border-slate-100 transition-colors last:border-0 hover:bg-slate-50/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-200 dark:border-slate-800 dark:hover:bg-slate-800/70 ${canViewOrderDetails ? 'cursor-pointer' : ''} ${selectedIds.has(order.id) ? 'bg-blue-50/50 dark:bg-blue-900/10' : ''}`}
                    >
                      {showOrderSelection && (
                      <TableCell className="py-6 pl-4 align-top w-[40px]">
                        <Checkbox 
                            className="border-slate-400 data-[state=checked]:bg-blue-600 data-[state=checked]:border-blue-600"
                            checked={selectedIds.has(order.id)}
                            onCheckedChange={(checked) => handleSelectRow(order.id, checked as boolean)}
                        />
                      </TableCell>
                      )}
                      <TableCell className="py-6 align-top text-center text-sm text-slate-500 dark:text-slate-400 font-medium w-[50px]">
                        {(currentPage - 1) * itemsPerPage + index + 1}
                      </TableCell>
                      <TableCell className="py-6 pl-4 align-top">
                        <div className="flex flex-col gap-1">
                          <div 
                              onClick={(e) => {
                                e.stopPropagation();
                                e.preventDefault();
                                copyToClipboard(order.id, {
                                  successMessage: "ID Order disalin!",
                                  description: `${order.id} siap ditempel.`
                                });
                              }}
                              role="button"
                              tabIndex={0}
                              className="font-semibold text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300 text-sm cursor-pointer hover:underline"
                              title="Klik untuk menyalin ID"
                          >
                            {order.id}
                          </div>
                          {order.leadDate && (
                            <span className="text-[10px] text-slate-400 dark:text-slate-500 font-medium uppercase tracking-wide">
                              {new Date(order.leadDate).toLocaleDateString('id-ID', { day: 'numeric', month: 'short' })}
                            </span>
                          )}
                          {order.created_at && (
                            <span className="text-[10px] text-slate-400 dark:text-slate-500 leading-none mt-0.5">
                              {new Date(order.created_at).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }).replace('.', ':')} WIB
                            </span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="py-6 align-top">
                        <div className="flex flex-col gap-1">
                          <span className="font-semibold text-slate-900 dark:text-slate-200 text-sm">
                             {new Date(order.serviceDate).toLocaleDateString('id-ID', { day: 'numeric', month: 'short' })}
                          </span>
                          <div className="flex flex-col gap-1">
                              <span className="text-xs text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
                                 <Clock className="w-3.5 h-3.5" /> {order.serviceTime}
                              </span>
                              {scheduleConflictInfo && (
                                <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-red-600 dark:text-red-400">
                                  <AlertTriangle className="h-3 w-3" />
                                  Bentrok jadwal
                                </span>
                              )}
                              <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium w-fit ${
                                 (order.serviceCategory === 'Home Service' || (!order.serviceCategory && areaMap[order.areaId]))
                                    ? 'bg-blue-50 text-blue-600 dark:bg-blue-900/20 dark:text-blue-400 border border-blue-100 dark:border-blue-800' 
                                    : 'bg-orange-50 text-orange-600 dark:bg-orange-900/20 dark:text-orange-400 border border-orange-100 dark:border-orange-800'
                              }`}>
                                 {order.serviceCategory || (areaMap[order.areaId] ? 'Home Service' : 'Visit')}
                              </span>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="py-6 align-top">
                        <div className="flex flex-col gap-1">
                          <span className="font-semibold text-slate-900 dark:text-slate-200 text-sm">{order.customerName}</span>
                          
                          {/* Advertiser Only: Platform & Sub Channel */}
                          {isAdvertiserUser && (
                             <div className="flex flex-wrap items-center gap-1 mt-0.5">
                                <span className="text-[10px] text-slate-500 dark:text-slate-400">
                                   {platformMap[order.platformId]?.name || '-'}
                                   {order.subChannelId && subChannelMap[order.subChannelId]?.name && (
                                      <> | {subChannelMap[order.subChannelId]?.name}</>
                                   )}
                                </span>
                             </div>
                          )}
                          
                          {(canViewCustomerContact || canViewRoute) && (
                            <>
                            {canViewCustomerContact && (
                            <div className="flex items-center gap-2">
                               <a 
                                 href={`https://wa.me/${order.customerPhone.replace(/\D/g, '').replace(/^0/, '62')}`} 
                                 target="_blank" 
                                 rel="noopener noreferrer"
                                 className="text-green-500 hover:text-green-600 transition-colors"
                                 title="Chat WhatsApp"
                               >
                                  <MessageCircle className="w-3.5 h-3.5" />
                               </a>
                               <span className="text-xs text-slate-500 dark:text-slate-400">{order.customerPhone}</span>
                            </div>
                            )}

                            <div className="flex items-start gap-2">
                               {canViewRoute && order.mapsUrl && (
                                  <a 
                                    href={order.mapsUrl} 
                                    target="_blank" 
                                    rel="noopener noreferrer"
                                    className="text-blue-500 hover:text-blue-600 dark:text-blue-400 dark:hover:text-blue-300 transition-colors mt-0.5"
                                    title="Buka Maps"
                                  >
                                     <MapPin className="w-3.5 h-3.5" />
                                  </a>
                               )}
                               <span className="text-xs text-slate-500 dark:text-slate-400 line-clamp-2 leading-tight" title={order.address}>
                                  {order.address}
                               </span>
                            </div>
                            </>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="py-6 align-top">
                        <div className="flex flex-col gap-1 max-w-[240px]">
                          <span 
                            className="text-[11px] font-medium text-slate-900 dark:text-slate-200 whitespace-nowrap overflow-hidden text-ellipsis" 
                            title={getServiceName(order.serviceId)}
                          >
                            {getServiceName(order.serviceId)}
                          </span>
                          <div className="flex items-center gap-1">
                             <span className="text-xs text-slate-500 dark:text-slate-400">
                                {getVehicleName(order.vehicleId)} ({order.units || 1})
                             </span>
                          </div>
                          
                          {canEditOrderPrice && editingPriceId === order.id ? (
                              <div
                                className="orderPriceEditor mt-1"
                                data-drag-scroll-ignore="true"
                                onClick={(event) => event.stopPropagation()}
                                onMouseDown={(event) => event.stopPropagation()}
                                onPointerDown={(event) => event.stopPropagation()}
                              >
                                  <div className="relative shrink-0">
                                      <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-xs text-slate-500">Rp</span>
                                      <Input 
                                         className="orderPriceInput h-8 w-28 text-sm font-semibold pl-7 pr-2" 
                                         value={tempPrice}
                                         disabled={savingOrderActionKey === `${order.id}:price`}
                                         onChange={(e) => {
                                             const val = e.target.value.replace(/\D/g, '');
                                             setTempPrice(val ? Number(val).toLocaleString('id-ID') : '');
                                         }}
                                         autoFocus
                                         onKeyDown={(e) => {
                                             if (e.key === 'Enter') {
                                                 void handleSaveInlinePrice(order);
                                             } else if (e.key === 'Escape') {
                                                 setEditingPriceId(null);
                                             }
                                         }}
                                      />
                                  </div>
                                  <button
                                    type="button"
                                    className="orderPriceIconAction isSave"
                                    title="Simpan harga"
                                    aria-label="Simpan harga"
                                    disabled={savingOrderActionKey === `${order.id}:price`}
                                    onMouseDown={(event) => {
                                      event.preventDefault();
                                      event.stopPropagation();
                                    }}
                                    onClick={(event) => {
                                      event.preventDefault();
                                      event.stopPropagation();
                                      void handleSaveInlinePrice(order);
                                    }}
                                  >
                                     {savingOrderActionKey === `${order.id}:price`
                                       ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                       : <CheckCircle2 className="w-3.5 h-3.5" />}
                                  </button>
                                  <button
                                    type="button"
                                    className="orderPriceIconAction isCancel"
                                    title="Batal"
                                    aria-label="Batal ubah harga"
                                    disabled={savingOrderActionKey === `${order.id}:price`}
                                    onMouseDown={(event) => {
                                      event.preventDefault();
                                      event.stopPropagation();
                                    }}
                                    onClick={(event) => {
                                      event.preventDefault();
                                      event.stopPropagation();
                                      setEditingPriceId(null);
                                    }}
                                  >
                                     <XCircle className="w-3.5 h-3.5" />
                                  </button>
                              </div>
                          ) : (
                              canEditOrderPrice ? (
                                  <div
                                    data-drag-scroll-ignore="true"
                                    className="orderPriceEditTrigger mt-1"
                                    title="Ubah harga"
                                    role="button"
                                    tabIndex={0}
                                    onClick={(event) => {
                                      event.preventDefault();
                                      event.stopPropagation();
                                      openInlinePriceEditor(order);
                                    }}
                                    onKeyDown={(event) => {
                                      if (event.key !== 'Enter' && event.key !== ' ') return;
                                      event.preventDefault();
                                      event.stopPropagation();
                                      openInlinePriceEditor(order);
                                    }}
                                  >
                                    <span className={`${isAdvertiserUser ? 'text-[10px] font-medium text-slate-500' : 'text-sm font-semibold text-slate-900 dark:text-slate-200'}`}>
                                       Rp {order.price.toLocaleString('id-ID')}
                                    </span>
                                    <span className="orderPriceEditIcon">
                                      <Edit className="w-3.5 h-3.5" />
                                    </span>
                                  </div>
                              ) : (
                                  <div className="mt-1">
                                    <span className={`${isAdvertiserUser ? 'text-[10px] font-medium text-slate-500' : 'text-sm font-semibold text-slate-900 dark:text-slate-200'}`}>
                                       Rp {order.price.toLocaleString('id-ID')}
                                    </span>
                                  </div>
                              )
                          )}
                        </div>
                      </TableCell>

                      <TableCell className="py-6 align-top">
                        <div className="flex flex-col gap-2">
                           {(() => {
                             const technician = order.technicianId
                               ? userMap[order.technicianId] || userLookupFallbackMap[order.technicianId]
                               : null;
                             const cs = order.csId
                               ? userMap[order.csId] || userLookupFallbackMap[order.csId]
                               : null;
                             const branch = order.branchId
                               ? branchMap[order.branchId] || branchLookupFallbackMap[order.branchId]
                               : null;
                             const area = areaMap[order.areaId];
                             
                             return (
                               <>
                                 {/* 1. Teknisi */}
                                 {(!isAdvertiserUser || canAssignTechnician || canViewStaffContact) && (
                                 <div className="flex items-center gap-2 group/tech relative">
                                    {technician ? (
                                      <>
                                         {canViewStaffContact && technician.phone && (
                                            <a 
                                              href={`https://wa.me/${technician.phone.replace(/\D/g, '').replace(/^0/, '62')}`} 
                                              target="_blank" 
                                              rel="noopener noreferrer" 
                                              className="text-green-500 hover:text-green-600 shrink-0"
                                              title="Chat Teknisi"
                                            >
                                               <MessageCircle className="w-4 h-4" />
                                            </a>
                                         )}
                                         <div className="flex items-center gap-1.5 max-w-[180px]">
                                            <span className="text-[10px] text-slate-500 font-medium shrink-0">Teknisi</span>
                                            <span className="text-slate-300 dark:text-slate-600 shrink-0">|</span>
                                            <span 
                                               className="text-[11px] font-semibold text-slate-900 dark:text-slate-200 whitespace-nowrap overflow-hidden text-ellipsis min-w-0"
                                               title={technician.name}
                                            >
                                               {technician.name}
                                            </span>
                                         </div>
                                      </>
                                    ) : (
                                       <span className="text-sm text-slate-400 italic">-</span>
                                    )}

                                    {/* Technician Edit Dropdown */}
                                    {canAssignTechnician && !isOrderLocked(order.status) && (
                                       <DropdownMenu>
                                          <DropdownMenuTrigger asChild>
                                             <Button variant="ghost" size="icon" className="h-6 w-6 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-600 transition-opacity">
                                                <ChevronDown className="w-3.5 h-3.5" />
                                             </Button>
                                          </DropdownMenuTrigger>
                                          <DropdownMenuContent align="start" className="w-[200px] max-h-[300px] overflow-y-auto bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 z-[100]">
                                             <DropdownMenuLabel>Pilih Teknisi</DropdownMenuLabel>
                                             <DropdownMenuSeparator />
                                             <DropdownMenuItem 
                                                disabled={savingOrderActionKey === `${order.id}:technician`}
                                                onClick={async () => {
                                                   try {
                                                     await saveOrderPatch(
                                                       order,
                                                       { technicianId: undefined },
                                                       'Teknisi dilepas',
                                                       'technician',
                                                     );
                                                   } catch {
                                                     // Error toast is handled by saveOrderPatch.
                                                   }
                                                }}
                                                className="cursor-pointer text-red-600 focus:text-red-600 focus:bg-red-50 dark:focus:bg-red-900/20"
                                             >
                                                <span className="italic">Lepas Teknisi</span>
                                             </DropdownMenuItem>
                                             {technicians.map((tech) => {
                                                const technicianOffSchedule = getTechnicianOffSchedule(tech.id, order.serviceDate);
                                                const isTechnicianOff = !!technicianOffSchedule;
                                                return (
                                                <DropdownMenuItem 
                                                   key={tech.id}
                                                   disabled={isTechnicianOff || savingOrderActionKey === `${order.id}:technician`}
                                                   onClick={async () => {
                                                      if (isTechnicianOff) {
                                                        return;
                                                      }
                                                      try {
                                                        // Auto-update Branch if Technician has one
                                                        const updates: Partial<Order> = { technicianId: tech.id };
                                                        if (tech.branchId) {
                                                            updates.branchId = tech.branchId;
                                                        }
                                                        await saveOrderPatch(
                                                          order,
                                                          updates,
                                                          tech.branchId
                                                            ? `Teknisi diganti ke ${tech.name} (Cabang disesuaikan)`
                                                            : `Teknisi diganti ke ${tech.name}`,
                                                          'technician',
                                                        );
                                                        
                                                      } catch (error: unknown) {
                                                        console.error(error);
                                                      }
                                                   }}
                                                   className={`cursor-pointer ${order.technicianId === tech.id ? 'bg-blue-50 text-blue-600 dark:bg-blue-900/20 dark:text-blue-400' : ''} ${isTechnicianOff ? 'opacity-50 cursor-not-allowed' : ''}`}
                                                >
                                                   <div className="flex flex-col w-full">
                                                      <span className="font-medium text-sm">
                                                        {tech.name} {isTechnicianOff ? `(Sedang ${technicianOffSchedule?.type || 'Libur'})` : ''}
                                                      </span>
                                                      {tech.branchId && branchMap[tech.branchId]?.name && (
                                                        <span className="text-[10px] text-slate-500">{branchMap[tech.branchId]?.name}</span>
                                                      )}
                                                   </div>
                                                   {order.technicianId === tech.id && <CheckCircle2 className="w-3.5 h-3.5 ml-auto text-blue-600" />}
                                                </DropdownMenuItem>
                                             )})}
                                          </DropdownMenuContent>
                                       </DropdownMenu>
                                    )}
                                 </div>
                                 )}

                                 {/* 2. Cabang Only (Area hidden) */}
                                 {!isAdvertiserUser && branch && (
                                    <div className="flex items-center gap-1.5 text-slate-500 dark:text-slate-400 ml-0.5 max-w-[180px]">
                                       <Building2 className="w-3.5 h-3.5 shrink-0" />
                                       <span className="text-[11px] whitespace-nowrap overflow-hidden text-ellipsis min-w-0" title={branch?.name}>
                                          {branch?.name}
                                       </span>
                                    </div>
                                 )}

                                 {/* 3. CS */}
                                 {cs && (
                                    <div className="flex items-center gap-2">
                                       {canViewStaffContact && cs.phone && (
                                          <a 
                                            href={`https://wa.me/${cs.phone.replace(/\D/g, '').replace(/^0/, '62')}`} 
                                            target="_blank" 
                                            rel="noopener noreferrer" 
                                            className="text-green-500 hover:text-green-600 shrink-0"
                                            title="Chat CS"
                                          >
                                             <MessageCircle className="w-3.5 h-3.5" />
                                          </a>
                                       )}
                                       <div className="flex items-center gap-1.5 max-w-[180px]">
                                          <span 
                                             className="text-[11px] text-slate-600 dark:text-slate-300 whitespace-nowrap overflow-hidden text-ellipsis min-w-0"
                                             title={cs.name}
                                          >
                                             {cs.name}
                                          </span>
                                          <span className="text-[10px] text-slate-400 shrink-0">- CS</span>
                                       </div>
                                    </div>
                                 )}
                               </>
                             );
                           })()}
                        </div>
                      </TableCell>

                      <TableCell className="py-6 text-center align-top">
                        <div className="flex items-center justify-center gap-1">
                           {(() => {
                             const payment = order.paymentType === 'Transfer' && order.paymentMethodId
                               ? payments.find(p => p.id === order.paymentMethodId)
                               : null;
                             const isQrisPayment = payment?.accountType === 'qris';
                             const paymentLabel = `${order.paymentType || '-'}${payment ? ` - ${isQrisPayment ? 'QRIS' : payment.bankName}` : ''}`;

                             if (isQrisPayment && canViewOrderPayments) {
                               return (
                                 <button
                                   type="button"
                                   onClick={(event) => {
                                     event.stopPropagation();
                                     handleViewPayment(order);
                                   }}
                                   className="inline-flex items-center gap-1.5 rounded border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-emerald-700 transition hover:border-emerald-300 hover:bg-emerald-100 dark:border-emerald-900/70 dark:bg-emerald-950/30 dark:text-emerald-300"
                                   title="Lihat gambar QRIS"
                                 >
                                   <QrCode className="h-3.5 w-3.5" />
                                   {paymentLabel}
                                 </button>
                               );
                             }

                             return (
                               <div className="inline-flex items-center px-2.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider border bg-slate-50 text-slate-700 border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700">
                                 {paymentLabel}
                               </div>
                             );
                           })()}
                           {hasPermission('order.payment.edit_type') && !isOrderLocked(order.status) && (
                           <DropdownMenu>
                             <DropdownMenuTrigger asChild>
                               <Button variant="ghost" size="icon" className="h-6 w-6 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-600">
                                 <ChevronDown className="w-3.5 h-3.5" />
                               </Button>
                             </DropdownMenuTrigger>
                             <DropdownMenuContent align="center" className="bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 min-w-[160px] p-1">
                                {['Transfer', 'Cash'].map((type) => (
                                  <DropdownMenuItem 
                                    key={type}
                                    disabled={savingOrderActionKey === `${order.id}:paymentType`}
                                    onClick={async () => {
                                       const updates: Partial<Order> = { paymentType: type as Order['paymentType'] };
                                       if (type === 'Cash') updates.paymentMethodId = undefined;
                                       try {
                                         await saveOrderPatch(
                                           order,
                                           updates,
                                           `Jenis pembayaran diperbarui: ${type}`,
                                           'paymentType',
                                         );
                                       } catch {
                                         // Error toast is handled by saveOrderPatch.
                                       }
                                    }}
                                    className="text-sm cursor-pointer py-2 px-3 rounded-sm focus:bg-slate-50 dark:focus:bg-slate-700"
                                  >
                                     <div className="flex items-center justify-between w-full">
                                        <span className={order.paymentType === type ? 'font-medium' : ''}>{type.toUpperCase()}</span>
                                        {order.paymentType === type && <CheckCircle2 className="w-4 h-4 text-slate-600 dark:text-slate-400" />}
                                     </div>
                                  </DropdownMenuItem>
                                ))}
                             </DropdownMenuContent>
                           </DropdownMenu>
                           )}
                        </div>
                      </TableCell>
                      <TableCell className="py-6 text-center align-top">
                        <div className="flex items-center justify-center gap-1">
                           <div className={`inline-flex items-center px-2.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider border ${
                              order.paymentStatus === 'Paid' ? 'bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-400 dark:border-emerald-800' :
                              order.paymentStatus === 'Down Payment' ? 'bg-blue-100 text-blue-700 border-blue-200 dark:bg-blue-900/30 dark:text-blue-400 dark:border-blue-800' :
                              'bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700'
                           }`}>
                             {order.paymentStatus || 'Unpaid'}
                           </div>
                           {hasPermission('order.payment.edit_status') && (
                           <DropdownMenu>
                             <DropdownMenuTrigger asChild>
                               <Button variant="ghost" size="icon" className="h-6 w-6 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-600">
                                 <ChevronDown className="w-3.5 h-3.5" />
                               </Button>
                             </DropdownMenuTrigger>
                             <DropdownMenuContent align="center" className="bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 min-w-[160px] p-1">
                                {['Unpaid', 'Down Payment', 'Paid'].map((status) => (
                                  <DropdownMenuItem 
                                    key={status}
                                    disabled={savingOrderActionKey === `${order.id}:paymentStatus`}
                                    onClick={async () => {
                                       try {
                                         await saveOrderPatch(
                                           order,
                                           { paymentStatus: status as Order['paymentStatus'] },
                                           `Status pembayaran diperbarui: ${status}`,
                                           'paymentStatus',
                                         );
                                       } catch {
                                         // Error toast is handled by saveOrderPatch.
                                       }
                                    }}
                                    className="text-sm cursor-pointer py-2 px-3 rounded-sm focus:bg-slate-50 dark:focus:bg-slate-700"
                                  >
                                     <div className="flex items-center justify-between w-full">
                                        <span className={order.paymentStatus === status ? 'font-medium' : ''}>{status}</span>
                                        {order.paymentStatus === status && <CheckCircle2 className="w-4 h-4 text-slate-600 dark:text-slate-400" />}
                                     </div>
                                  </DropdownMenuItem>
                                ))}
                             </DropdownMenuContent>
                           </DropdownMenu>
                           )}
                        </div>
                      </TableCell>
                      <TableCell className="py-6 text-center align-top">
                        {(() => {
                            // Resolve Effective Status (Shadow Status from photos._status)
                            const rawStatus = order.status;
                            const customStatus = order.photos?._status;
                            const effectiveStatus = customStatus && (rawStatus === 'processing' || rawStatus === 'pending') 
                                ? customStatus 
                                : rawStatus;
                            
                            const reasonSummary = getStatusReasonSummary(order, effectiveStatus);

                            return (
                                <div className="flex flex-col items-center gap-1.5">
                                  <div className="flex items-center justify-center gap-1">
                                    <div className={`inline-flex items-center px-2.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider border ${getStatusBadgeVariant(effectiveStatus)}`}>
                                        {getStatusLabel(effectiveStatus)}
                                    </div>
                                    {hasPermission('order.status.edit') && !isOrderLocked(order.status) && (
                                    <DropdownMenu>
                                        <DropdownMenuTrigger asChild>
                                        <Button variant="ghost" size="icon" className="h-6 w-6 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-600">
                                            <ChevronDown className="w-3.5 h-3.5" />
                                        </Button>
                                        </DropdownMenuTrigger>
                                        <DropdownMenuContent align="center" className="bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 min-w-[160px] p-1">
                                            {[
                                            { value: 'pending', label: 'Terjadwal' },
                                            { value: 'done', label: 'Selesai' },
                                            { value: 'reschedule', label: 'Jadwal Ulang' },
                                            { value: 'cancelled', label: 'Cancel' },
                                            { value: 'processing', label: 'Proses' },
                                            ].map((status) => {
                                            const isDisabled = status.value === 'done' && !hasPermission('order.status.mark_done');
                                            return (
                                                <DropdownMenuItem 
                                                key={status.value}
                                                disabled={isDisabled}
                                                onClick={() => {
                                                    void handleInlineStatusChange(order, status.value as Order['status']);
                                                }}
                                                className={`text-sm cursor-pointer py-2 px-3 rounded-sm focus:bg-slate-50 dark:focus:bg-slate-700 ${
                                                    isDisabled ? 'opacity-50 cursor-not-allowed' : ''
                                                }`}
                                                >
                                                    <div className="flex items-center justify-between w-full">
                                                    <span className={order.status === status.value ? 'font-medium' : ''}>{status.label}</span>
                                                    {order.status === status.value && <CheckCircle2 className="w-4 h-4 text-slate-600 dark:text-slate-400" />}
                                                    </div>
                                                </DropdownMenuItem>
                                            );
                                            })}
                                        </DropdownMenuContent>
                                    </DropdownMenu>
                                    )}
                                  </div>
                                  {reasonSummary && (
                                    <div className="max-w-[140px] text-center text-[10px] leading-tight text-slate-500 dark:text-slate-400">
                                      {reasonSummary}
                                    </div>
                                  )}
                                </div>
                            );
                        })()}
                      </TableCell>
                      {canShowOrderActions && (
                      <TableCell className="py-6 pr-6 text-right align-top">
                        {renderOrderActions(order)}
                      </TableCell>
                      )}
                    </TableRow>
                    );
                  })
                )}
              </TableBody>
            </table>
            </DataTable>
            {/* Pagination Controls */}
            <div className="orderTablePagination">
              <div className="orderPaginationMeta">
                   <div className="orderPaginationStepper">
                      <Button 
                        variant="ghost" 
                        size="icon" 
                        className="orderPaginationButton"
                        disabled={currentPage === 1}
                        onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                      >
                         &lt;
                      </Button>
                      <div className="orderPaginationCurrent">
                        {currentPage}
                      </div>
                      <span className="orderPaginationSeparator">/</span>
                      <span className="orderPaginationTotal">{totalPages}</span>
                      <Button 
                        variant="ghost" 
                        size="icon" 
                        className="orderPaginationButton"
                        disabled={currentPage === totalPages || totalPages === 0}
                        onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
                      >
                         &gt;
                      </Button>
                   </div>
              </div>
              
              <div className="orderPageSizeControl">
                  <span className="orderPageSizeLabel">Tampilkan</span>
                  <Select 
                     value={itemsPerPage.toString()} 
                     onValueChange={(val) => {
                         setItemsPerPage(Number(val));
                         setCurrentPage(1);
                     }}
                  >
                      <SelectTrigger className="orderPageSizeTrigger">
                          <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="z-[200]">
                          {ORDER_TABLE_PAGE_SIZE_OPTIONS.map((size) => (
                            <SelectItem key={size} value={String(size)}>{size} / Halaman</SelectItem>
                          ))}
                      </SelectContent>
                  </Select>
              </div>
            </div>
          </div>

           {/* Bulk Edit Modal */}
            <Modal
                title={`Edit Massal (${selectedIds.size} Pesanan)`}
                isOpen={isBulkEditOpen}
                onClose={resetBulkEditor}
                className="max-w-md"
            >
                <div className="space-y-4">
                    <div className="space-y-2">
                        <Label>Pilih Kolom yang akan diedit</Label>
                        <Select value={bulkField} onValueChange={(val) => { setBulkField(val); setBulkValue(''); setBulkStatusReason(''); setBulkStatusReasonNote(''); }}>
                            <SelectTrigger>
                                <SelectValue placeholder="Pilih Kolom" />
                            </SelectTrigger>
                            <SelectContent className="z-[250]">
                                {(hasPermission('order.status.edit') || hasPermission('order.edit')) && <SelectItem value="status">Status Order</SelectItem>}
                                {(hasPermission('order.assign_technician') || hasPermission('order.edit')) && <SelectItem value="technicianId">Teknisi</SelectItem>}
                                {hasPermission('order.edit') && <SelectItem value="csId">Customer Service (CS)</SelectItem>}
                                {hasPermission('order.edit') && <SelectItem value="advertiserId">Advertiser</SelectItem>}
                                {hasPermission('order.edit') && <SelectItem value="branchId">Cabang</SelectItem>}
                                {hasPermission('order.edit') && <SelectItem value="serviceId">Layanan</SelectItem>}
                                {(hasPermission('order.payment.edit_status') || hasPermission('order.edit')) && <SelectItem value="paymentStatus">Status Pembayaran</SelectItem>}
                                {(hasPermission('order.payment.edit_status') || hasPermission('order.edit')) && <SelectItem value="deletePaymentProof" className="text-red-600 focus:text-red-700 font-medium">Hapus Bukti Transfer</SelectItem>}
                            </SelectContent>
                        </Select>
                    </div>

                    {bulkField && (
                        <div className="space-y-2">
                            <Label>Pilih Nilai Baru</Label>
                            {bulkField === 'status' ? (
                                <Select value={bulkValue} onValueChange={(value) => { setBulkValue(value); setBulkStatusReason(''); setBulkStatusReasonNote(''); }}>
                                    <SelectTrigger><SelectValue placeholder="Pilih Status" /></SelectTrigger>
                                    <SelectContent className="z-[250]">
                                        <SelectItem value="pending">Terjadwal</SelectItem>
                                        <SelectItem value="processing">Proses</SelectItem>
                                        <SelectItem value="done">Selesai</SelectItem>
                                        <SelectItem value="reschedule">Jadwal Ulang</SelectItem>
                                        <SelectItem value="cancelled">Cancel</SelectItem>
                                    </SelectContent>
                                </Select>
                            ) : bulkField === 'deletePaymentProof' ? (
                                <Select value={bulkValue} onValueChange={setBulkValue}>
                                    <SelectTrigger className="border-red-200 text-red-600 focus:ring-red-500"><SelectValue placeholder="Konfirmasi Penghapusan" /></SelectTrigger>
                                    <SelectContent className="z-[250]">
                                        <SelectItem value="confirm" className="text-red-600 font-bold focus:bg-red-50 focus:text-red-700">Ya, Hapus Bukti Permanen</SelectItem>
                                    </SelectContent>
                                </Select>
                            ) : bulkField === 'technicianId' ? (
                                <Select value={bulkValue} onValueChange={setBulkValue}>
                                    <SelectTrigger><SelectValue placeholder="Pilih Teknisi" /></SelectTrigger>
                                    <SelectContent className="z-[250]">
                                        {technicians.map(t => (
                                            <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            ) : bulkField === 'csId' ? (
                                <Select value={bulkValue} onValueChange={setBulkValue}>
                                    <SelectTrigger><SelectValue placeholder="Pilih CS" /></SelectTrigger>
                                    <SelectContent className="z-[250]">
                                        {bulkCsUsers.map(u => (
                                            <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            ) : bulkField === 'advertiserId' ? (
                                <Select value={bulkValue} onValueChange={setBulkValue}>
                                    <SelectTrigger><SelectValue placeholder="Pilih Advertiser" /></SelectTrigger>
                                    <SelectContent className="z-[250]">
                                        {bulkAdvertisers.map(u => (
                                            <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            ) : bulkField === 'branchId' ? (
                                <Select value={bulkValue} onValueChange={setBulkValue}>
                                    <SelectTrigger><SelectValue placeholder="Pilih Cabang" /></SelectTrigger>
                                    <SelectContent className="z-[250]">
                                        {branches.map(b => (
                                            <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            ) : bulkField === 'serviceId' ? (
                                <Select value={bulkValue} onValueChange={setBulkValue}>
                                    <SelectTrigger><SelectValue placeholder="Pilih Layanan" /></SelectTrigger>
                                    <SelectContent className="z-[250]">
                                        {activeServices.map(s => (
                                            <SelectItem key={s.id} value={s.id}>{s.name} - Rp {s.price.toLocaleString()}</SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            ) : bulkField === 'paymentStatus' ? (
                                <Select value={bulkValue} onValueChange={setBulkValue}>
                                    <SelectTrigger><SelectValue placeholder="Pilih Status Bayar" /></SelectTrigger>
                                    <SelectContent className="z-[250]">
                                        <SelectItem value="Unpaid">Unpaid</SelectItem>
                                        <SelectItem value="Down Payment">Down Payment</SelectItem>
                                        <SelectItem value="Paid">Paid</SelectItem>
                                    </SelectContent>
                                </Select>
                            ) : null}
                        </div>
                    )}

                    {bulkField === 'status' && isReasonRequiredStatus(bulkValue) && (
                        <OrderStatusReasonFields
                            status={bulkValue}
                            cancelReasons={cancelReasons}
                            value={bulkStatusReason}
                            note={bulkStatusReasonNote}
                            onReasonChange={(value) => {
                                setBulkStatusReason(value);
                                if (value !== 'Lainnya') {
                                    setBulkStatusReasonNote('');
                                }
                            }}
                            onNoteChange={setBulkStatusReasonNote}
                        />
                    )}
                    
                    <div className="flex justify-end gap-2 pt-4">
                        <Button variant="ghost" onClick={resetBulkEditor}>Batal</Button>
                        <Button onClick={handleBulkUpdate} disabled={!bulkField || !bulkValue}>Simpan Perubahan</Button>
                    </div>
                </div>
            </Modal>

            <Modal
                title={quickStatusChange ? `Ubah Status ke ${getStatusLabel(quickStatusChange.nextStatus)}` : 'Ubah Status'}
                isOpen={Boolean(quickStatusChange)}
                onClose={resetQuickStatusChange}
                size="sm"
                preventOutsideClose
                footer={
                    <div className="flex justify-end gap-2">
                        <Button variant="ghost" onClick={resetQuickStatusChange}>Batal</Button>
                        <Button onClick={handleConfirmQuickStatusChange}>Simpan Status</Button>
                    </div>
                }
            >
                <div className="space-y-4">
                    {quickStatusChange && (
                        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-300">
                            <span className="font-semibold text-slate-900 dark:text-slate-100">#{quickStatusChange.order.id}</span>
                            {' '}atas nama{' '}
                            <span className="font-medium text-slate-900 dark:text-slate-100">{quickStatusChange.order.customerName}</span>
                            {' '}akan diubah menjadi{' '}
                            <span className="font-semibold text-slate-900 dark:text-slate-100">{getStatusLabel(quickStatusChange.nextStatus)}</span>.
                        </div>
                    )}

                    <OrderStatusReasonFields
                        status={quickStatusChange?.nextStatus}
                        cancelReasons={cancelReasons}
                        value={quickStatusReason}
                        note={quickStatusReasonNote}
                        onReasonChange={(value) => {
                            setQuickStatusReason(value);
                            if (value !== 'Lainnya') {
                                setQuickStatusReasonNote('');
                            }
                        }}
                        onNoteChange={setQuickStatusReasonNote}
                    />
                </div>
            </Modal>

            {/* Mass Delete Alert */}
            <AlertDialog open={isMassDeleteOpen} onOpenChange={setIsMassDeleteOpen}>
              <AlertDialogContent className="max-w-md border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
                <AlertDialogHeader>
                  <AlertDialogTitle className="flex items-center gap-2 text-slate-900 dark:text-slate-100">
                    <AlertTriangle className="h-5 w-5 text-red-600" />
                    Hapus {selectedIds.size} pesanan?
                  </AlertDialogTitle>
                  <AlertDialogDescription className="text-slate-600 dark:text-slate-400">
                    Pesanan yang dipilih akan dihapus permanen dari database. Tindakan ini tidak dapat dibatalkan.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel className="border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100">
                    Batal
                  </AlertDialogCancel>
                  <AlertDialogAction onClick={() => void confirmMassDelete()} className="bg-red-600 text-white hover:bg-red-700">
                    Ya, hapus
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>

          {/* MOBILE CARD LIST (Visible on sm/xs) */}
          <div className="orderMobileSurface md:hidden p-4 space-y-3">
              <div className="orderMobileSortBar">
                <div className="orderMobileSortSummary">
                  <span>Urutan</span>
                  <strong>
                    {sortConfig?.key === 'price'
                      ? sortConfig.direction === 'desc'
                        ? 'Harga tertinggi'
                        : 'Harga terendah'
                      : 'Default'}
                  </strong>
                </div>
                <Select value={orderSortSelectValue} onValueChange={handleOrderSortSelectChange}>
                  <SelectTrigger className="orderMobileSortTrigger">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="z-[220]">
                    <SelectItem value="default">Default</SelectItem>
                    <SelectItem value="price-desc">Harga tertinggi</SelectItem>
                    <SelectItem value="price-asc">Harga terendah</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {ordersTableLoading ? (
                 <OrderMobileSkeleton />
              ) : paginatedOrders.length === 0 ? (
                 <div className="text-center py-12 text-slate-500 dark:text-slate-400 bg-slate-50 dark:bg-slate-800/50 rounded-xl border border-dashed border-slate-200 dark:border-slate-700">
                    {orders.length === 0
                      ? 'Data database belum masuk ke state lokal. Sistem sudah mencoba muat ulang sekali.'
                      : 'Tidak ada pesanan ditemukan'}
                 </div>
              ) : (
                 paginatedOrders.map((order) => {
                     const technician = userMap[order.technicianId];
                     const isAdvertiser = isAdvertiserUser;
                     const useCompactAdvertiserCard = isAdvertiser && !canViewCustomerContact && !canViewRoute;
                     const reasonSummary = getStatusReasonSummary(order);
                     const scheduleConflictInfo = scheduleConflictByItemKey.get(
                       getScheduleConflictItemKey('order', order.id)
                     );

                     return (
                     <div
                        key={order.id}
                        role={canViewOrderDetails ? 'button' : undefined}
                        tabIndex={canViewOrderDetails ? 0 : undefined}
                        aria-label={canViewOrderDetails ? `Buka detail pesanan ${order.id}` : undefined}
                        onClick={(event) => handleOrderCardClick(event, order)}
                        onKeyDown={(event) => handleOrderCardKeyDown(event, order)}
                        className={`orderMobileCard bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm p-4 ${canViewOrderDetails ? 'isInteractive' : ''}`}
                     >
                        {/* Header Row: ID + Status */}
                        <div className="orderMobileCardHeader flex justify-between items-center mb-2">
                            <div className="orderMobileCardMeta flex items-center gap-2">
                                <span className="orderMobileOrderId font-bold text-blue-600 dark:text-blue-400 text-xs">#{order.id}</span>
                                <span className="orderMobileSchedule text-[10px] text-slate-400">
                                   {new Date(order.serviceDate).toLocaleDateString('id-ID', { day: 'numeric', month: 'short' })} - {order.serviceTime}
                                </span>
                            </div>
                            <div className="orderMobileStatusStack flex flex-col items-end gap-1">
                                <Badge className={`uppercase text-[9px] px-1.5 py-0.5 rounded-sm ${getStatusBadgeVariant(order.status)}`}>
                                    {getStatusLabel(order.status)}
                                </Badge>
                                {reasonSummary && (
                                    <span className="max-w-[120px] text-right text-[10px] leading-tight text-slate-500 dark:text-slate-400">
                                        {reasonSummary}
                                    </span>
                                )}
                            </div>
                        </div>
                        {scheduleConflictInfo && (
                            <div className="mb-2 inline-flex items-center gap-1 text-[10px] font-semibold text-red-600 dark:text-red-400">
                                <AlertTriangle className="h-3 w-3" />
                                Bentrok jadwal
                            </div>
                        )}

                        {/* Content Row: Name, Platform | Sub Channel */}
                        <div className="orderMobileCardBody space-y-1">
                            <h3 className="orderMobileCustomerName font-bold text-slate-900 dark:text-slate-100 text-sm leading-tight">{order.customerName}</h3>
                            <div className="orderMobileServicePrice">
                              <span className="orderMobileServiceName">{getServiceName(order.serviceId)}</span>
                              <strong>Rp {order.price.toLocaleString('id-ID')}</strong>
                            </div>
                            
                            {/* Advertiser View: Simple Platform Info */}
                            {useCompactAdvertiserCard ? (
                                <div className="flex flex-wrap items-center gap-1 text-[10px] text-slate-500 dark:text-slate-400">
                                    <span className="font-medium text-slate-700 dark:text-slate-300">
                                        {platformMap[order.platformId]?.name || '-'}
                                    </span>
                                    {order.subChannelId && subChannelMap[order.subChannelId]?.name && (
                                        <>
                                            <span className="text-slate-300 dark:text-slate-600">|</span>
                                            <span>{subChannelMap[order.subChannelId]?.name}</span>
                                        </>
                                    )}
                                </div>
                            ) : (
                                /* Normal View: More Details */
                                <div className="orderMobileInfoList space-y-1 mt-1">
                                    {canViewCustomerContact && (
                                    <div className="flex items-center gap-1 text-xs text-slate-600 dark:text-slate-400">
                                        <Phone className="w-3 h-3" />
                                        <span>{order.customerPhone}</span>
                                    </div>
                                    )}
                                    {(canViewCustomerContact || canViewRoute) && (
                                    <div className="flex items-start gap-1 text-xs text-slate-500 dark:text-slate-400">
                                        <MapPin className="w-3 h-3 mt-0.5 shrink-0" />
                                        <span className="line-clamp-1">{order.address}</span>
                                    </div>
                                    )}
                                    {order.technicianId && (
                                        <div className="flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400 pt-1">
                                            <UserIcon className="w-3 h-3" />
                                            <span>Teknisi: {technician?.name || order.technicianId}</span>
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>

                        {/* Actions Footer */}
                        {canShowOrderActions && (
                            <div className="orderMobileCardFooter mt-3 flex items-center justify-end border-t border-slate-100 pt-3 dark:border-slate-700">
                                {renderOrderActions(order, 'mobile')}
                            </div>
                        )}
                    </div>
                    );

                 })
              )}
              {paginatedOrders.length > 0 && (
                <div className="orderMobilePagination">
                  <div className="orderMobilePaginationTop">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="orderPaginationButton"
                      disabled={currentPage === 1}
                      onClick={() => setCurrentPage((prev) => Math.max(1, prev - 1))}
                    >
                      &lt;
                    </Button>
                    <div className="orderMobilePaginationInfo">
                      <p>
                        Halaman {currentPage} / {totalPages || 1}
                      </p>
                      <span>
                        Menampilkan {(currentPage - 1) * itemsPerPage + 1}-{Math.min(currentPage * itemsPerPage, filteredOrders.length)} dari {filteredOrders.length}
                      </span>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="orderPaginationButton"
                      disabled={currentPage === totalPages || totalPages === 0}
                      onClick={() => setCurrentPage((prev) => Math.min(totalPages, prev + 1))}
                    >
                      &gt;
                    </Button>
                  </div>

                  <div className="orderPageSizeControl">
                    <span className="orderPageSizeLabel">Tampilkan</span>
                    <Select
                      value={itemsPerPage.toString()}
                      onValueChange={(val) => {
                        setItemsPerPage(Number(val));
                        setCurrentPage(1);
                      }}
                    >
                      <SelectTrigger className="orderPageSizeTrigger">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="z-[200]">
                        {ORDER_TABLE_PAGE_SIZE_OPTIONS.map((size) => (
                          <SelectItem key={size} value={String(size)}>{size} / Halaman</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              )}
          </div>
          </>
          ) : viewMode === 'map' ? (
             <div className="flex flex-col h-full min-h-[600px] bg-slate-50 dark:bg-slate-900">
                {/* Map View Header */}
                <div className="p-4 bg-blue-50 dark:bg-blue-900/20 border-b border-blue-100 dark:border-blue-800 flex flex-col sm:flex-row gap-4 justify-between items-start sm:items-center">
                    <div className="flex items-start gap-3">
                        <div className="w-10 h-10 rounded-lg bg-[#0E7490] flex items-center justify-center text-white flex-shrink-0 shadow-sm">
                        <MapPin className="w-5 h-5" />
                        </div>
                        <div>
                        <h4 className="font-bold text-[#0B1F3B] dark:text-slate-100 mb-1">Peta Sebaran & Rute</h4>
                        <p className="text-xs text-[#6B7280] dark:text-slate-400">
                           Menampilkan {routeGroups.reduce((acc, g) => acc + g.points.length, 0)} titik kunjungan dari {routeGroups.length} teknisi aktif.
                        </p>
                        </div>
                    </div>
                </div>

                <div className="flex flex-col lg:flex-row h-auto lg:h-[700px]">
                   {/* Sidebar List */}
                   <div className="w-full lg:w-80 border-r border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 overflow-y-auto order-2 lg:order-1 h-[300px] lg:h-full">
                        <div className="p-4 border-b border-slate-100 dark:border-slate-700 sticky top-0 bg-white dark:bg-slate-800 z-10">
                            <h5 className="font-bold text-slate-800 dark:text-slate-200 text-sm uppercase tracking-wide">
                                Jadwal Teknisi
                            </h5>
                        </div>
                        <div className="p-2 space-y-4">
                            {routeGroups.map((group) => (
                            <div key={group.id} className="space-y-2">
                                {/* Technician Header */}
                                <div className="flex items-center gap-2 px-2 py-1">
                                    <div className="w-2.5 h-2.5 rounded-full shadow-sm" style={{ backgroundColor: group.color }}></div>
                                    <h5 className="font-bold text-slate-700 dark:text-slate-300 text-xs">
                                        {group.technicianName}
                                    </h5>
                                    <span className="text-[10px] text-slate-400">({group.points.length})</span>
                                </div>

                                {/* Points List */}
                                <div className="space-y-1 ml-1.5 pl-2 border-l border-slate-200 dark:border-slate-700">
                                {group.points.map((point, index) => (
                                    <div key={point.id} className="group flex items-start gap-2 p-2 rounded hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors cursor-pointer border border-transparent hover:border-slate-100 dark:hover:border-slate-700">
                                        <div 
                                            className="w-5 h-5 rounded-full text-white flex items-center justify-center text-[10px] font-bold flex-shrink-0 mt-0.5 shadow-sm"
                                            style={{ backgroundColor: group.color }} 
                                        >
                                            {index + 1}
                                        </div>
                                        <div className="min-w-0 flex-1">
                                            <div className="flex items-center gap-1.5 w-full">
                                                <p className="text-xs font-bold text-slate-800 dark:text-slate-200 truncate flex-1">{point.name}</p>
                                            </div>
                                            <p className="text-[10px] text-slate-500 dark:text-slate-400 line-clamp-1">{point.address}</p>
                                            
                                            {point.isFallback && (
                                                <div className="mt-1 bg-red-50 dark:bg-red-900/20 border border-red-100 dark:border-red-800/50 rounded px-2 py-1 flex items-start gap-1.5">
                                                    <AlertTriangle className="w-3 h-3 text-red-600 dark:text-red-400 shrink-0 mt-0.5" />
                                                    <p className="text-[10px] text-red-700 dark:text-red-300 font-medium leading-tight">
                                                        Lokasi belum ditemukan. Menggunakan titik default Jakarta.
                                                    </p>
                                                </div>
                                            )}

                                            <div className="flex items-center gap-2 mt-1">
                                                <Badge status={point.status} size="sm" className="text-[9px] px-1 py-0 h-4" />
                                                <span className="text-[10px] text-slate-400 font-medium flex items-center gap-0.5">
                                                    <Clock className="w-2.5 h-2.5" /> {point.time}
                                                </span>
                                            </div>
                                        </div>
                                    </div>
                                ))}
                                </div>
                            </div>
                            ))}
                            {routeGroups.length === 0 && (
                                <div className="text-center py-8 px-4 text-xs text-slate-400">
                                    Tidak ada rute teknisi yang terbentuk dari filter saat ini.
                                </div>
                            )}
                        </div>
                   </div>

                   {/* Map Area */}
                   <div className="w-full aspect-[2/3] md:aspect-auto md:flex-1 relative z-0 md:h-full order-1 lg:order-2">
                     <React.Suspense
                       fallback={
                         <div className="flex h-full min-h-[360px] items-center justify-center gap-2 bg-white text-sm font-medium text-slate-500 dark:bg-slate-900 dark:text-slate-400">
                           <Loader2 className="h-4 w-4 animate-spin text-blue-600" />
                           Memuat peta...
                         </div>
                       }
                     >
                        <MapCard 
                            groups={routeGroups} 
                            branches={branchPoints}
                            height="100%" 
                            showLegend={false} 
                            className="border-none rounded-none" 
                        />
                     </React.Suspense>
                   </div>
                </div>
             </div>
          ) : null}
        </OperationalTableCard>

        {/* Mobile WA Template Sheet */}
        <Sheet open={waSheetOpen} onOpenChange={setWaSheetOpen}>
            <SheetContent side="bottom" className="rounded-t-[20px] max-h-[85vh] overflow-y-auto bg-white dark:bg-slate-900 px-6 pt-6 pb-8">
                <SheetHeader className="text-left mb-6 space-y-1">
                    <SheetTitle className="text-lg font-bold text-slate-900 dark:text-slate-100">Pilih Template Pesan</SheetTitle>
                    <SheetDescription className="text-slate-500 dark:text-slate-400 text-sm">
                        Kirim pesan WhatsApp ke <span className="font-medium text-slate-700 dark:text-slate-300">{waTargetOrder?.customerName}</span> ({waTargetOrder?.customerPhone})
                    </SheetDescription>
                </SheetHeader>
                
                <div className="space-y-3 pb-4">
                    {waTargetOrder && waTemplates
                        .filter(t => t.category === 'Orders' || t.category === 'General' || !t.category)
                        .map(t => {
                            const isUsed = isTemplateUsed(waTargetOrder, t.id);
                            return (
                                <div 
                                    key={t.id} 
                                    onClick={() => {
                                        handleWhatsappTemplate(waTargetOrder, t);
                                        setWaSheetOpen(false);
                                    }}
                                    className={`group p-4 rounded-xl border-2 cursor-pointer transition-all duration-200 active:scale-[0.99] ${
                                        isUsed 
                                        ? 'bg-blue-50/50 border-blue-500 dark:bg-blue-900/10 dark:border-blue-500' 
                                        : 'bg-white border-slate-200 dark:bg-slate-800 dark:border-slate-700 hover:border-blue-300 dark:hover:border-blue-700'
                                    }`}
                                >
                                    <div className="mb-1.5">
                                        <h4 className="font-bold text-sm text-slate-900 dark:text-slate-100 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">
                                            {t.title}
                                        </h4>
                                    </div>
                                    <p className="text-xs text-slate-500 dark:text-slate-400 line-clamp-2 leading-relaxed">
                                        {t.message.replace(/\[Nama\]/g, waTargetOrder.customerName)}
                                    </p>
                                </div>
                            );
                    })}
                </div>

                <div className="pt-2 sticky bottom-0 bg-white dark:bg-slate-900 pb-2">
                    <Button 
                        variant="outline" 
                        className="w-full justify-center h-12 rounded-xl border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-200 font-semibold hover:bg-slate-50 dark:hover:bg-slate-800 hover:text-slate-900 hover:border-slate-400 transition-all"
                        onClick={() => {
                            if (waTargetOrder) handleWhatsappTemplate(waTargetOrder);
                            setWaSheetOpen(false);
                        }}
                    >
                        Chat Manual (Tanpa Template)
                    </Button>
                </div>
            </SheetContent>
        </Sheet>

        {/* Order Form Modal */}
        {isFormOpen && (
          <React.Suspense fallback={null}>
            <OrderForm
              isOpen={isFormOpen}
              onClose={() => setIsFormOpen(false)}
              initialData={editingOrder}
            />
          </React.Suspense>
        )}

        {/* Order Detail Modal */}
        {detailOrder && isDetailOpen && (
          <React.Suspense fallback={null}>
            <OrderDetailDialog
              isOpen={isDetailOpen}
              onClose={() => setIsDetailOpen(false)}
              order={detailOrder}
            />
          </React.Suspense>
        )}

        {paymentOrder && isPaymentDialogOpen && (
          <React.Suspense fallback={null}>
            <OrderPaymentDialog
              isOpen={isPaymentDialogOpen}
              onClose={() => {
                setIsPaymentDialogOpen(false);
                setPaymentOrder(null);
              }}
              order={paymentOrder}
            />
          </React.Suspense>
        )}

        {/* Photo Viewer Modal */}
        <OrderPhotoViewerDialog
          order={photoViewerOrder}
          tab={photoViewerTab}
          onTabChange={setPhotoViewerTab}
          expandedTabs={expandedPhotoTabs}
          onExpandTab={(type) => setExpandedPhotoTabs((prev) => ({ ...prev, [type]: true }))}
          onClose={handleClosePhotoViewer}
          canUploadPaymentProof={canUploadPaymentProof}
          uploadedFiles={uploadedFiles}
          onUploadedFilesChange={setUploadedFiles}
          validateUploadedFile={validateOrderPaymentProofFile}
          isUploading={isUploading}
          onSavePaymentProof={handleSavePaymentProof}
        />

      {/* Import Preview Dialog */}
      {isImportPreviewOpen && (
        <React.Suspense fallback={null}>
          <ImportPreviewModal
            isOpen={isImportPreviewOpen}
            onClose={() => {
              setIsImportPreviewOpen(false);
              setImportPreviewData([]);
            }}
            onConfirm={handleConfirmImport}
            initialData={importPreviewData}
          />
        </React.Suspense>
      )}

        {/* Delete Confirmation */}
        <AlertDialog open={!!deleteId} onOpenChange={() => setDeleteId(null)}>
          <AlertDialogContent className="max-w-md border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
            <AlertDialogHeader>
              <AlertDialogTitle className="flex items-center gap-2 text-slate-900 dark:text-slate-100">
                <AlertTriangle className="h-5 w-5 text-red-600" />
                Hapus pesanan?
              </AlertDialogTitle>
              <AlertDialogDescription className="space-y-2 text-slate-600 dark:text-slate-400">
                <span className="block">
                  {deleteOrderTarget ? (
                    <>
                      Pesanan <span className="font-semibold text-slate-900 dark:text-slate-100">#{deleteOrderTarget.id}</span> atas nama{' '}
                      <span className="font-semibold text-slate-900 dark:text-slate-100">{deleteOrderTarget.customerName}</span> akan dihapus permanen.
                    </>
                  ) : (
                    'Pesanan ini akan dihapus permanen.'
                  )}
                </span>
                <span className="block">Tindakan ini tidak dapat dibatalkan.</span>
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel className="border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100">
                Batal
              </AlertDialogCancel>
              <AlertDialogAction onClick={() => void confirmDelete()} className="bg-red-600 text-white hover:bg-red-700">
                Ya, hapus
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
      {/* Hidden File Input for Import */}
      <input 
        type="file" 
        ref={fileInputRef} 
        className="hidden" 
        accept=".csv,.xlsx,.xls" 
        onChange={handleImportOrders} 
      />
    </OperationalPageShell>
  );
}
