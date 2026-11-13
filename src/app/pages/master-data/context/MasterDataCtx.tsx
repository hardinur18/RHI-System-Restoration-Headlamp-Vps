import type { OrderDateRequest } from './internal/masterDataRangeUtils';
import React, { createContext, useContext, useState, ReactNode, useEffect } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { Session } from '@supabase/supabase-js';
import { getSessionBackedEdgeHeaders } from '../../../services/internal/sessionClientHeaders';
import { ADS_DAILY_SYNC_HISTORY_UPDATED_EVENT } from '../../../services/adsDailySyncService';
import { buildMakeServerUrl } from '../../../services/internal/functionsBaseUrl';
import { fetchWithTimeout, isRequestTimeoutError } from '../../../services/internal/fetchWithTimeout';
import { recordPerfMetric, startPerfTimer } from '@/app/utils/perfTelemetry';
import { isAdminManagementRole, isCsRole, isFinanceRole, isTechnicianRole } from '@/app/data/roleHelpers';
import { getPreviousDateKey, getTodayDateKey } from '../dateKeys';
import { 
  Area, Branch,
  ServiceType,
  VehicleType,
  Platform,
  AdAccount,
  AdAccountAssignment,
  AdAccountOwnerAssignment,
  AdSource,
  PaymentMethod,
  User,
  Role,
  Lead,
  LeadSpamDailyInput,
  ProspectLabel,
  ProspectBooking,
  WATemplate,
  Order,
  DailyAd,
  RoleItem,
  Notification,
  SubChannel,
  Affiliate,
  Vendor,
  CancelReason,
} from '../data';
import { LeadSocialFields } from '../../leads/socialContact';
import { getVehicleNameValidationMessage, normalizeVehicleName } from '../vehicleValidation';
import {
  formatOrderBookingScheduleConflictMessage,
  formatOrderScheduleConflictMessage,
  formatProspectBookingScheduleConflictMessage,
  formatTechnicianUnavailableMessage,
  getOrderScheduleConflicts,
  getOrderProspectBookingScheduleConflicts,
  getProspectBookingScheduleConflicts,
  getTechnicianDaySchedule,
  isInactiveOrderScheduleStatus,
  isInactiveProspectBookingScheduleStatus,
  shouldValidateOrderScheduleOnSave,
  shouldValidateProspectBookingScheduleOnSave,
  shouldValidateProspectBookingTechnicianAvailabilityOnSave,
  shouldValidateTechnicianAvailabilityOnSave,
  validateOrderScheduleFromDB,
  validateProspectBookingScheduleFromDB,
} from '@/app/services/orderScheduleValidation';
import { normalizeOrderTime } from '@/app/services/orderTime';
import { isValidMapCoordinate, resolveCoordinatesFromMapsUrl } from '@/utils/mapUtils';
import {
  mapBranchFromDB,
  mapBranchToDB,
  mapAreaFromDB,
  mapAreaToDB,
  mapAdAccountFromDB,
  mapAdAccountAssignmentFromDB,
  mapAdAccountAssignmentToDB,
  mapAdAccountOwnerAssignmentFromDB,
  mapAdAccountOwnerAssignmentToDB,
  mapAdAccountToDB,
  mapAdSourceFromDB,
  mapAdSourceToDB,
  mapPaymentFromDB,
  mapPaymentToDB,
  mapRoleFromDB,
  mapRoleToDB,
  mapPlatformFromDB,
  mapPlatformToDB,
  mapSubChannelFromDB,
  mapSubChannelToDB,
  mapAffiliateFromDB,
  mapAffiliateToDB,
  mapVendorFromDB,
  mapVendorToDB,
  mapCancelReasonFromDB,
  mapCancelReasonToDB,
} from './internal/mappers/masterDataEntityMappers';
import { mapProfileToUser, mapProfilesToUsers } from './internal/mappers/userMappers';
import {
  mapScheduleFromDB,
  mapWATemplateFromDB,
  mapWATemplateToDB,
  mapDailyAdFromDB,
  mapDailyAdToDB,
  mapLeadSpamDailyInputFromDB,
  mapLeadSpamDailyInputToDB,
  mapProspectLabelFromDB,
  mapProspectLabelToDB,
} from './internal/mappers/miscMappers';
import {
  mapProspectBookingFromDB,
  mapProspectBookingToDB,
  mapOrderFromDB,
  mapOrderPatchToDB,
  mapOrderToDB,
} from './internal/mappers/transactionMappers';
import {
  LEAD_SOCIAL_MASTER_TYPE,
  hasLeadSocialData,
  isLeadSocialSchemaError,
  mapLeadFromDB,
  mapLeadToDB,
  mergeLeadSocialFields,
  pickLeadSocialFields,
  stripLeadSocialFields,
} from './internal/mappers/leadMappers';
import {
  deleteLeadSocialContactRecord,
  fetchLeadSocialContactMap,
  upsertLeadSocialContactRecord,
} from './internal/leadSocialAdapter';
import { createMasterDataFetchCatalog } from './internal/masterDataFetchCatalog';
import { useReferenceDataBootstrap } from './internal/useReferenceDataBootstrap';
import {
  APP_DATA_FETCH_TIMEOUT_MS,
  CACHEABLE_MASTER_TABLES,
  CACHEABLE_RANGE_TABLES,
  DIRECT_APP_DATA_FETCH_TIMEOUT_MS,
  OPERATIONAL_BOOTSTRAP_CONCURRENCY,
  buildRangeCacheSuffix,
  isLikelySupabaseOutage,
  readCachedAppDataPageRows,
  runSettledWithConcurrency,
  safeReadCachedRows,
  safeWriteCachedRows,
} from './internal/masterDataCache';
import {
  CURRENT_USER_PROFILE_FALLBACK_MAX_PAGES,
  CURRENT_USER_PROFILE_FALLBACK_PAGE_SIZE,
  CURRENT_USER_PROFILE_FALLBACK_TIMEOUT_MS,
  CURRENT_USER_PROFILE_TIMEOUT_MS,
  buildLocalProfileFallbackUser,
  buildSessionMetadataProfileFallback,
  clearCachedCurrentUser,
  mergeUsersById,
  readCachedCurrentUser,
  writeCachedCurrentUser,
} from './internal/currentUserBootstrap';
import {
  getCurrentMonthDateRange,
  getDeferredBootstrapTablesForPath,
  shouldBootstrapAdPerformanceInputsForPath,
} from './internal/masterDataBootstrapPlan';
import {
  mapFetchedRows,
  mergeRowsById,
  toBusinessDayUtcRange,
} from './internal/masterDataRangeUtils';
import {
  shouldSyncOrderCrmForOrder,
  shouldSyncOrderCrmForPatch,
  shouldSyncOrderLifecycleForOrder,
  shouldSyncOrderLifecycleForPatch,
} from './internal/orderSideEffectGuards';
import { saveOrderToCrmContact } from '@/app/services/crmContactsService';
import {
  findLeadDuplicates,
  formatLeadDuplicateWarning,
} from '/utils/leadDuplicate';

export interface TechnicianSchedule {
  id: string;
  userId: string;
  date: string; // YYYY-MM-DD
  type: 'Libur' | 'Sakit' | 'Cuti' | 'Izin';
  reason?: string;
  createdAt: string;
}

import { toast } from 'sonner';

type MutationOptions = {
  silent?: boolean;
  throwOnError?: boolean;
  skipFreshScheduleValidation?: boolean;
};

const normalizeOrderLocationForSave = async (item: Order, previous?: Order) => {
  const mapsUrl = item.mapsUrl?.trim();
  if (!mapsUrl) {
    // Preserve operational updates on legacy orders which never had a Maps
    // link. New orders, and attempts to remove an existing link, stay blocked.
    if (previous && !previous.mapsUrl?.trim()) {
      return { ...item, mapsUrl: undefined, lat: undefined, lng: undefined };
    }
    throw new Error('Maps URL wajib diisi agar lokasi pesanan dapat diverifikasi.');
  }

  const urlUnchanged = previous?.mapsUrl?.trim() === mapsUrl;
  if (urlUnchanged && isValidMapCoordinate(item.lat, item.lng)) {
    return { ...item, mapsUrl };
  }

  const coordinate = await resolveCoordinatesFromMapsUrl(mapsUrl);
  if (!coordinate) {
    throw new Error('Titik lokasi tidak berhasil dibaca dari Maps URL. Gunakan link Bagikan dari pin lokasi pelanggan.');
  }

  return {
    ...item,
    mapsUrl,
    lat: coordinate.lat,
    lng: coordinate.lng,
  };
};

const shouldUseLocalProfileFallback =
  import.meta.env.VITE_AUTH_MODE === 'local';

export type CurrentUserIssue =
  | { code: 'profile_not_found'; message: string }
  | { code: 'profile_inactive'; message: string; status?: string }
  | { code: 'invalid_role'; message: string; role?: string }
  | { code: 'profile_query_error'; message: string }
  | { code: 'profile_timeout'; message: string };

interface MasterDataContextType {
  areas: Area[];
  branches: Branch[];
  activeBranches: Branch[]; // Expose active branches
  services: ServiceType[];
  vehicles: VehicleType[];
  platforms: Platform[];
  subChannels: SubChannel[];
  adAccounts: AdAccount[];
  adAccountAssignments: AdAccountAssignment[];
  adAccountOwnerAssignments: AdAccountOwnerAssignment[];
  sources: AdSource[];
  payments: PaymentMethod[];
  roles: RoleItem[];
  users: User[];
  leads: Lead[];
  prospectLabels: ProspectLabel[];
  leadSpamDailyInputs: LeadSpamDailyInput[];
  prospectBookings: ProspectBooking[];
  waTemplates: WATemplate[];
  orders: Order[];
  dailyAds: DailyAd[];
  notifications: Notification[]; // New
  affiliates: Affiliate[];
  vendors: Vendor[];
  cancelReasons: CancelReason[];

  technicianSchedules: TechnicianSchedule[];
  addSchedule: (schedule: TechnicianSchedule) => Promise<void>;
  deleteSchedule: (userId: string, date: string) => Promise<void>;

  auditLogs: any[];

  // CRUD Actions
  addUser: (user: User) => void;
  createSystemUser: (data: any) => Promise<void>;
  updateUser: (user: User) => void;
  updateSystemUser: (id: string, data: any) => Promise<void>;
  deleteUser: (id: string) => void;
  deleteSystemUser: (id: string) => Promise<void>;
  resetUserPassword: (id: string, password: string) => Promise<void>;

  addLead: (lead: Lead, options?: MutationOptions) => Promise<Lead | undefined>;
  updateLead: (lead: Lead) => void;
  deleteLead: (id: string, options?: MutationOptions) => Promise<void>;

  addProspectLabel: (label: ProspectLabel) => void;
  updateProspectLabel: (label: ProspectLabel) => void;
  deleteProspectLabel: (id: string) => void;

  addProspectBooking: (booking: ProspectBooking, options?: MutationOptions) => Promise<ProspectBooking | undefined>;
  updateProspectBooking: (booking: ProspectBooking) => Promise<ProspectBooking | undefined>;
  deleteProspectBooking: (id: string) => void;

  addOrder: (order: Order, options?: MutationOptions) => Promise<Order | undefined>;
  updateOrder: (order: Order, options?: MutationOptions) => Promise<Order | undefined>;
  updateOrderPatch: (id: string, patch: Partial<Order>, options?: MutationOptions) => Promise<Order | undefined>;
  deleteOrder: (id: string) => Promise<void>;

  addWATemplate: (template: WATemplate) => void;
  updateWATemplate: (template: WATemplate) => void;
  deleteWATemplate: (id: string) => void;

  addDailyAd: (ad: DailyAd) => void;
  updateDailyAd: (ad: DailyAd) => void;
  deleteDailyAd: (id: string) => void;

  addLeadSpamDailyInput: (item: LeadSpamDailyInput, options?: MutationOptions) => Promise<LeadSpamDailyInput | undefined>;
  updateLeadSpamDailyInput: (item: LeadSpamDailyInput) => Promise<void>;
  deleteLeadSpamDailyInput: (id: string, options?: MutationOptions) => Promise<void>;

  addArea: (area: Area) => void;
  updateArea: (area: Area) => void;
  deleteArea: (id: string) => void;
  
  addBranch: (branch: Branch) => void;
  updateBranch: (branch: Branch) => void;
  deleteBranch: (id: string) => void;

  addService: (service: ServiceType) => void;
  updateService: (service: ServiceType) => void;
  deleteService: (id: string) => void;

  addVehicle: (vehicle: VehicleType) => void;
  updateVehicle: (vehicle: VehicleType) => void;
  deleteVehicle: (id: string) => void;

  addAdAccount: (adAccount: AdAccount) => void;
  updateAdAccount: (adAccount: AdAccount) => void;
  deleteAdAccount: (id: string) => void;
  assignAdAccountCs: (assignment: {
    adAccountId: string;
    csId: string;
    subChannelId?: string | null;
    startDate: string;
    notes?: string | null;
  }) => Promise<void>;
  assignAdAccountOwner: (assignment: {
    adAccountId: string;
    advertiserId: string;
    startDate: string;
    notes?: string | null;
  }) => Promise<void>;
  updateAdAccountOwnerAssignment: (assignment: AdAccountOwnerAssignment) => void;
  deleteAdAccountOwnerAssignment: (id: string) => void;
  updateAdAccountAssignment: (assignment: AdAccountAssignment) => void;
  deleteAdAccountAssignment: (id: string) => void;

  addPlatform: (platform: Platform) => void;
  updatePlatform: (platform: Platform) => void;
  deletePlatform: (id: string) => void;

  addSubChannel: (subChannel: SubChannel) => void;
  updateSubChannel: (subChannel: SubChannel) => void;
  deleteSubChannel: (id: string) => void;

  addSource: (source: AdSource) => void;
  updateSource: (source: AdSource) => void;
  deleteSource: (id: string) => void;

  addPayment: (payment: PaymentMethod) => void;
  updatePayment: (payment: PaymentMethod) => void;
  deletePayment: (id: string) => void;

  addRole: (role: RoleItem) => void;
  updateRole: (role: RoleItem) => void;
  deleteRole: (id: string) => void;

  addAffiliate: (affiliate: Affiliate) => void;
  updateAffiliate: (affiliate: Affiliate) => void;
  deleteAffiliate: (id: string) => void;

  addVendor: (vendor: Vendor) => void;
  updateVendor: (vendor: Vendor) => void;
  deleteVendor: (id: string) => void;

  // Notifications
  markNotificationAsRead: (id: string) => void;
  sendNotification: (notification: Omit<Notification, 'id' | 'createdAt' | 'isRead'>) => Promise<void>;

  // Global Refresh
  refreshTrigger: number;
  triggerRefresh: () => void;
  isMasterDataLoading: boolean;
  isOperationalDataLoading: boolean;
  isOrdersLoading: boolean;
  isLeadsLoading: boolean;
  ensureOrdersForDateRange: (range: OrderDateRequest) => Promise<void>;
  ensureLeadsForDateRange: (range: { from: string; to: string }) => Promise<void>;
  ensureProspectBookingsForDateRange: (range: { from: string; to: string }) => Promise<void>;
  ensureTechnicianSchedulesForDateRange: (range: { from: string; to: string }) => Promise<void>;
  ensureAdPerformanceInputsForDateRange: (range: { from: string; to: string }) => Promise<void>;
  refreshAdPerformanceInputsForDateRange: (range: { from: string; to: string }) => Promise<void>;

  // Setters (if needed for local state updates before refresh)
  setAreas: React.Dispatch<React.SetStateAction<Area[]>>;
  
  // Auth / Role Simulation
  currentRole: Role | undefined;
  currentUser: User | undefined;
  isCurrentUserResolved: boolean;
  currentUserIssue: CurrentUserIssue | undefined;
  setCurrentRole: (role: Role) => void;
  setCurrentUser: (user: User) => void;
}

const MasterDataContext = createContext<MasterDataContextType | undefined>(undefined);

export const MasterDataProvider: React.FC<{
  children: ReactNode;
  session?: Session | null;
  activePath?: string;
}> = ({ children, session, activePath = '/dashboard' }) => {
  // State Definitions
  const [areas, setAreas] = useState<Area[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [services, setServices] = useState<ServiceType[]>([]);
  const [vehicles, setVehicles] = useState<VehicleType[]>([]);
  const [platforms, setPlatforms] = useState<Platform[]>([]);
  const [subChannels, setSubChannels] = useState<SubChannel[]>([]);
  const [adAccounts, setAdAccounts] = useState<AdAccount[]>([]);
  const [adAccountAssignments, setAdAccountAssignments] = useState<AdAccountAssignment[]>([]);
  const [adAccountOwnerAssignments, setAdAccountOwnerAssignments] = useState<AdAccountOwnerAssignment[]>([]);
  const [sources, setSources] = useState<AdSource[]>([]);
  const [payments, setPayments] = useState<PaymentMethod[]>([]);
  const [roles, setRoles] = useState<RoleItem[]>([]);
  const [affiliates, setAffiliates] = useState<Affiliate[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [cancelReasons, setCancelReasons] = useState<CancelReason[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  
  // Derived active branches for operations
  const activeBranches = React.useMemo(() => {
    return branches.filter(b => b.status === 'active');
  }, [branches]);

  // These might still be mock-heavy if tables don't exist yet, but we'll try to fetch
  const [leads, setLeads] = useState<Lead[]>([]);
  const [prospectLabels, setProspectLabels] = useState<ProspectLabel[]>([]);
  const [leadSocialContacts, setLeadSocialContacts] = useState<Record<string, LeadSocialFields>>({});
  const [prospectBookings, setProspectBookings] = useState<ProspectBooking[]>([]);
  const [waTemplates, setWaTemplates] = useState<WATemplate[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [dailyAds, setDailyAds] = useState<DailyAd[]>([]);
  const [leadSpamDailyInputs, setLeadSpamDailyInputs] = useState<LeadSpamDailyInput[]>([]);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [technicianSchedules, setTechnicianSchedules] = useState<TechnicianSchedule[]>([]);
  
  const [auditLogs, setAuditLogs] = useState<any[]>([]);
  const [currentUserId, setCurrentUserId] = useState<string>('');
  const [realUser, setRealUser] = useState<User | undefined>(undefined);
  const [isCurrentUserResolved, setIsCurrentUserResolved] = useState(!session?.user);
  const [currentUserIssue, setCurrentUserIssue] = useState<CurrentUserIssue | undefined>(undefined);
  
  // Global Refresh Trigger
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const [isMasterDataLoading, setIsMasterDataLoading] = useState(true);
  const [isOperationalDataLoading, setIsOperationalDataLoading] = useState(true);
  const [isOrdersLoading, setIsOrdersLoading] = useState(true);
  const [isLeadsLoading, setIsLeadsLoading] = useState(true);
  const [realtimeRetryKey, setRealtimeRetryKey] = useState(0);
  const orderLoadGenerationRef = React.useRef(0);
  const fetchedOrderDateRangesRef = React.useRef(new Set<string>());
  const fetchedLeadDateRangesRef = React.useRef(new Set<string>());
  const fetchedProspectBookingDateRangesRef = React.useRef(new Set<string>());
  const fetchedTechnicianScheduleDateRangesRef = React.useRef(new Set<string>());
  const fetchedAdPerformanceDateRangesRef = React.useRef(new Set<string>());
  const fetchingOrderDateRangesRef = React.useRef(new Map<string, Promise<void>>());
  const fetchingLeadDateRangesRef = React.useRef(new Map<string, Promise<void>>());
  const fetchingProspectBookingDateRangesRef = React.useRef(new Map<string, Promise<void>>());
  const fetchingTechnicianScheduleDateRangesRef = React.useRef(new Map<string, Promise<void>>());
  const fetchingAdPerformanceDateRangesRef = React.useRef(new Map<string, Promise<void>>());
  const leadSocialContactsRef = React.useRef<Record<string, LeadSocialFields>>({});
  const leadSpamDailyInputsUseFallbackRef = React.useRef(false);

  useEffect(() => {
    leadSocialContactsRef.current = leadSocialContacts;
  }, [leadSocialContacts]);

  const isLeadSpamTableMissingError = (error: any) =>
    error?.code === 'PGRST205' ||
    error?.code === '42P01' ||
    String(error?.message || '').includes('lead_spam_daily_inputs') ||
    String(error?.message || '').toLowerCase().includes('schema cache');

  const leadSpamMasterUrl = buildMakeServerUrl('/master/lead_spam_daily_input');

  const fetchLeadSpamDailyInputsFallback = async () => {
    const response = await fetchWithTimeout(
      leadSpamMasterUrl,
      {
        headers: await getSessionBackedEdgeHeaders(),
      },
      APP_DATA_FETCH_TIMEOUT_MS,
      'Fallback input spam terlalu lama merespons.',
    );

    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body.error || 'Gagal memuat fallback input spam');
    }

    return (await response.json()) as LeadSpamDailyInput[];
  };

  const upsertLeadSpamDailyInputFallback = async (item: LeadSpamDailyInput) => {
    const now = new Date().toISOString();
    const payload: LeadSpamDailyInput = {
      ...item,
      createdAt: item.createdAt || now,
      updatedAt: now,
    };
    const response = await fetchWithTimeout(
      leadSpamMasterUrl,
      {
        method: 'POST',
        headers: await getSessionBackedEdgeHeaders({ includeJsonContentType: true }),
        body: JSON.stringify(payload),
      },
      APP_DATA_FETCH_TIMEOUT_MS,
      'Simpan fallback input spam terlalu lama merespons.',
    );

    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body.error || 'Gagal menyimpan fallback input spam');
    }

    return (await response.json()) as LeadSpamDailyInput;
  };

  const deleteLeadSpamDailyInputFallback = async (id: string) => {
    const response = await fetchWithTimeout(
      `${leadSpamMasterUrl}/${encodeURIComponent(id)}`,
      {
        method: 'DELETE',
        headers: await getSessionBackedEdgeHeaders(),
      },
      APP_DATA_FETCH_TIMEOUT_MS,
      'Hapus fallback input spam terlalu lama merespons.',
    );

    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body.error || 'Gagal menghapus fallback input spam');
    }
  };

  const appDataUrl = (table: string, id?: string) =>
    buildMakeServerUrl(`/app-data/${encodeURIComponent(table)}${id ? `/${encodeURIComponent(id)}` : ''}`);

  type AppDataPageOptions = {
    orderBy?: string;
    ascending?: boolean;
    eq?: Record<string, string>;
    gte?: Record<string, string>;
    lte?: Record<string, string>;
  };

  const readAppDataError = async (response: Response, fallback: string) => {
    const body = await response.json().catch(() => ({}));
    return new Error(body.error || fallback);
  };

  const isAppDataTransportFailure = (status?: number, error?: unknown) => {
    if (typeof status === 'number') return status >= 500;
    if (!error) return false;
    if (isRequestTimeoutError(error)) return true;

    const message = error instanceof Error ? error.message : String(error);
    return /failed to fetch|network|load failed|gateway|server data sedang lambat/i.test(message);
  };

  const createDirectAppDataRow = async (table: string, payload: any) => {
    const { data, error } = await supabase
      .from(table)
      .insert(payload)
      .select()
      .single();

    if (error) throw error;
    return data;
  };

  const updateDirectAppDataRow = async (table: string, id: string, payload: any) => {
    const { data, error } = await supabase
      .from(table)
      .update(payload)
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    return data;
  };

  const deleteDirectAppDataRow = async (table: string, id: string) => {
    const { error } = await supabase
      .from(table)
      .delete()
      .eq('id', id);

    if (error) throw error;
  };

  const fetchDirectAppDataPage = async (table: string, from: number, to: number, options: AppDataPageOptions = {}) => {
    const endTimer = startPerfTimer('master-data.direct-page', {
      table,
      from,
      to,
      orderBy: options.orderBy,
    });
    let query = supabase
      .from(table)
      .select('*');

    Object.entries(options.eq || {}).forEach(([column, value]) => {
      query = query.eq(column, value);
    });
    Object.entries(options.gte || {}).forEach(([column, value]) => {
      query = query.gte(column, value);
    });
    Object.entries(options.lte || {}).forEach(([column, value]) => {
      query = query.lte(column, value);
    });
    if (options.orderBy) {
      query = query.order(options.orderBy, { ascending: options.ascending ?? true });
    }
    if (table === 'orders' && options.orderBy !== 'id') {
      // Date ties must not move rows across offset pages.
      query = query.order('id', { ascending: true });
    }

    const abortController = new AbortController();
    const timeoutId = globalThis.setTimeout(
      () => abortController.abort(),
      DIRECT_APP_DATA_FETCH_TIMEOUT_MS,
    );

    try {
      const rangedQuery = query.range(from, to);
      const executableQuery =
        typeof (rangedQuery as any).abortSignal === 'function'
          ? (rangedQuery as any).abortSignal(abortController.signal)
          : rangedQuery;
      const { data, error } = await executableQuery;
      if (error) throw error;

      const rows = data || [];
      endTimer('ok', { rows: rows.length });
      return rows;
    } catch (error) {
      endTimer('error', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    } finally {
      globalThis.clearTimeout(timeoutId);
    }
  };

  const shouldRetryEmptyAppDataPageDirectly = (table: string, from: number) => {
    if (from !== 0) return false;

    return [
      'profiles',
      'branches',
      'areas',
      'services',
      'vehicle_types',
      'ad_platforms',
      'ad_sub_channels',
      'ad_accounts',
      'ad_account_assignments',
      'ad_account_owner_assignments',
      'ad_sources',
      'payment_methods',
      'roles',
      'leads',
      'prospect_bookings',
      'orders',
      'wa_templates',
      'daily_ads',
      'lead_spam_daily_inputs',
      'technician_schedules',
    ].includes(table);
  };

  const fetchAppDataPage = async (table: string, from: number, to: number, options: AppDataPageOptions = {}) => {
    const endTimer = startPerfTimer('master-data.app-data-page', {
      table,
      from,
      to,
      orderBy: options.orderBy,
    });
    const url = new URL(appDataUrl(table));
    url.searchParams.set('from', String(from));
    url.searchParams.set('to', String(to));
    if (options.orderBy) {
      url.searchParams.set('orderBy', options.orderBy);
    }
    if (typeof options.ascending === 'boolean') {
      url.searchParams.set('ascending', options.ascending ? 'true' : 'false');
    }
    Object.entries(options.eq || {}).forEach(([column, value]) => {
      url.searchParams.set(`eq_${column}`, value);
    });
    Object.entries(options.gte || {}).forEach(([column, value]) => {
      url.searchParams.set(`gte_${column}`, value);
    });
    Object.entries(options.lte || {}).forEach(([column, value]) => {
      url.searchParams.set(`lte_${column}`, value);
    });

    try {
      const response = await fetchWithTimeout(
        url.toString(),
        {
          headers: await getSessionBackedEdgeHeaders(),
        },
        APP_DATA_FETCH_TIMEOUT_MS,
        `Load ${table} terlalu lama. Server data sedang lambat.`,
      );

      if (response.status === 403) {
        const rows = await fetchDirectAppDataPage(table, from, to, options);
        if (import.meta.env.DEV) {
          console.info('[MasterData] app-data forbidden, using direct Supabase fallback', {
            table,
            rows: rows.length,
          });
        }
        endTimer('fallback', { reason: 'forbidden', rows: rows.length });
        return { rows, forbidden: false };
      }

      if (!response.ok) {
        const cachedRows = readCachedAppDataPageRows(table, from, to, options);
        if (isLikelySupabaseOutage(response.status) && cachedRows?.length) {
          if (import.meta.env.DEV) {
            console.warn('[MasterData] app-data outage, using cached page', {
              table,
              status: response.status,
              rows: cachedRows.length,
            });
          }
          endTimer('fallback', { reason: `cache_http_${response.status}`, rows: cachedRows.length });
          return { rows: cachedRows, forbidden: false };
        }

        if (isLikelySupabaseOutage(response.status)) {
          const error = await readAppDataError(response, `Gagal memuat ${table}`);
          endTimer('error', { status: response.status, error: error.message });
          throw error;
        }

        try {
          const rows = await fetchDirectAppDataPage(table, from, to, options);
          if (import.meta.env.DEV) {
            console.info('[MasterData] app-data failed, using direct Supabase fallback', {
              table,
              status: response.status,
              rows: rows.length,
            });
          }
          endTimer('fallback', { reason: `http_${response.status}`, rows: rows.length });
          return { rows, forbidden: false };
        } catch {
          const error = await readAppDataError(response, `Gagal memuat ${table}`);
          endTimer('error', { status: response.status, error: error.message });
          throw error;
        }
      }

      const body = await response.json();
      const rows = Array.isArray(body?.rows) ? body.rows : [];

      if (rows.length === 0 && shouldRetryEmptyAppDataPageDirectly(table, from)) {
        try {
          const directRows = await fetchDirectAppDataPage(table, from, to, options);
          if (directRows.length > 0) {
            if (import.meta.env.DEV) {
              console.info('[MasterData] app-data returned empty, using direct Supabase fallback', {
                table,
                rows: directRows.length,
              });
            }
            endTimer('fallback', { reason: 'empty_page', rows: directRows.length });
            return { rows: directRows, forbidden: false };
          }
        } catch (error) {
          if (import.meta.env.DEV) {
            console.warn('[MasterData] direct Supabase empty-page fallback failed', { table, error });
          }
        }
      }

      endTimer('ok', { rows: rows.length });
      return {
        rows,
        forbidden: false,
      };
    } catch (error) {
      const fallbackReason = isRequestTimeoutError(error) ? 'request_timeout' : 'request_failed';
      const cachedRows = readCachedAppDataPageRows(table, from, to, options);
      if (isLikelySupabaseOutage(undefined, error) && cachedRows?.length) {
        if (import.meta.env.DEV) {
          console.warn('[MasterData] app-data request failed, using cached page', {
            table,
            reason: fallbackReason,
            rows: cachedRows.length,
          });
        }
        endTimer('fallback', { reason: `cache_${fallbackReason}`, rows: cachedRows.length });
        return { rows: cachedRows, forbidden: false };
      }

      if (isLikelySupabaseOutage(undefined, error)) {
        endTimer('error', {
          error: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }

      try {
        const rows = await fetchDirectAppDataPage(table, from, to, options);
        if (import.meta.env.DEV) {
          console.info('[MasterData] app-data request failed, using direct Supabase fallback', {
            table,
            reason: fallbackReason,
            rows: rows.length,
          });
        }
        endTimer('fallback', { reason: fallbackReason, rows: rows.length });
        return { rows, forbidden: false };
      } catch (fallbackError) {
        if (import.meta.env.DEV) {
          console.warn('[MasterData] direct Supabase request fallback failed', {
            table,
            reason: fallbackReason,
            error: fallbackError,
          });
        }
      }

      endTimer('error', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  };

  const fetchAppDataPageStrict = async (table: string, from: number, to: number, options: AppDataPageOptions = {}) => {
    const endTimer = startPerfTimer('master-data.app-data-page-strict', {
      table,
      from,
      to,
      orderBy: options.orderBy,
    });
    const url = new URL(appDataUrl(table));
    url.searchParams.set('from', String(from));
    url.searchParams.set('to', String(to));
    if (options.orderBy) {
      url.searchParams.set('orderBy', options.orderBy);
    }
    if (typeof options.ascending === 'boolean') {
      url.searchParams.set('ascending', options.ascending ? 'true' : 'false');
    }
    Object.entries(options.eq || {}).forEach(([column, value]) => {
      url.searchParams.set(`eq_${column}`, value);
    });
    Object.entries(options.gte || {}).forEach(([column, value]) => {
      url.searchParams.set(`gte_${column}`, value);
    });
    Object.entries(options.lte || {}).forEach(([column, value]) => {
      url.searchParams.set(`lte_${column}`, value);
    });

    try {
      const response = await fetchWithTimeout(
        url.toString(),
        {
          headers: await getSessionBackedEdgeHeaders(),
        },
        APP_DATA_FETCH_TIMEOUT_MS,
        `Load ${table} terlalu lama. Server data sedang lambat.`,
      );

      if (response.status === 403) {
        endTimer('skipped', { reason: 'forbidden' });
        return { rows: [], forbidden: true };
      }

      if (!response.ok) {
        const error = await readAppDataError(response, `Gagal memuat ${table}`);
        endTimer('error', { status: response.status, error: error.message });
        throw error;
      }

      const body = await response.json();
      const rows = Array.isArray(body?.rows) ? body.rows : [];
      endTimer('ok', { rows: rows.length });
      return { rows, forbidden: false };
    } catch (error) {
      endTimer('error', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  };

  const createAppDataRow = async (table: string, payload: any) => {
    const endTimer = startPerfTimer('master-data.create-row', { table });
    try {
      const response = await fetchWithTimeout(
        appDataUrl(table),
        {
          method: 'POST',
          headers: await getSessionBackedEdgeHeaders({ includeJsonContentType: true }),
          body: JSON.stringify(payload),
        },
        APP_DATA_FETCH_TIMEOUT_MS,
        `Simpan ${table} terlalu lama. Coba ulang beberapa detik lagi.`,
      );

      if (!response.ok) {
        if (isAppDataTransportFailure(response.status)) {
          const data = await createDirectAppDataRow(table, payload);
          endTimer('fallback', { reason: `http_${response.status}`, hasRow: Boolean(data) });
          return data;
        }

        const error = await readAppDataError(response, `Gagal menyimpan ${table}`);
        endTimer('error', { status: response.status, error: error.message });
        throw error;
      }

      const body = await response.json();
      endTimer('ok', { hasRow: Boolean(body?.row) });
      return body?.row;
    } catch (error) {
      if (isAppDataTransportFailure(undefined, error)) {
        try {
          const data = await createDirectAppDataRow(table, payload);
          endTimer('fallback', {
            reason: error instanceof Error ? error.message : String(error),
            hasRow: Boolean(data),
          });
          return data;
        } catch (fallbackError) {
          endTimer('error', {
            error: fallbackError instanceof Error ? fallbackError.message : String(fallbackError),
          });
          throw fallbackError;
        }
      }

      endTimer('error', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  };

  const updateAppDataRow = async (table: string, id: string, payload: any) => {
    const endTimer = startPerfTimer('master-data.update-row', { table });
    try {
      const response = await fetchWithTimeout(
        appDataUrl(table, id),
        {
          method: 'PUT',
          headers: await getSessionBackedEdgeHeaders({ includeJsonContentType: true }),
          body: JSON.stringify(payload),
        },
        APP_DATA_FETCH_TIMEOUT_MS,
        `Update ${table} terlalu lama. Coba ulang beberapa detik lagi.`,
      );

      if (!response.ok) {
        if (isAppDataTransportFailure(response.status)) {
          const data = await updateDirectAppDataRow(table, id, payload);
          endTimer('fallback', { reason: `http_${response.status}`, hasRow: Boolean(data) });
          return data;
        }

        const error = await readAppDataError(response, `Gagal memperbarui ${table}`);
        endTimer('error', { status: response.status, error: error.message });
        throw error;
      }

      const body = await response.json();
      endTimer('ok', { hasRow: Boolean(body?.row) });
      return body?.row;
    } catch (error) {
      if (isAppDataTransportFailure(undefined, error)) {
        try {
          const data = await updateDirectAppDataRow(table, id, payload);
          endTimer('fallback', {
            reason: error instanceof Error ? error.message : String(error),
            hasRow: Boolean(data),
          });
          return data;
        } catch (fallbackError) {
          endTimer('error', {
            error: fallbackError instanceof Error ? fallbackError.message : String(fallbackError),
          });
          throw fallbackError;
        }
      }

      endTimer('error', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  };

  const deleteAppDataRow = async (table: string, id: string) => {
    const endTimer = startPerfTimer('master-data.delete-row', { table });
    try {
      const response = await fetchWithTimeout(
        appDataUrl(table, id),
        {
          method: 'DELETE',
          headers: await getSessionBackedEdgeHeaders(),
        },
        APP_DATA_FETCH_TIMEOUT_MS,
        `Hapus ${table} terlalu lama. Coba ulang beberapa detik lagi.`,
      );

      if (!response.ok) {
        if (isAppDataTransportFailure(response.status)) {
          await deleteDirectAppDataRow(table, id);
          endTimer('fallback', { reason: `http_${response.status}` });
          return;
        }

        const error = await readAppDataError(response, `Gagal menghapus ${table}`);
        endTimer('error', { status: response.status, error: error.message });
        throw error;
      }

      endTimer('ok');
    } catch (error) {
      if (isAppDataTransportFailure(undefined, error)) {
        try {
          await deleteDirectAppDataRow(table, id);
          endTimer('fallback', {
            reason: error instanceof Error ? error.message : String(error),
          });
          return;
        } catch (fallbackError) {
          endTimer('error', {
            error: fallbackError instanceof Error ? fallbackError.message : String(fallbackError),
          });
          throw fallbackError;
        }
      }

      endTimer('error', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  };

  type FetchDataOptions = {
    progressive?: boolean;
    mergeProgressiveWithPrevious?: boolean;
    pageSize?: number;
    appData?: AppDataPageOptions;
  };

  // The priority request and the date filter use the same paginated scope.
  // A full page is not evidence that today's orders are complete.
  const fetchTodayOrdersDirectly = async (
    todayKey: string,
    mapper?: (data: any[]) => any[],
    technicianId?: string,
  ) => fetchRangeRows('orders', {
    orderBy: 'service_date',
    ascending: false,
    gte: { service_date: todayKey },
    lte: { service_date: todayKey },
    ...(technicianId ? { eq: { technician_id: technicianId } } : {}),
  }, mapper, 250, true);

  const fetchTodayLeadsDirectly = async (todayKey: string, mapper?: (data: any[]) => any[]) => {
    const { fromIso, toIso } = toBusinessDayUtcRange(todayKey);
    const { data, error } = await supabase
      .from('leads')
      .select('*')
      .gte('created_at', fromIso)
      .lte('created_at', toIso)
      .order('created_at', { ascending: false })
      .range(0, 249);

    if (error) {
      throw error;
    }

    return mapFetchedRows(data || [], mapper);
  };

  const fetchRangeRows = async (
    table: string,
    options: AppDataPageOptions,
    mapper?: (data: any[]) => any[],
    pageSize = 500,
    preferDirect = false,
  ) => {
    const endTimer = startPerfTimer('master-data.range-fetch', {
      table,
      pageSize,
      preferDirect,
      orderBy: options.orderBy,
    });
    let allData: any[] = [];
    let page = 0;
    let hasMore = true;

    try {
      while (hasMore) {
        const from = page * pageSize;
        const to = from + pageSize - 1;
        const pageResult = preferDirect
          ? await fetchDirectAppDataPage(table, from, to, options)
              .then((rows) => ({ rows, forbidden: false }))
              .catch(async (error) => {
                if (import.meta.env.DEV) {
                  console.warn('[MasterData] direct range fetch failed, falling back to app-data', { table, error });
                }
                return fetchAppDataPage(table, from, to, options);
              })
          : await fetchAppDataPage(table, from, to, options);
        const { rows, forbidden } = pageResult;

        if (forbidden) {
          endTimer('skipped', { reason: 'forbidden', pages: page, rows: allData.length });
          return [];
        }
        if (rows.length === 0) break;

        allData.push(...rows);
        hasMore = rows.length >= pageSize;
        page += 1;
      }

      endTimer('ok', { pages: page, rows: allData.length });
      if (CACHEABLE_RANGE_TABLES.has(table)) {
        safeWriteCachedRows(table, allData, buildRangeCacheSuffix(options));
      }
      return mapFetchedRows(allData, mapper);
    } catch (error) {
      if (CACHEABLE_RANGE_TABLES.has(table)) {
        const cachedRows = safeReadCachedRows(table, buildRangeCacheSuffix(options));
        if (cachedRows?.length) {
          endTimer('fallback', { reason: 'cache', rows: cachedRows.length });
          if (import.meta.env.DEV) {
            console.warn('[MasterData] range fetch failed, using cached rows', { table, error });
          }
          return mapFetchedRows(cachedRows, mapper);
        }
      }
      endTimer('error', {
        pages: page,
        rows: allData.length,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  };

  const ensureOrdersForDateRange = React.useCallback(async ({
    from,
    to,
    mode = 'service',
    technicianId,
  }: OrderDateRequest) => {
    if (Boolean(from) !== Boolean(to)) throw new Error('Both date bounds are required');
    const allTime = !from && !to;

    const column = mode === 'created'
      ? 'created_at'
      : mode === 'lead'
        ? 'lead_date'
        : 'service_date';
    const rangeKey = allTime
      ? `all-time:${technicianId || 'all'}`
      : `${mode}:${from}:${to}:${technicianId || 'all'}`;
    if (fetchedOrderDateRangesRef.current.has(rangeKey) ||
        fetchedOrderDateRangesRef.current.has(`all-time:${technicianId || 'all'}`)) return;
    const generation = orderLoadGenerationRef.current;
    const inFlight = fetchingOrderDateRangesRef.current.get(rangeKey);
    if (inFlight) return inFlight;

    const appDataOptions: AppDataPageOptions = {
      orderBy: allTime ? 'created_at' : column,
      ascending: false,
    };
    if (from && to) {
      const dateRange = mode === 'created'
        ? toBusinessDayUtcRange(from, to)
        : { fromIso: from, toIso: to };
      appDataOptions.gte = { [column]: dateRange.fromIso };
      appDataOptions.lte = { [column]: dateRange.toIso };
    }
    if (technicianId) {
      appDataOptions.eq = { technician_id: technicianId };
    }

	    const request = (async () => {
	      const nextRows = await fetchRangeRows(
	        'orders',
	        appDataOptions,
	        (rows) => rows.map(mapOrderFromDB),
	        500,
	        true,
	      );

      if (generation !== orderLoadGenerationRef.current) return;
      if (nextRows.length > 0) {
        setOrders((previousRows) => mergeRowsById(nextRows, previousRows));
      }
      fetchedOrderDateRangesRef.current.add(rangeKey);
    })().finally(() => {
      if (generation === orderLoadGenerationRef.current) {
        fetchingOrderDateRangesRef.current.delete(rangeKey);
      }
    });

    fetchingOrderDateRangesRef.current.set(rangeKey, request);
    return request;
  }, []);

  const ensureLeadsForDateRange = React.useCallback(async ({
    from,
    to,
  }: {
    from: string;
    to: string;
  }) => {
    if (!from || !to) return;

    const rangeKey = `${from}:${to}`;
    if (fetchedLeadDateRangesRef.current.has(rangeKey)) return;
    const inFlight = fetchingLeadDateRangesRef.current.get(rangeKey);
    if (inFlight) return inFlight;

    const request = (async () => {
      const { fromIso, toIso } = toBusinessDayUtcRange(from, to);
	      const nextRows = await fetchRangeRows(
	        'leads',
	        {
	          orderBy: 'created_at',
	          ascending: false,
	          gte: { created_at: fromIso },
	          lte: { created_at: toIso },
	        },
	        (rows) => rows.map((lead) => mapLeadFromDB(lead, leadSocialContactsRef.current[lead.id])),
	        500,
	        true,
	      );

      if (nextRows.length > 0) {
        setLeads((previousRows) => mergeRowsById(nextRows, previousRows));
      }
      fetchedLeadDateRangesRef.current.add(rangeKey);
    })().finally(() => {
      fetchingLeadDateRangesRef.current.delete(rangeKey);
    });

    fetchingLeadDateRangesRef.current.set(rangeKey, request);
    return request;
  }, []);

  const ensureProspectBookingsForDateRange = React.useCallback(async ({
    from,
    to,
  }: {
    from: string;
    to: string;
  }) => {
    if (!from || !to) return;

    const rangeKey = `${from}:${to}`;
    if (fetchedProspectBookingDateRangesRef.current.has(rangeKey)) return;
    const inFlight = fetchingProspectBookingDateRangesRef.current.get(rangeKey);
    if (inFlight) return inFlight;

    const request = (async () => {
      const nextRows = await fetchRangeRows(
        'prospect_bookings',
        {
          orderBy: 'schedule_date',
          ascending: false,
          gte: { schedule_date: from },
          lte: { schedule_date: to },
        },
        (rows) => rows.map(mapProspectBookingFromDB),
        500,
        false,
      );

      if (nextRows.length > 0) {
        setProspectBookings((previousRows) => mergeRowsById(nextRows, previousRows));
      }
      fetchedProspectBookingDateRangesRef.current.add(rangeKey);
    })().finally(() => {
      fetchingProspectBookingDateRangesRef.current.delete(rangeKey);
    });

    fetchingProspectBookingDateRangesRef.current.set(rangeKey, request);
    return request;
  }, []);

  const ensureTechnicianSchedulesForDateRange = React.useCallback(async ({
    from,
    to,
  }: {
    from: string;
    to: string;
  }) => {
    if (!from || !to) return;

    const rangeKey = `${from}:${to}`;
    if (fetchedTechnicianScheduleDateRangesRef.current.has(rangeKey)) return;
    const inFlight = fetchingTechnicianScheduleDateRangesRef.current.get(rangeKey);
    if (inFlight) return inFlight;

    const request = (async () => {
      const nextRows = await fetchRangeRows(
        'technician_schedules',
        {
          orderBy: 'date',
          ascending: false,
          gte: { date: from },
          lte: { date: to },
        },
        (rows) => rows.map(mapScheduleFromDB),
        500,
        false,
      );

      if (nextRows.length > 0) {
        setTechnicianSchedules((previousRows) => mergeRowsById(nextRows, previousRows));
      }
      fetchedTechnicianScheduleDateRangesRef.current.add(rangeKey);
    })().finally(() => {
      fetchingTechnicianScheduleDateRangesRef.current.delete(rangeKey);
    });

    fetchingTechnicianScheduleDateRangesRef.current.set(rangeKey, request);
    return request;
  }, []);

  const ensureAdPerformanceInputsForDateRange = React.useCallback(async ({
    from,
    to,
  }: {
    from: string;
    to: string;
  }) => {
    if (!from || !to) return;

    const rangeKey = `${from}:${to}`;
    if (fetchedAdPerformanceDateRangesRef.current.has(rangeKey)) return;
    const inFlight = fetchingAdPerformanceDateRangesRef.current.get(rangeKey);
    if (inFlight) return inFlight;

    const request = (async () => {
      const [dailyAdsResult, leadSpamResult] = await Promise.allSettled([
        fetchRangeRows(
          'daily_ads',
          {
            orderBy: 'date',
            ascending: false,
            gte: { date: from },
            lte: { date: to },
          },
          (rows) => rows.map(mapDailyAdFromDB),
          500,
          false,
        ),
        fetchRangeRows(
          'lead_spam_daily_inputs',
          {
            orderBy: 'input_date',
            ascending: false,
            gte: { input_date: from },
            lte: { input_date: to },
          },
          (rows) => rows.map(mapLeadSpamDailyInputFromDB),
          500,
          false,
        ),
      ]);

      let hasCompletedFetch = false;

      if (dailyAdsResult.status === 'fulfilled') {
        hasCompletedFetch = true;
        if (dailyAdsResult.value.length > 0) {
          setDailyAds((previousRows) => mergeRowsById(dailyAdsResult.value, previousRows));
        }
      } else if (import.meta.env.DEV) {
        console.warn('[MasterData] daily ads range fetch failed', dailyAdsResult.reason);
      }

      if (leadSpamResult.status === 'fulfilled') {
        hasCompletedFetch = true;
        if (leadSpamResult.value.length > 0) {
          setLeadSpamDailyInputs((previousRows) => mergeRowsById(leadSpamResult.value, previousRows));
        }
      } else if (import.meta.env.DEV) {
        console.warn('[MasterData] lead spam range fetch failed', leadSpamResult.reason);
      }

      if (!hasCompletedFetch) {
        throw new Error('Gagal memuat data iklan/spam periode ini.');
      }

      fetchedAdPerformanceDateRangesRef.current.add(rangeKey);
    })().finally(() => {
      fetchingAdPerformanceDateRangesRef.current.delete(rangeKey);
    });

    fetchingAdPerformanceDateRangesRef.current.set(rangeKey, request);
    return request;
  }, []);

  const refreshAdPerformanceInputsForDateRange = React.useCallback(async ({
    from,
    to,
  }: {
    from: string;
    to: string;
  }) => {
    if (!from || !to) return;

    const rangeKey = `${from}:${to}`;
    fetchedAdPerformanceDateRangesRef.current.delete(rangeKey);
    fetchingAdPerformanceDateRangesRef.current.delete(rangeKey);
    await ensureAdPerformanceInputsForDateRange({ from, to });
  }, [ensureAdPerformanceInputsForDateRange]);

  // Helper to fetch data from a table
	  const fetchData = async (
	    table: string,
	    setter: React.Dispatch<React.SetStateAction<any[]>>,
	    mapper?: (data: any[]) => any[],
	    options: FetchDataOptions = {},
	  ) => {
	    const endTimer = startPerfTimer('master-data.full-fetch', {
	      table,
	      pageSize: options.pageSize || 1000,
	      progressive: Boolean(options.progressive),
	      orderBy: options.appData?.orderBy,
	    });
	    try {
	      let hydratedFromCache = false;
	      if (CACHEABLE_MASTER_TABLES.has(table)) {
	        const cachedRows = safeReadCachedRows(table);
	        if (cachedRows?.length) {
	          setter(mapFetchedRows(cachedRows, mapper));
	          hydratedFromCache = true;
	        }
	      }
	      let allData: any[] = [];
	      let page = 0;
	      const pageSize = options.pageSize || 1000;
	      let hasMore = true;
	      const MAX_RECORDS = 50000; // Safety cap

      while (hasMore) {
        const from = page * pageSize;
        const to = from + pageSize - 1;

        const { rows, forbidden } = await fetchAppDataPage(table, from, to, options.appData);

        if (forbidden) {
          setter([]);
          endTimer('skipped', { reason: 'forbidden', pages: page, rows: allData.length });
          if (import.meta.env.DEV) {
            console.info('[MasterData] skipped forbidden table', { table });
          }
          return;
        }

        if (rows.length > 0) {
          allData.push(...rows);

          if (options.progressive) {
            const mappedRows = mapFetchedRows(allData, mapper);
            setter((previousRows) =>
              options.mergeProgressiveWithPrevious ? mergeRowsById(mappedRows, previousRows) : mappedRows
            );
          }
          
          if (rows.length < pageSize) {
            hasMore = false; // Reached end
          } else {
            page++;
          }

          if (allData.length >= MAX_RECORDS) {
             console.warn(`Fetch limit reached for ${table} (${MAX_RECORDS} rows)`);
             hasMore = false;
          }
        } else {
          hasMore = false;
        }
      }

	      if (allData.length === 0 && hydratedFromCache) {
	        endTimer('fallback', { reason: 'stale-cache', pages: page + 1, rows: 0 });
	        return;
	      }

	      if (!options.progressive || allData.length === 0) {
	        setter(mapFetchedRows(allData, mapper));
	      }
      if (CACHEABLE_MASTER_TABLES.has(table)) {
        safeWriteCachedRows(table, allData);
      }
      endTimer('ok', { pages: page + 1, rows: allData.length });
    } catch (e) {
      if (table === 'lead_spam_daily_inputs' && isLeadSpamTableMissingError(e)) {
        leadSpamDailyInputsUseFallbackRef.current = true;
        const fallbackRows = await fetchLeadSpamDailyInputsFallback();
        setter(fallbackRows);
        endTimer('fallback', { reason: 'lead_spam_missing_table', rows: fallbackRows.length });
        return;
      }
      endTimer('error', {
        error: e instanceof Error ? e.message : String(e),
      });
      if (CACHEABLE_MASTER_TABLES.has(table)) {
        const cachedRows = safeReadCachedRows(table);
        if (cachedRows?.length) {
          setter(mapFetchedRows(cachedRows, mapper));
          if (import.meta.env.DEV) {
            console.warn('[MasterData] full fetch failed, using cached rows', { table, error: e });
          }
          return;
        }
      }
      console.error(`Error fetching ${table}:`, e);
    }
  };

  const isAssignmentSchemaCacheError = (table: string, error: any) =>
    (table === 'ad_account_assignments' || table === 'ad_account_owner_assignments') &&
    String(error?.message || '').toLowerCase().includes('notes') &&
    String(error?.message || '').toLowerCase().includes('schema cache');

  const withoutAssignmentDraftColumns = (payload: any) => {
    if (!payload || typeof payload !== 'object') return payload;
    const { notes: _notes, ...rest } = payload;
    return rest;
  };

  // Generic CRUD Helpers
  const addItem = async (table: string, item: any, setter: React.Dispatch<React.SetStateAction<any[]>>, dbMapper?: (item: any) => any, uiMapper?: (item: any) => any, options?: MutationOptions) => {
    try {
      const payload = dbMapper ? dbMapper(item) : item;
      let data = await createAppDataRow(table, payload);
      if (data) {
         const uiItem = uiMapper ? uiMapper(data) : data;
         setter(prev => {
            if (prev.some(i => i.id === uiItem.id)) return prev;
            return [uiItem, ...prev];
         });
         if (!options?.silent) {
           toast.success("Data berhasil disimpan");
         }
         return uiItem;
      }
    } catch (e: any) {
      if (isAssignmentSchemaCacheError(table, e)) {
        const data = await createAppDataRow(table, withoutAssignmentDraftColumns(dbMapper ? dbMapper(item) : item));
        const uiItem = uiMapper ? uiMapper(data) : data;
        setter(prev => {
          if (prev.some(i => i.id === uiItem.id)) return prev;
          return [uiItem, ...prev];
        });
        if (!options?.silent) {
          toast.success("Data berhasil disimpan");
        }
        return uiItem;
      }
      if (table === 'lead_spam_daily_inputs' && isLeadSpamTableMissingError(e)) {
        leadSpamDailyInputsUseFallbackRef.current = true;
        const fallbackItem = await upsertLeadSpamDailyInputFallback(item as LeadSpamDailyInput);
        setter(prev => {
          if (prev.some(i => i.id === fallbackItem.id)) {
            return prev.map(i => i.id === fallbackItem.id ? { ...i, ...fallbackItem } : i);
          }
          return [fallbackItem, ...prev];
        });
        if (!options?.silent) {
          toast.success("Data berhasil disimpan");
        }
        return fallbackItem;
      }
      console.error(`Error adding to ${table}:`, e);
      if (!options?.silent) {
        toast.error(`Gagal menyimpan data: ${e.message}`);
      }
      throw e;
    }
  };

  const updateItem = async (
    table: string,
    item: any,
    setter: React.Dispatch<React.SetStateAction<any[]>>,
    dbMapper?: (item: any) => any,
    uiMapper?: (item: any) => any,
    options?: MutationOptions,
  ) => {
    try {
      const payload = dbMapper ? dbMapper(item) : item;
      let data = await updateAppDataRow(table, item.id, payload);
      if (data) {
         const uiItem = uiMapper ? uiMapper(data) : data;
         setter(prev => prev.map(i => i.id === item.id ? { ...i, ...uiItem } : i));
         if (!options?.silent) {
           toast.success("Data berhasil diperbarui");
         }
         return uiItem;
      } else {
         setter(prev => prev.map(i => i.id === item.id ? { ...i, ...item } : i));
         if (!options?.silent) {
           toast.success("Data berhasil diperbarui");
         }
         return item;
      }
    } catch (e: any) {
      if (isAssignmentSchemaCacheError(table, e)) {
        const data = await updateAppDataRow(table, item.id, withoutAssignmentDraftColumns(dbMapper ? dbMapper(item) : item));
        const uiItem = uiMapper ? uiMapper(data) : data;
        setter(prev => prev.map(i => i.id === item.id ? { ...i, ...uiItem } : i));
        if (!options?.silent) {
          toast.success("Data berhasil diperbarui");
        }
        return uiItem;
      }
      if (table === 'lead_spam_daily_inputs' && isLeadSpamTableMissingError(e)) {
        leadSpamDailyInputsUseFallbackRef.current = true;
        const fallbackItem = await upsertLeadSpamDailyInputFallback(item as LeadSpamDailyInput);
        setter(prev => prev.map(i => i.id === item.id ? { ...i, ...fallbackItem } : i));
        if (!options?.silent) {
          toast.success("Data berhasil diperbarui");
        }
        return fallbackItem;
      }
      console.error(`Error updating ${table}:`, e);
      if (!options?.silent) {
        toast.error(`Gagal memperbarui data: ${e.message}`);
      }
      throw e;
    }
  };

  const deleteItem = async (table: string, id: string, setter: React.Dispatch<React.SetStateAction<any[]>>, options?: MutationOptions) => {
    try {
      await deleteAppDataRow(table, id);
      setter(prev => prev.filter(i => i.id !== id));
      if (!options?.silent) {
        toast.success("Data berhasil dihapus");
      }
    } catch (e: any) {
      if (table === 'lead_spam_daily_inputs' && isLeadSpamTableMissingError(e)) {
        leadSpamDailyInputsUseFallbackRef.current = true;
        await deleteLeadSpamDailyInputFallback(id);
        setter(prev => prev.filter(i => i.id !== id));
        if (!options?.silent) {
          toast.success("Data berhasil dihapus");
        }
        return;
      }
      console.error(`Error deleting from ${table}:`, e);
      if (!options?.silent) {
        toast.error(`Gagal menghapus data: ${e.message}`);
      }
      if (options?.throwOnError) {
        throw e;
      }
    }
  };

  const fetchLeadSocialContacts = async () => {
    try {
      const socialMap = await fetchLeadSocialContactMap({
        masterType: LEAD_SOCIAL_MASTER_TYPE,
      });

      setLeadSocialContacts(socialMap);
      setLeads(prev => prev.map((lead) => mergeLeadSocialFields(lead, socialMap[lead.id])));
    } catch (error) {
      console.warn('Failed to fetch lead social contacts:', error);
    }
  };

  const upsertLeadSocialContact = async (lead: Lead) => {
    if (!hasLeadSocialData(lead)) {
      return deleteLeadSocialContact(lead.id);
    }

    const saved = await upsertLeadSocialContactRecord({
      masterType: LEAD_SOCIAL_MASTER_TYPE,
    }, lead);
    setLeadSocialContacts(prev => ({ ...prev, [lead.id]: saved }));
    setLeads(prev => prev.map(item => item.id === lead.id ? mergeLeadSocialFields(item, saved) : item));
    return saved;
  };

  const deleteLeadSocialContact = async (leadId: string) => {
    try {
      await deleteLeadSocialContactRecord({
        masterType: LEAD_SOCIAL_MASTER_TYPE,
      }, leadId);
    } catch (error) {
      console.warn(`Failed to delete lead social contact ${leadId}:`, error);
    } finally {
      setLeadSocialContacts(prev => {
        const next = { ...prev };
        delete next[leadId];
        return next;
      });
      setLeads(prev => prev.map(lead => lead.id === leadId ? stripLeadSocialFields(lead) : lead));
    }
  };




  // Sync Current User with Session
  useEffect(() => {
    if (!session?.user) {
      setCurrentUserId('');
      setRealUser(undefined);
      setCurrentUserIssue(undefined);
      setIsCurrentUserResolved(true);
      return;
    }
    
    let isMounted = true;
    const abortController = new AbortController();
    setCurrentUserId('');
    setRealUser(undefined);
    setCurrentUserIssue(undefined);
    setIsCurrentUserResolved(false);

    const cachedUserAtBoot = readCachedCurrentUser(session.user.id);
    if (cachedUserAtBoot) {
      console.warn('[MasterData] Opening app with cached current user while profile is verified in background:', {
        userId: cachedUserAtBoot.id,
        role: cachedUserAtBoot.role,
      });
      setCurrentUserId(cachedUserAtBoot.id);
      setRealUser(cachedUserAtBoot);
      setUsers(prev => {
        const exists = prev.some(user => user.id === cachedUserAtBoot.id);
        if (exists) return prev.map(user => user.id === cachedUserAtBoot.id ? cachedUserAtBoot : user);
        return [cachedUserAtBoot, ...prev];
      });
      setIsCurrentUserResolved(true);
    }

    const syncUser = async () => {
      let profileSyncTimeoutId: number | undefined;

      const applyCachedUser = (reason: CurrentUserIssue) => {
        const cachedUser = readCachedCurrentUser(session.user.id);
        if (!cachedUser) {
          return false;
        }

        console.warn('[MasterData] Using cached current user after profile sync issue:', {
          reason: reason.code,
          userId: cachedUser.id,
          role: cachedUser.role,
        });
        setCurrentUserIssue(undefined);
        setCurrentUserId(cachedUser.id);
        setRealUser(cachedUser);
        setUsers(prev => {
          const exists = prev.some(user => user.id === cachedUser.id);
          if (exists) return prev.map(user => user.id === cachedUser.id ? cachedUser : user);
          return [cachedUser, ...prev];
        });
        return true;
      };

      const applyLocalFallbackUser = (reason: CurrentUserIssue) => {
        if (applyCachedUser(reason)) {
          return true;
        }

        if (!shouldUseLocalProfileFallback) {
          setCurrentUserIssue(reason);
          return false;
        }

        const fallbackUser = buildLocalProfileFallbackUser(session);
        console.warn('[MasterData] Using local v2 profile fallback:', {
          reason: reason.code,
          userId: fallbackUser.id,
          email: fallbackUser.email,
        });
        setCurrentUserIssue(undefined);
        setCurrentUserId(fallbackUser.id);
        setRealUser(fallbackUser);
        setUsers(prev => {
          const exists = prev.some(user => user.id === fallbackUser.id);
          if (exists) return prev.map(user => user.id === fallbackUser.id ? fallbackUser : user);
          return [fallbackUser, ...prev];
        });
        return true;
      };

      const fetchCurrentProfileFromAppData = async () => {
        let timeoutId: number | undefined;
        const appDataLookup = (async () => {
          let page = 0;

          while (page < CURRENT_USER_PROFILE_FALLBACK_MAX_PAGES) {
            const from = page * CURRENT_USER_PROFILE_FALLBACK_PAGE_SIZE;
            const to = from + CURRENT_USER_PROFILE_FALLBACK_PAGE_SIZE - 1;
            const { rows } = await fetchAppDataPage('profiles', from, to, {
              eq: { id: session.user.id },
              orderBy: 'created_at',
              ascending: false,
            });
            const profile = rows.find((row: any) => row?.id === session.user.id);
            if (profile) return profile;
            if (rows.length < CURRENT_USER_PROFILE_FALLBACK_PAGE_SIZE) break;
            page += 1;
          }

          return null;
        })();

        const timeout = new Promise<null>((resolve) => {
          timeoutId = window.setTimeout(() => resolve(null), CURRENT_USER_PROFILE_FALLBACK_TIMEOUT_MS);
        });

        try {
          return await Promise.race([appDataLookup, timeout]);
        } finally {
          if (timeoutId !== undefined) {
            window.clearTimeout(timeoutId);
          }
        }
      };

      const applyProfile = (profile: any) => {
        console.log(`[MasterData] Syncing user profile - Role: ${profile.role}, Status: ${profile.status}`);

        const normalizedStatus = typeof profile.status === 'string' ? profile.status.trim().toLowerCase() : '';
        if (normalizedStatus === 'inactive') {
          clearCachedCurrentUser(profile.id);
          setCurrentUserId(profile.id);
          setRealUser(undefined);
          setUsers(prev => prev.filter(u => u.id !== profile.id));
          setCurrentUserIssue({
            code: 'profile_inactive',
            status: profile.status,
            message: 'Profil akun ini berstatus inactive, jadi akses app ditutup.',
          });
          return;
        }

        const mappedUser = mapProfileToUser({
          ...profile,
          email: session.user.email || profile.email,
          name: profile.name || session.user.email?.split('@')[0] || 'User',
          created_at: profile.created_at || new Date().toISOString(),
        });

        if (!isMounted) return;

        setCurrentUserId(profile.id);

        if (!mappedUser) {
          clearCachedCurrentUser(profile.id);
          setRealUser(undefined);
          setUsers(prev => prev.filter(u => u.id !== profile.id));
          setCurrentUserIssue({
            code: 'invalid_role',
            role: profile.role,
            message: `Role "${profile.role || '-'}" belum masuk daftar role app v2.`,
          });
          return;
        }

        setCurrentUserIssue(undefined);
        setRealUser(mappedUser);
        writeCachedCurrentUser(mappedUser);

        setUsers(prev => {
           const exists = prev.find(u => u.id === mappedUser.id);
           if (exists) return prev.map(u => u.id === mappedUser.id ? mappedUser : u);
           return [mappedUser, ...prev];
        });
      };

      const applyProfileFallback = async (reason: CurrentUserIssue) => {
        try {
          const fallbackProfile = await fetchCurrentProfileFromAppData();
          if (fallbackProfile) {
            console.warn('[MasterData] Direct profile sync failed, using app-data profile fallback:', {
              reason: reason.code,
              userId: fallbackProfile.id,
            });
            applyProfile(fallbackProfile);
            return true;
          }
        } catch (fallbackError) {
          console.warn('[MasterData] app-data profile fallback failed:', fallbackError);
        }

        const metadataProfile = buildSessionMetadataProfileFallback(session);
        if (metadataProfile) {
          console.warn('[MasterData] Profile sync failed, using auth metadata profile fallback:', {
            reason: reason.code,
            userId: metadataProfile.id,
            role: metadataProfile.role,
          });
          applyProfile(metadataProfile);
          return true;
        }

        return applyLocalFallbackUser(reason);
      };

      try {
        // Add a small delay to prevent race conditions on rapid re-renders
        await new Promise(resolve => setTimeout(resolve, 100));
        
        if (!isMounted) return;

        const profileQuery = supabase
          .from('profiles')
          .select('*')
          .eq('id', session.user.id)
          .abortSignal(abortController.signal)
          .maybeSingle();

        const profileTimeout = new Promise<{ timedOut: true }>((resolve) => {
          profileSyncTimeoutId = window.setTimeout(() => {
            abortController.abort();
            resolve({ timedOut: true });
          }, CURRENT_USER_PROFILE_TIMEOUT_MS);
        });

        const profileResult = await Promise.race([profileQuery, profileTimeout]);
        
        if (!isMounted) return;

        if ('timedOut' in profileResult) {
          console.warn("[MasterData] Profile fetch timed out");
          await applyProfileFallback({
            code: 'profile_timeout',
            message: 'Koneksi ke data profil timeout. Coba refresh atau login ulang.',
          });
          return;
        }

        const { data: profile, error } = profileResult;

        if (error) {
          // Ignore abort errors - they're expected on cleanup
          if (error.message?.includes('abort') || error.message?.includes('AbortError')) {
            console.log("[MasterData] Profile fetch aborted (cleanup)");
            return;
          }
          console.error("[MasterData] Profile fetch error:", error.message);
          await applyProfileFallback({
            code: 'profile_query_error',
            message: error.message || 'Profil login tidak bisa dibaca dari database.',
          });
          return;
        }

        if (!profile) {
          console.warn('[MasterData] Active auth session has no matching profile row:', {
            userId: session.user.id,
            email: session.user.email,
          });
          await applyProfileFallback({
            code: 'profile_not_found',
            message: 'Sesi browser masih aktif, tetapi akun ini belum punya profil internal di app v2.',
          });
          return;
        }

        applyProfile(profile);
      } catch (err: any) {
        // Ignore abort errors
        if (err?.name === 'AbortError' || err?.message?.includes('abort')) {
          console.log("[MasterData] Profile fetch aborted (cleanup)");
          return;
        }
        console.error("[MasterData] Unexpected error syncing user:", err);
        await applyProfileFallback({
          code: 'profile_query_error',
          message: err?.message || 'Terjadi error saat sinkronisasi profil login.',
        });
      } finally {
        if (profileSyncTimeoutId !== undefined) {
          window.clearTimeout(profileSyncTimeoutId);
        }
        if (isMounted) {
          setIsCurrentUserResolved(true);
        }
      }
    };
    
    syncUser();

    return () => {
      isMounted = false;
      abortController.abort();
    };
  }, [session?.user?.id]); // Only re-run when user ID changes.

  // Derived State
  const currentUser = React.useMemo(() => {
     if (realUser && realUser.id === currentUserId) return realUser;
     if (currentUserId) {
        const found = users.find(u => u.id === currentUserId);
        return found;
     }
     return undefined;
  }, [currentUserId, users, realUser]);

  const currentRole = currentUser?.role;

  // Ref to access current user inside realtime callbacks without dependency loop
  const currentUserRef = React.useRef(currentUser);
  useEffect(() => {
      currentUserRef.current = currentUser;
  }, [currentUser]);

  // Role Simulation Helpers
  const setCurrentUser = (user: User) => {
      setCurrentUserId(user.id);
  };

  const setCurrentRole = (role: Role) => {
      if (currentUser) {
          // Update the user's role in the local state to simulate the switch
          const updated = { ...currentUser, role };
          setUsers(prev => prev.map(u => u.id === currentUser.id ? updated : u));
          if (realUser && realUser.id === currentUser.id) {
              setRealUser(updated);
          }
      }
  };

  // ACTIONS IMPLEMENTATION
  
  // -- USERS (Handled differently due to Auth/Edge Functions)
  const addUser = (user: User) => setUsers(prev => [user, ...prev]);
  const updateUser = (user: User) => setUsers(prev => prev.map(item => item.id === user.id ? user : item)); // Local update
  const refetchUsersFromProfiles = async () => {
    const pageSize = 1000;
    const cachedProfiles = safeReadCachedRows('profiles');
    if (cachedProfiles?.length) {
      setUsers((previousUsers) => mergeUsersById(mapProfilesToUsers(cachedProfiles), previousUsers));
    }

    const loadPages = async (loader: (from: number, to: number) => Promise<any[]>) => {
      const rows: any[] = [];
      let page = 0;

      while (true) {
        const pageRows = await loader(page * pageSize, (page + 1) * pageSize - 1);
        rows.push(...pageRows);
        if (pageRows.length < pageSize) break;
        page += 1;
      }

      return rows;
    };

    let directUsers: User[] = [];
    let directFetchFailedWithOutage = false;

    try {
      const directRows = await loadPages((from, to) => fetchDirectAppDataPage('profiles', from, to));
      directUsers = mapProfilesToUsers(directRows);
      if (directRows.length > 0) {
        safeWriteCachedRows('profiles', directRows);
      }
    } catch (error) {
      directFetchFailedWithOutage = isLikelySupabaseOutage(undefined, error);
      if (import.meta.env.DEV) {
        console.warn('[MasterData] direct profiles fetch failed', error);
      }
    }

    if (directFetchFailedWithOutage && cachedProfiles?.length) {
      if (import.meta.env.DEV) {
        console.warn('[MasterData] skipping app-data profile verification during Supabase outage; using cached users');
      }
      return;
    }

    let bestSource = { source: 'direct', users: directUsers };
    const directTechnicianCount = directUsers.filter((user) => isTechnicianRole(user.role) && user.status === 'active').length;
    const shouldValidateProfilesViaAppData =
      directUsers.length <= 1 ||
      (shouldEnsureScheduleUserRoster && directTechnicianCount === 0);

    try {
      if (!shouldValidateProfilesViaAppData) {
        if (import.meta.env.DEV) {
          console.info('[MasterData] direct profiles are complete enough; skipping app-data profile verification', {
            users: directUsers.length,
            activeTechnicians: directTechnicianCount,
          });
        }
      } else {
        const appDataRows = await loadPages(async (from, to) => {
          const { rows } = await fetchAppDataPage('profiles', from, to);
          return rows;
        });
        const appDataUsers = mapProfilesToUsers(appDataRows);
        const appDataTechnicianCount = appDataUsers.filter((user) => isTechnicianRole(user.role) && user.status === 'active').length;
        const shouldPreferAppData =
          appDataUsers.length > directUsers.length ||
          (appDataTechnicianCount > 0 && directTechnicianCount === 0);

        if (shouldPreferAppData) {
          bestSource = { source: 'app-data', users: appDataUsers };
        }
      }
    } catch (error) {
      if (import.meta.env.DEV) {
        console.warn('[MasterData] app-data profiles fetch failed', error);
      }
    }

    if (!bestSource || bestSource.users.length === 0) return;

    setUsers(prev => {
      const previousActiveTechnicianCount = prev.filter((user) => isTechnicianRole(user.role) && user.status === 'active').length;
      const nextActiveTechnicianCount = bestSource.users.filter((user) => isTechnicianRole(user.role) && user.status === 'active').length;
      const isDowngradeToCurrentUserOnly = prev.length > bestSource.users.length && bestSource.users.length <= 1;
      const isDowngradeToMissingTechnicians = previousActiveTechnicianCount > 0 && nextActiveTechnicianCount === 0;
      if (isDowngradeToCurrentUserOnly || isDowngradeToMissingTechnicians) {
        if (import.meta.env.DEV) {
          console.warn('[MasterData] ignoring incomplete profiles refresh', {
            source: bestSource.source,
            previousUsers: prev.length,
            nextUsers: bestSource.users.length,
            previousActiveTechnicians: previousActiveTechnicianCount,
            nextActiveTechnicians: nextActiveTechnicianCount,
          });
        }
        return prev;
      }

      if (import.meta.env.DEV) {
        console.info('[MasterData] profiles refreshed', {
          source: bestSource.source,
          users: bestSource.users.length,
        });
      }

      return bestSource.users;
    });
  };

  const refetchScheduleUsersFromProfiles = async () => {
    const pageSize = 1000;
    const rows: any[] = [];
    let page = 0;

    while (true) {
      const from = page * pageSize;
      const to = from + pageSize - 1;
      const { rows: pageRows, forbidden } = await fetchAppDataPageStrict('profiles', from, to, {
        orderBy: 'created_at',
        ascending: false,
      });
      if (forbidden) return;
      rows.push(...pageRows);
      if (pageRows.length < pageSize) break;
      page += 1;
    }

    const scheduleUsers = mapProfilesToUsers(rows);
    const activeTechnicianCount = scheduleUsers.filter((user) => isTechnicianRole(user.role) && user.status === 'active').length;
    if (scheduleUsers.length === 0 || activeTechnicianCount === 0) return;

    setUsers((prev) => {
      const previousActiveTechnicianCount = prev.filter((user) => isTechnicianRole(user.role) && user.status === 'active').length;
      const mergedUsers = mergeUsersById(scheduleUsers, prev);

      if (import.meta.env.DEV) {
        console.info('[MasterData] schedule profiles refreshed', {
          users: scheduleUsers.length,
          activeTechnicians: activeTechnicianCount,
          previousActiveTechnicians: previousActiveTechnicianCount,
        });
      }

      return mergedUsers;
    });
  };
  
  const createSystemUser = async (data: any) => {
    try {
        const headers = await getSessionBackedEdgeHeaders({ includeJsonContentType: true });
        const response = await fetch(buildMakeServerUrl('/users'), {
            method: 'POST',
            headers,
            body: JSON.stringify(data)
        });
        if (!response.ok) {
            const err = await response.json();
            throw new Error(err.error || 'Failed to create user');
        }
        await refetchUsersFromProfiles();
        toast.success("User berhasil dibuat");
    } catch (e: any) {
        console.error("Create user error:", e);
        toast.error(`Gagal membuat user: ${e.message}`);
        throw e;
    }
  };

  const updateSystemUser = async (id: string, data: any) => {
    try {
      const startedAt = performance.now();
      const headers = await getSessionBackedEdgeHeaders({ includeJsonContentType: true });
      const headersReadyAt = performance.now();
      const response = await fetch(buildMakeServerUrl(`/users/${id}`), {
        method: 'PUT',
        headers,
        body: JSON.stringify(data),
      });
      const responseReadyAt = performance.now();

      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || 'Failed to update user');
      }

      const result = await response.json().catch(() => null);
      const updatedUser = result?.profile ? mapProfileToUser(result.profile) : null;
      if (updatedUser) {
        setUsers(prev => {
          const exists = prev.some(user => user.id === updatedUser.id);
          if (exists) return prev.map(user => user.id === updatedUser.id ? updatedUser : user);
          return [updatedUser, ...prev];
        });
      } else {
        void refetchUsersFromProfiles();
      }
      if (import.meta.env.DEV) {
        const finishedAt = performance.now();
        console.info('[Users] updateSystemUser timing', {
          sessionHeadersMs: Math.round(headersReadyAt - startedAt),
          putRequestMs: Math.round(responseReadyAt - headersReadyAt),
          localStateMs: Math.round(finishedAt - responseReadyAt),
          totalMs: Math.round(finishedAt - startedAt),
        });
      }
      toast.success("Data pengguna berhasil diperbarui");
    } catch (e: any) {
      console.error("Update user error:", e);
      toast.error(`Gagal memperbarui user: ${e.message}`);
      throw e;
    }
  };

  const deleteSystemUser = async (id: string) => {
    try {
        const headers = await getSessionBackedEdgeHeaders();
        const response = await fetch(buildMakeServerUrl(`/users/${id}`), {
            method: 'DELETE',
            headers
        });
        if (!response.ok) {
             const err = await response.json();
             throw new Error(err.error || 'Failed to delete user');
        }
        setUsers(prev => prev.filter(u => u.id !== id));
        toast.success("User berhasil dihapus");
    } catch (e: any) {
         console.error("Delete user error:", e);
         toast.error(`Gagal menghapus user: ${e.message}`);
         throw e;
    }
  };
  const deleteUser = (id: string) => deleteSystemUser(id); // Map deleteUser to system delete

  const resetUserPassword = async (id: string, password: string) => {
    try {
      // Ensure we have a valid ID
      if (!id) throw new Error("User ID is required");
      const headers = await getSessionBackedEdgeHeaders({ includeJsonContentType: true });
      
      // STRATEGY: Send User Token in custom header 'x-client-token'
      // And send Public Anon Key in 'Authorization' to pass Gateway checks
      const response = await fetch(buildMakeServerUrl(`/users/${id}/password`), {
          method: 'PUT',
          headers,
          body: JSON.stringify({ password })
      });
      
      if (!response.ok) {
           let errMsg = 'Failed to reset password';
           try {
               const text = await response.text();
               try {
                  const err = JSON.parse(text);
                  errMsg = err.error || err.message || text;
               } catch {
                  errMsg += ` (Status: ${response.status}) ${text.slice(0, 100)}`;
               }
           } catch {
                errMsg += ` (Status: ${response.status})`;
            }
           throw new Error(errMsg);
      }
      
      toast.success("Password berhasil direset");
    } catch (e: any) {
      console.error("Reset password error:", e);
      toast.error(e.message || "Gagal mereset password");
      throw e;
    }
  };

  // Mappers for Snake Case DB <-> Camel Case UI live in ./internal/mappers.

  const prepareVehicleForSave = (item: VehicleType): VehicleType => {
    const name = normalizeVehicleName(item.name);
    const validationMessage = getVehicleNameValidationMessage(name);
    if (validationMessage) {
      throw new Error(validationMessage);
    }

    return {
      ...item,
      id: item.id || crypto.randomUUID(),
      name,
    };
  };

  // -- BRANCHES
  const addBranch = (item: Branch) => addItem('branches', item, setBranches, mapBranchToDB, mapBranchFromDB);
  const updateBranch = (item: Branch) => updateItem('branches', item, setBranches, mapBranchToDB, mapBranchFromDB);
  const deleteBranch = (id: string) => deleteItem('branches', id, setBranches);

  // -- AREAS
  const addArea = (item: Area) => addItem('areas', item, setAreas, mapAreaToDB, mapAreaFromDB);
  const updateArea = (item: Area) => updateItem('areas', item, setAreas, mapAreaToDB, mapAreaFromDB);
  const deleteArea = (id: string) => deleteItem('areas', id, setAreas);

  // -- SERVICES
  const addService = (item: ServiceType) => addItem('services', item, setServices);
  const updateService = (item: ServiceType) => updateItem('services', item, setServices);
  const deleteService = (id: string) => deleteItem('services', id, setServices);

  // -- VEHICLES
  const addVehicle = (item: VehicleType) => addItem('vehicle_types', prepareVehicleForSave(item), setVehicles);
  const updateVehicle = (item: VehicleType) => updateItem('vehicle_types', prepareVehicleForSave(item), setVehicles);
  const deleteVehicle = (id: string) => deleteItem('vehicle_types', id, setVehicles);

  // -- PLATFORMS
  const addPlatform = (item: Platform) => addItem('ad_platforms', item, setPlatforms, mapPlatformToDB, mapPlatformFromDB);
  const updatePlatform = (item: Platform) => updateItem('ad_platforms', item, setPlatforms, mapPlatformToDB, mapPlatformFromDB);
  const deletePlatform = (id: string) => deleteItem('ad_platforms', id, setPlatforms);

  // -- SUB CHANNELS
  const addSubChannel = (item: SubChannel) => addItem('ad_sub_channels', item, setSubChannels, mapSubChannelToDB, mapSubChannelFromDB);
  const updateSubChannel = (item: SubChannel) => updateItem('ad_sub_channels', item, setSubChannels, mapSubChannelToDB, mapSubChannelFromDB);
  const deleteSubChannel = (id: string) => deleteItem('ad_sub_channels', id, setSubChannels);

  // -- AD ACCOUNTS
  const addAdAccount = (item: AdAccount) => addItem('ad_accounts', item, setAdAccounts, mapAdAccountToDB, mapAdAccountFromDB);
  const updateAdAccount = (item: AdAccount) => updateItem('ad_accounts', item, setAdAccounts, mapAdAccountToDB, mapAdAccountFromDB);
  const deleteAdAccount = (id: string) => deleteItem('ad_accounts', id, setAdAccounts);
  const updateAdAccountAssignment = (item: AdAccountAssignment) =>
    updateItem('ad_account_assignments', item, setAdAccountAssignments, mapAdAccountAssignmentToDB, mapAdAccountAssignmentFromDB);
  const deleteAdAccountAssignment = (id: string) => deleteItem('ad_account_assignments', id, setAdAccountAssignments);
  const updateAdAccountOwnerAssignment = (item: AdAccountOwnerAssignment) =>
    updateItem(
      'ad_account_owner_assignments',
      item,
      setAdAccountOwnerAssignments,
      mapAdAccountOwnerAssignmentToDB,
      mapAdAccountOwnerAssignmentFromDB,
    );
  const deleteAdAccountOwnerAssignment = (id: string) =>
    deleteItem('ad_account_owner_assignments', id, setAdAccountOwnerAssignments);

  const closeOverlappingAccountOwnerAssignments = async (
    adAccountId: string,
    normalizedStartDate: string,
  ) => {
    const previousEndDate = getPreviousDateKey(normalizedStartDate);

    const activeAssignments = adAccountOwnerAssignments.filter(
      (assignment) =>
        assignment.adAccountId === adAccountId &&
        assignment.status === 'active' &&
        (!assignment.endDate || assignment.endDate >= normalizedStartDate),
    );

    for (const assignment of activeAssignments) {
      if (assignment.startDate >= normalizedStartDate) {
        await updateItem(
          'ad_account_owner_assignments',
          { ...assignment, status: 'inactive', endDate: assignment.startDate },
          setAdAccountOwnerAssignments,
          mapAdAccountOwnerAssignmentToDB,
          mapAdAccountOwnerAssignmentFromDB,
        );
      } else {
        await updateItem(
          'ad_account_owner_assignments',
          { ...assignment, endDate: previousEndDate },
          setAdAccountOwnerAssignments,
          mapAdAccountOwnerAssignmentToDB,
          mapAdAccountOwnerAssignmentFromDB,
        );
      }
    }
  };

  const assignAdAccountOwner = async ({
    adAccountId,
    advertiserId,
    notes,
    startDate,
  }: {
    adAccountId: string;
    advertiserId: string;
    startDate: string;
    notes?: string | null;
  }) => {
    const normalizedStartDate = startDate || getTodayDateKey();

    try {
      await closeOverlappingAccountOwnerAssignments(adAccountId, normalizedStartDate);

      await addItem(
        'ad_account_owner_assignments',
        {
          id: crypto.randomUUID(),
          adAccountId,
          advertiserId,
          startDate: normalizedStartDate,
          endDate: null,
          status: 'active',
          notes: notes?.trim() || null,
        } satisfies AdAccountOwnerAssignment,
        setAdAccountOwnerAssignments,
        mapAdAccountOwnerAssignmentToDB,
        mapAdAccountOwnerAssignmentFromDB,
      );

      const account = adAccounts.find((item) => item.id === adAccountId);
      if (account && account.advertiserId !== advertiserId) {
        await updateAdAccount({ ...account, advertiserId });
      }
    } catch (error) {
      console.error('Error assigning ad account owner:', error);
      throw error;
    }
  };

  const assignAdAccountCs = async ({
    adAccountId,
    csId,
    notes,
    subChannelId,
    startDate,
  }: {
    adAccountId: string;
    csId: string;
    subChannelId?: string | null;
    startDate: string;
    notes?: string | null;
  }) => {
    const normalizedStartDate = startDate || getTodayDateKey();
    const previousEndDate = getPreviousDateKey(normalizedStartDate);

    try {
      const activeAssignments = adAccountAssignments.filter(
        (assignment) =>
          assignment.adAccountId === adAccountId &&
          assignment.status === 'active' &&
          (!assignment.endDate || assignment.endDate >= normalizedStartDate),
      );

      for (const assignment of activeAssignments) {
        if (assignment.startDate >= normalizedStartDate) {
          await updateItem(
            'ad_account_assignments',
            { ...assignment, status: 'inactive', endDate: assignment.startDate },
            setAdAccountAssignments,
            mapAdAccountAssignmentToDB,
            mapAdAccountAssignmentFromDB,
          );
        } else {
          await updateItem(
            'ad_account_assignments',
            { ...assignment, endDate: previousEndDate },
            setAdAccountAssignments,
            mapAdAccountAssignmentToDB,
            mapAdAccountAssignmentFromDB,
          );
        }
      }

      await addItem(
        'ad_account_assignments',
        {
          id: crypto.randomUUID(),
          adAccountId,
          csId,
          subChannelId: subChannelId || null,
          startDate: normalizedStartDate,
          endDate: null,
          status: 'active',
          notes: notes?.trim() || null,
        } satisfies AdAccountAssignment,
        setAdAccountAssignments,
        mapAdAccountAssignmentToDB,
        mapAdAccountAssignmentFromDB,
      );
    } catch (error) {
      console.error('Error assigning ad account CS:', error);
      throw error;
    }
  };

  // -- SOURCES
  const addSource = (item: AdSource) => addItem('ad_sources', item, setSources, mapAdSourceToDB, mapAdSourceFromDB);
  const updateSource = (item: AdSource) => updateItem('ad_sources', item, setSources, mapAdSourceToDB, mapAdSourceFromDB);
  const deleteSource = (id: string) => deleteItem('ad_sources', id, setSources);

  // -- PAYMENTS
  const addPayment = (item: PaymentMethod) => addItem('payment_methods', item, setPayments, mapPaymentToDB, mapPaymentFromDB);
  const updatePayment = (item: PaymentMethod) => updateItem('payment_methods', item, setPayments, mapPaymentToDB, mapPaymentFromDB);
  const deletePayment = (id: string) => deleteItem('payment_methods', id, setPayments);

  // -- ROLES
  const addRole = (item: RoleItem) => addItem('roles', item, setRoles, mapRoleToDB, mapRoleFromDB);
  const updateRole = (item: RoleItem) => updateItem('roles', item, setRoles, mapRoleToDB, mapRoleFromDB);
  const deleteRole = (id: string) => deleteItem('roles', id, setRoles);

  // -- AFFILIATES
  const addAffiliate = (item: Affiliate) => addItem('affiliates', item, setAffiliates, mapAffiliateToDB, mapAffiliateFromDB);
  const updateAffiliate = (item: Affiliate) => updateItem('affiliates', item, setAffiliates, mapAffiliateToDB, mapAffiliateFromDB);
  const deleteAffiliate = (id: string) => deleteItem('affiliates', id, setAffiliates);

  // -- VENDORS
  const addVendor = (item: Vendor) => addItem('vendors', item, setVendors, mapVendorToDB, mapVendorFromDB);
  const updateVendor = (item: Vendor) => updateItem('vendors', item, setVendors, mapVendorToDB, mapVendorFromDB);
  const deleteVendor = (id: string) => deleteItem('vendors', id, setVendors);

  // -- CANCEL REASONS
  const addCancelReason = (item: CancelReason) => addItem('cancel_reasons', item, setCancelReasons, mapCancelReasonToDB, mapCancelReasonFromDB);
  const updateCancelReason = (item: CancelReason) => updateItem('cancel_reasons', item, setCancelReasons, mapCancelReasonToDB, mapCancelReasonFromDB);
  const deleteCancelReason = (id: string) => deleteItem('cancel_reasons', id, setCancelReasons);

  // -- NOTIFICATIONS
  const sendNotification = async (notification: Omit<Notification, 'id' | 'createdAt' | 'isRead'>) => {
    try {
      const payload = {
        id: crypto.randomUUID(), // Local ID
        userId: notification.userId,
        title: notification.title,
        message: notification.message,
        type: notification.type,
        relatedId: notification.relatedId,
        isRead: false,
        createdAt: new Date().toISOString()
      };
      
      // Update Local State directly since we don't have a table
      setNotifications(prev => [payload, ...prev]);

      /* 
      // Table insert disabled
      const { data, error } = await supabase.from('notifications').insert(payload).select().single();
      if (error) {
          console.warn("Notification insert failed (Table might be missing):", error.message);
      } 
      */
    } catch (e) {
        console.error("Send notification error:", e);
    }
  };

  const markNotificationAsRead = async (id: string) => {
      // Optimistic
      setNotifications(prev => prev.map(n => n.id === id ? { ...n, isRead: true } : n));
  };
  
  const triggerRefresh = React.useCallback(() => {
      orderLoadGenerationRef.current += 1;
      fetchedOrderDateRangesRef.current.clear();
      fetchedLeadDateRangesRef.current.clear();
      fetchedProspectBookingDateRangesRef.current.clear();
      fetchedTechnicianScheduleDateRangesRef.current.clear();
      fetchedAdPerformanceDateRangesRef.current.clear();
      fetchingOrderDateRangesRef.current.clear();
      fetchingLeadDateRangesRef.current.clear();
      fetchingProspectBookingDateRangesRef.current.clear();
      fetchingTechnicianScheduleDateRangesRef.current.clear();
      fetchingAdPerformanceDateRangesRef.current.clear();
      setRefreshTrigger(prev => prev + 1);
      toast.info("Memperbarui data...");
  }, []);

  // -- TECHNICIAN SCHEDULES
  const addSchedule = async (schedule: TechnicianSchedule) => {
    try {
        const response = await fetch(buildMakeServerUrl('/technician-schedules'), {
          method: 'POST',
          headers: await getSessionBackedEdgeHeaders({ includeJsonContentType: true }),
          body: JSON.stringify(schedule),
        });
        const result = await response.json().catch(() => ({}));

        if (!response.ok) {
          throw new Error(result.error || result.message || `HTTP ${response.status} ${response.statusText}`);
        }
        
        if (result.data) {
          const newSchedule = mapScheduleFromDB(result.data);
          setTechnicianSchedules(prev => [...prev.filter(item => item.id !== newSchedule.id), newSchedule]);
          toast.success("Jadwal libur berhasil disimpan");
        }
    } catch (e: any) {
        console.error("Error adding schedule:", e);
        toast.error("Gagal menyimpan jadwal: " + e.message);
    }
  };

  const deleteSchedule = async (userId: string, date: string) => {
    try {
        const response = await fetch(
          buildMakeServerUrl(`/technician-schedules/${encodeURIComponent(userId)}/${encodeURIComponent(date)}`),
          {
            method: 'DELETE',
            headers: await getSessionBackedEdgeHeaders(),
          },
        );
        const result = await response.json().catch(() => ({}));

        if (!response.ok) {
          throw new Error(result.error || result.message || `HTTP ${response.status} ${response.statusText}`);
        }
        
        setTechnicianSchedules(prev => prev.filter(s => !(s.userId === userId && s.date === date)));
        toast.success("Jadwal libur dihapus");
    } catch (e: any) {
        console.error("Error deleting schedule:", e);
        toast.error("Gagal menghapus jadwal");
    }
  };

  // -- LEADS (Direct Supabase Table)
  const assertNoBlockingLeadDuplicate = (item: Lead, ignoreId?: string | null) => {
    const duplicateResult = findLeadDuplicates(item, leads, { ignoreId: ignoreId || item.id });
    if (!duplicateResult.blockingMatch) return;

    throw new Error(
      formatLeadDuplicateWarning(
        duplicateResult,
        (csId) => users.find((user) => user.id === csId)?.name,
      ) || 'Nomor dan nama yang sama sudah ada. Simpan diblok agar data prospek tidak double.',
    );
  };

  const addLead = async (item: Lead, options?: MutationOptions) => {
    try {
      assertNoBlockingLeadDuplicate(item);
      let savedLead: Lead | undefined;

      try {
        const payload = mapLeadToDB(item);
        const data = await createAppDataRow('leads', payload);
        savedLead = data ? mapLeadFromDB(data, leadSocialContactsRef.current[data.id]) : item;
      } catch (error) {
        if (!isLeadSocialSchemaError(error)) {
          throw error;
        }

        const fallbackLead = stripLeadSocialFields(item);
        const payload = mapLeadToDB(fallbackLead);
        const data = await createAppDataRow('leads', payload);
        savedLead = mergeLeadSocialFields(
          data ? mapLeadFromDB(data, leadSocialContactsRef.current[data.id]) : fallbackLead,
          pickLeadSocialFields(item),
        );
      }

      if (savedLead) {
        setLeads(prev => {
          if (prev.some(lead => lead.id === savedLead!.id)) return prev;
          return [savedLead!, ...prev];
        });
      }

      if (hasLeadSocialData(item)) {
        try {
          await upsertLeadSocialContact(savedLead || item);
        } catch (socialError: any) {
          console.error('Error saving lead social contact:', socialError);
          toast.error(`Kontak sosial belum tersimpan: ${socialError.message}`);
        }
      }

      if (!options?.silent) {
        toast.success("Data berhasil disimpan");
      }
      return savedLead;
    } catch (e: any) {
      console.error(`Error adding to leads:`, e);
      if (!options?.silent) {
        toast.error(`Gagal menyimpan data: ${e.message}`);
      }
      throw e;
    }
  };

  const updateLead = async (item: Lead) => {
    try {
      assertNoBlockingLeadDuplicate(item, item.id);
      let savedLead: Lead;

      try {
        const payload = mapLeadToDB(item);
        const data = await updateAppDataRow('leads', item.id, payload);
        savedLead = data ? mapLeadFromDB(data, leadSocialContactsRef.current[data.id]) : item;
      } catch (error) {
        if (!isLeadSocialSchemaError(error)) {
          throw error;
        }

        const fallbackLead = stripLeadSocialFields(item);
        const payload = mapLeadToDB(fallbackLead);
        const data = await updateAppDataRow('leads', item.id, payload);
        savedLead = mergeLeadSocialFields(
          data ? mapLeadFromDB(data, leadSocialContactsRef.current[data.id]) : fallbackLead,
          pickLeadSocialFields(item),
        );
      }

      setLeads(prev => prev.map(lead => lead.id === item.id ? savedLead : lead));

      if (hasLeadSocialData(item)) {
        try {
          await upsertLeadSocialContact(savedLead);
        } catch (socialError: any) {
          console.error('Error updating lead social contact:', socialError);
          toast.error(`Kontak sosial belum tersimpan: ${socialError.message}`);
        }
      } else {
        await deleteLeadSocialContact(item.id);
      }

      toast.success("Data berhasil diperbarui");
    } catch (e: any) {
      console.error(`Error updating leads:`, e);
      toast.error(`Gagal memperbarui data: ${e.message}`);
      throw e;
    }
  };

  const deleteLead = async (id: string, options?: MutationOptions) => {
    try {
      await deleteAppDataRow('leads', id);
      setLeads(prev => prev.filter(lead => lead.id !== id));
      await deleteLeadSocialContact(id);
      if (!options?.silent) {
        toast.success("Data berhasil dihapus");
      }
    } catch (e: any) {
      console.error(`Error deleting from leads:`, e);
      if (!options?.silent) {
        toast.error(`Gagal menghapus data: ${e.message}`);
      }
      throw e;
    }
  };

  // -- PROSPECT LABELS
  const addProspectLabel = (item: ProspectLabel) =>
    addItem('prospect_labels', item, setProspectLabels, mapProspectLabelToDB, mapProspectLabelFromDB);
  const updateProspectLabel = (item: ProspectLabel) =>
    updateItem('prospect_labels', item, setProspectLabels, mapProspectLabelToDB, mapProspectLabelFromDB);
  const deleteProspectLabel = (id: string) =>
    deleteItem('prospect_labels', id, setProspectLabels);

  const validateProspectBookingTechnicianAvailabilityBeforeSave = (
    item: ProspectBooking,
    previousBooking?: ProspectBooking,
  ) => {
    if (!shouldValidateProspectBookingTechnicianAvailabilityOnSave(previousBooking, item)) {
      return;
    }

    const technicianSchedule = getTechnicianDaySchedule(
      item.technicianId,
      item.scheduleDate,
      technicianSchedules,
    );

    if (!technicianSchedule) {
      return;
    }

    throw new Error(
      formatTechnicianUnavailableMessage(
        {
          branchId: item.branchId,
          technicianId: item.technicianId,
          serviceDate: item.scheduleDate,
          serviceTime: item.scheduleTime,
        },
        technicianSchedule,
        users,
      ),
    );
  };

  const validateProspectBookingScheduleBeforeSave = (
    item: ProspectBooking,
    previousBooking?: ProspectBooking,
  ) => {
    if (!item.orderId && !isInactiveProspectBookingScheduleStatus(item.status) && !item.technicianId) {
      throw new Error('Teknisi wajib dipilih untuk booking prospek aktif.');
    }

    validateProspectBookingTechnicianAvailabilityBeforeSave(item, previousBooking);

    if (!shouldValidateProspectBookingScheduleOnSave(previousBooking, item)) {
      return;
    }

    const { activeOrderConflicts, activeBookingConflicts } =
      getProspectBookingScheduleConflicts(item, getScheduleBlockingProspectBookings(), orders);
    const activeConflicts = [...activeOrderConflicts, ...activeBookingConflicts];
    if (activeConflicts.length === 0) {
      return;
    }

    throw new Error(
      formatProspectBookingScheduleConflictMessage(item, activeConflicts, users),
    );
  };

  const validateProspectBookingScheduleFreshBeforeSave = async (
    item: ProspectBooking,
    previousBooking?: ProspectBooking,
  ) => {
    if (!shouldValidateProspectBookingScheduleOnSave(previousBooking, item)) {
      return;
    }

    const conflictMessage = await validateProspectBookingScheduleFromDB(item, users, {
      ignoredBookingLeadIds: getIgnoredBookingLeadIds(),
    });
    if (conflictMessage) {
      throw new Error(conflictMessage);
    }
  };

  const addProspectBooking = async (item: ProspectBooking, options?: MutationOptions) => {
    validateProspectBookingScheduleBeforeSave(item);
    await validateProspectBookingScheduleFreshBeforeSave(item);
    return addItem('prospect_bookings', item, setProspectBookings, mapProspectBookingToDB, mapProspectBookingFromDB, options);
  };
  const updateProspectBooking = async (item: ProspectBooking) => {
    const previousBooking = prospectBookings.find((booking) => booking.id === item.id);
    validateProspectBookingScheduleBeforeSave(item, previousBooking);
    await validateProspectBookingScheduleFreshBeforeSave(item, previousBooking);
    return updateItem('prospect_bookings', item, setProspectBookings, mapProspectBookingToDB, mapProspectBookingFromDB);
  };
  const deleteProspectBooking = (id: string) => deleteItem('prospect_bookings', id, setProspectBookings);

  const isNonBlockingScheduleBookingLead = (leadId?: string | null) => {
    if (!leadId) return false;
    const lead = leads.find((item) => item.id === leadId);
    if (!lead) return true;
    return lead?.status === 'Cancel' || lead?.status === 'Closing';
  };

  const getScheduleBlockingProspectBookings = () =>
    prospectBookings.filter((booking) =>
      !booking.orderId &&
      !isInactiveProspectBookingScheduleStatus(booking.status) &&
      !isNonBlockingScheduleBookingLead(booking.leadId)
    );

  const getIgnoredBookingLeadIds = () =>
    new Set(
      leads
        .filter((lead) => lead.status === 'Cancel' || lead.status === 'Closing')
        .map((lead) => lead.id),
    );

  // -- ORDERS (Direct Supabase Table)
  const normalizeScheduleValue = (value?: string | null) => value?.trim() || '';

  const orderMatchesBookingSchedule = (order: Order, booking: ProspectBooking) => (
    normalizeScheduleValue(order.leadId) === normalizeScheduleValue(booking.leadId) &&
    normalizeScheduleValue(order.technicianId) === normalizeScheduleValue(booking.technicianId) &&
    normalizeScheduleValue(order.serviceDate) === normalizeScheduleValue(booking.scheduleDate) &&
    normalizeOrderTime(order.serviceTime) === normalizeOrderTime(booking.scheduleTime)
  );

  const getOrderLifecycleBookings = (order: Order) =>
    prospectBookings.filter((booking) => {
      if (booking.orderId === order.id) return true;
      if (booking.orderId) return false;
      if (!order.leadId || booking.leadId !== order.leadId) return false;
      return orderMatchesBookingSchedule(order, booking);
    });

  const updateProspectBookingLifecycleSilently = async (
    booking: ProspectBooking,
    patch: Partial<Pick<ProspectBooking, 'orderId' | 'status'>>,
  ) => {
    const updatedAt = new Date().toISOString();
    const updatePayload: Record<string, string | null> = {
      updated_at: updatedAt,
    };

    if (patch.orderId !== undefined) {
      updatePayload.order_id = patch.orderId || null;
    }

    if (patch.status) {
      updatePayload.status = patch.status;
    }

    const data = await updateAppDataRow('prospect_bookings', booking.id, updatePayload);

    const updatedBooking = data
      ? mapProspectBookingFromDB(data)
      : { ...booking, ...patch, updatedAt };

    setProspectBookings((prev) =>
      prev.map((item) => item.id === updatedBooking.id ? updatedBooking : item),
    );

    return updatedBooking;
  };

  const updateLeadStatusSilently = async (lead: Lead, status: Lead['status']) => {
    if (lead.status === status) return;

    const data = await updateAppDataRow('leads', lead.id, { status });

    const updatedLead = data
      ? mapLeadFromDB(data, leadSocialContactsRef.current[data.id])
      : { ...lead, status };

    setLeads((prev) =>
      prev.map((item) => item.id === updatedLead.id ? updatedLead : item),
    );
  };

  const syncOrderProspectLifecycle = async (order: Order) => {
    if (!order.leadId) return;

    const relatedLead = leads.find((lead) => lead.id === order.leadId);
    const hasOtherActiveOrderForLead = orders.some((item) =>
      item.id !== order.id &&
      item.leadId === order.leadId &&
      !isInactiveOrderScheduleStatus(item.status)
    );

    if (isInactiveOrderScheduleStatus(order.status)) {
      const nextBookingStatus = order.status === 'cancelled' ? 'cancelled' : 'reschedule';
      const relatedBookings = getOrderLifecycleBookings(order);

      await Promise.all(
        relatedBookings.map((booking) => (
          booking.status === nextBookingStatus
            ? Promise.resolve()
            : updateProspectBookingLifecycleSilently(booking, { status: nextBookingStatus })
        )),
      );

      if (relatedLead && !hasOtherActiveOrderForLead) {
        await updateLeadStatusSilently(
          relatedLead,
          order.status === 'cancelled' ? 'Cancel' : 'Follow Up',
        );
      }
      return;
    }

    const relatedBookings = getOrderLifecycleBookings(order).filter((booking) =>
      !isInactiveProspectBookingScheduleStatus(booking.status) || booking.orderId === order.id
    );

    await Promise.all(
      relatedBookings.map((booking) => (
        booking.orderId === order.id && booking.status === 'confirmed'
          ? Promise.resolve()
          : updateProspectBookingLifecycleSilently(booking, {
              orderId: order.id,
              status: 'confirmed',
            })
      )),
    );

    if (relatedLead) {
      await updateLeadStatusSilently(relatedLead, 'Closing');
    }
  };

  const validateTechnicianAvailabilityBeforeSave = (item: Order, previousOrder?: Order) => {
    if (!shouldValidateTechnicianAvailabilityOnSave(previousOrder, item)) {
      return;
    }

    const technicianSchedule = getTechnicianDaySchedule(
      item.technicianId,
      item.serviceDate,
      technicianSchedules,
    );

    if (!technicianSchedule) {
      return;
    }

    throw new Error(
      formatTechnicianUnavailableMessage(item, technicianSchedule, users),
    );
  };

  const validateOrderScheduleBeforeSave = (item: Order, previousOrder?: Order) => {
    validateTechnicianAvailabilityBeforeSave(item, previousOrder);

    if (!shouldValidateOrderScheduleOnSave(previousOrder, item)) {
      return;
    }

    const { activeConflicts } = getOrderScheduleConflicts(item, orders);
    if (activeConflicts.length > 0) {
      throw new Error(
        formatOrderScheduleConflictMessage(item, activeConflicts, users),
      );
    }

    const activeBookingConflicts = getOrderProspectBookingScheduleConflicts(
      item,
      getScheduleBlockingProspectBookings(),
    );
    if (activeBookingConflicts.length > 0) {
      throw new Error(
        formatOrderBookingScheduleConflictMessage(item, activeBookingConflicts, users),
      );
    }
  };

  const validateOrderScheduleFreshBeforeSave = async (item: Order, previousOrder?: Order) => {
    if (!shouldValidateOrderScheduleOnSave(previousOrder, item)) {
      return;
    }

    const conflictMessage = await validateOrderScheduleFromDB(item, users, {
      ignoredBookingLeadIds: getIgnoredBookingLeadIds(),
    });
    if (conflictMessage) {
      throw new Error(conflictMessage);
    }
  };

  const syncOrderCrmContactSnapshot = (order: Order, savedFrom: string) => {
    if (!order.customerName && !order.customerPhone) return;

    void saveOrderToCrmContact(order, {
      savedBy: currentUser?.id,
      savedFrom,
    })
      .then((result) => {
        if (!result.available) {
          console.warn('CRM contacts table is not available for order contact snapshot.');
        }
      })
      .catch((error) => {
        console.warn('Failed to sync order customer to CRM contact:', error);
      });
  };

  const queueOrderProspectLifecycleSync = (order: Order, source: string) => {
    if (!order.leadId) return;

    const maxAttempts = 2;
    const run = async (attempt: number) => {
      try {
        await syncOrderProspectLifecycle(order);
      } catch (error) {
        const shouldRetry = attempt < maxAttempts;
        console.warn('Order prospect lifecycle sync failed', {
          orderId: order.id,
          source,
          attempt,
          retrying: shouldRetry,
          error,
        });

        if (shouldRetry) {
          const delayMs = isRequestTimeoutError(error) ? 3_000 : 1_500;
          globalThis.setTimeout(() => {
            void run(attempt + 1);
          }, delayMs);
        }
      }
    };

    void run(1);
  };

  const addOrder = async (item: Order, options?: MutationOptions) => {
    const normalizedItem = await normalizeOrderLocationForSave(item);
    validateOrderScheduleBeforeSave(normalizedItem);
    if (!options?.skipFreshScheduleValidation) {
      await validateOrderScheduleFreshBeforeSave(normalizedItem);
    }
    const savedOrder = await addItem('orders', normalizedItem, setOrders, mapOrderToDB, mapOrderFromDB, options);
    const orderForSync = (savedOrder || normalizedItem) as Order;
    syncOrderCrmContactSnapshot(orderForSync, 'pesanan_otomatis');
    queueOrderProspectLifecycleSync(orderForSync, 'order_create');
    return savedOrder;
  };

  const updateOrder = async (item: Order, options?: MutationOptions) => {
    const previousOrder = orders.find((order) => order.id === item.id);
    const normalizedItem = await normalizeOrderLocationForSave(item, previousOrder);
    validateOrderScheduleBeforeSave(normalizedItem, previousOrder);
    if (!options?.skipFreshScheduleValidation) {
      await validateOrderScheduleFreshBeforeSave(normalizedItem, previousOrder);
    }
    const savedOrder = await updateItem('orders', normalizedItem, setOrders, mapOrderToDB, mapOrderFromDB, options);
    const orderForSync = (savedOrder || normalizedItem) as Order;
    if (shouldSyncOrderCrmForOrder(previousOrder, orderForSync)) {
      syncOrderCrmContactSnapshot(orderForSync, 'pesanan_update_otomatis');
    }
    if (shouldSyncOrderLifecycleForOrder(previousOrder, orderForSync)) {
      queueOrderProspectLifecycleSync(orderForSync, 'order_update');
    }
    return savedOrder;
  };

  const updateOrderPatch = async (id: string, patch: Partial<Order>, options?: MutationOptions) => {
    const previousOrder = orders.find((order) => order.id === id);
    if (!previousOrder) {
      const error = new Error('Pesanan tidak ditemukan di data lokal. Refresh data lalu coba lagi.');
      if (!options?.silent) {
        toast.error(error.message);
      }
      throw error;
    }

    let normalizedPatch = patch;
    if (Object.prototype.hasOwnProperty.call(patch, 'mapsUrl')) {
      const normalizedOrder = await normalizeOrderLocationForSave({ ...previousOrder, ...patch, id });
      normalizedPatch = {
        ...patch,
        mapsUrl: normalizedOrder.mapsUrl,
        lat: normalizedOrder.lat,
        lng: normalizedOrder.lng,
      };
    }

    const payload = mapOrderPatchToDB(normalizedPatch);
    const payloadKeys = Object.keys(payload);
    if (payloadKeys.length === 0) {
      return previousOrder;
    }

    const nextOrder = { ...previousOrder, ...normalizedPatch, id };

    try {
      validateOrderScheduleBeforeSave(nextOrder, previousOrder);
      if (!options?.skipFreshScheduleValidation) {
        await validateOrderScheduleFreshBeforeSave(nextOrder, previousOrder);
      }

      const data = await updateAppDataRow('orders', id, payload);
      const savedOrder = data ? mapOrderFromDB(data) : nextOrder;

      setOrders((prev) =>
        prev.map((order) => order.id === id ? { ...order, ...savedOrder } : order),
      );

      if (!options?.silent) {
        toast.success('Data berhasil diperbarui');
      }

      if (shouldSyncOrderCrmForPatch(previousOrder, normalizedPatch)) {
        syncOrderCrmContactSnapshot(savedOrder, 'pesanan_update_otomatis');
      }

      if (shouldSyncOrderLifecycleForPatch(previousOrder, normalizedPatch)) {
        queueOrderProspectLifecycleSync(savedOrder, 'order_patch');
      }

      return savedOrder;
    } catch (e: any) {
      console.error('Error patching order:', e);
      if (!options?.silent) {
        toast.error(`Gagal memperbarui data: ${e.message}`);
      }
      throw e;
    }
  };
  const deleteOrder = (id: string) => deleteItem('orders', id, setOrders, { silent: true, throwOnError: true });

  // -- WA TEMPLATES (Direct Supabase Table)
  const addWATemplate = (item: WATemplate) => addItem('wa_templates', item, setWaTemplates, mapWATemplateToDB, mapWATemplateFromDB);
  const updateWATemplate = (item: WATemplate) => updateItem('wa_templates', item, setWaTemplates, mapWATemplateToDB, mapWATemplateFromDB);
  const deleteWATemplate = (id: string) => deleteItem('wa_templates', id, setWaTemplates);

  // -- DAILY ADS (Direct Supabase Table)
  const addDailyAd = (item: DailyAd) => addItem('daily_ads', item, setDailyAds, mapDailyAdToDB, mapDailyAdFromDB);
  const updateDailyAd = (item: DailyAd) => updateItem('daily_ads', item, setDailyAds, mapDailyAdToDB, mapDailyAdFromDB);
  const deleteDailyAd = (id: string) => deleteItem('daily_ads', id, setDailyAds);

  // -- LEAD SPAM DAILY INPUTS (Supabase table with server fallback while migration is pending)
  const addLeadSpamDailyInput = async (item: LeadSpamDailyInput, options?: MutationOptions) => {
    if (leadSpamDailyInputsUseFallbackRef.current) {
      try {
        const fallbackItem = await upsertLeadSpamDailyInputFallback(item);
        setLeadSpamDailyInputs(prev => {
          if (prev.some(i => i.id === fallbackItem.id)) {
            return prev.map(i => i.id === fallbackItem.id ? { ...i, ...fallbackItem } : i);
          }
          return [fallbackItem, ...prev];
        });
        if (!options?.silent) {
          toast.success("Data berhasil disimpan");
        }
        return fallbackItem;
      } catch (e: any) {
        console.error('Error adding lead spam fallback:', e);
        if (!options?.silent) {
          toast.error(`Gagal menyimpan data: ${e.message}`);
        }
        throw e;
      }
    }

    return addItem(
      'lead_spam_daily_inputs',
      item,
      setLeadSpamDailyInputs,
      mapLeadSpamDailyInputToDB,
      mapLeadSpamDailyInputFromDB,
      options,
    );
  };

  const updateLeadSpamDailyInput = async (item: LeadSpamDailyInput) => {
    if (leadSpamDailyInputsUseFallbackRef.current) {
      try {
        const fallbackItem = await upsertLeadSpamDailyInputFallback(item);
        setLeadSpamDailyInputs(prev => {
          if (prev.some(i => i.id === fallbackItem.id)) {
            return prev.map(i => i.id === fallbackItem.id ? { ...i, ...fallbackItem } : i);
          }
          return [fallbackItem, ...prev];
        });
        toast.success("Data berhasil diperbarui");
        return;
      } catch (e: any) {
        console.error('Error updating lead spam fallback:', e);
        toast.error(`Gagal memperbarui data: ${e.message}`);
        throw e;
      }
    }

    return updateItem(
      'lead_spam_daily_inputs',
      item,
      setLeadSpamDailyInputs,
      mapLeadSpamDailyInputToDB,
      mapLeadSpamDailyInputFromDB,
    );
  };

  const deleteLeadSpamDailyInput = async (id: string, options?: MutationOptions) => {
    if (leadSpamDailyInputsUseFallbackRef.current) {
      try {
        await deleteLeadSpamDailyInputFallback(id);
        setLeadSpamDailyInputs(prev => prev.filter(i => i.id !== id));
        if (!options?.silent) {
          toast.success("Data berhasil dihapus");
        }
        return;
      } catch (e: any) {
        console.error('Error deleting lead spam fallback:', e);
        if (!options?.silent) {
          toast.error(`Gagal menghapus data: ${e.message}`);
        }
        throw e;
      }
    }

    return deleteItem('lead_spam_daily_inputs', id, setLeadSpamDailyInputs, options);
  };

  const normalizedActivePath = React.useMemo(
    () => (activePath || '/dashboard').toLowerCase(),
    [activePath],
  );
  const isScheduleOperationalPath = normalizedActivePath.startsWith('/schedule');
  const canFetchFullOperationalHistory =
    isAdminManagementRole(currentRole) || isFinanceRole(currentRole);
  const shouldFetchFullOperationalHistory =
    canFetchFullOperationalHistory &&
    (
      normalizedActivePath.startsWith('/reports') ||
      normalizedActivePath.startsWith('/finance')
    );
  const isTechnicianMobileOperationalPath = normalizedActivePath.startsWith('/technician/mobile');
  const isTechnicianDashboardOperationalPath = normalizedActivePath.startsWith('/dashboard');
  const isTechnicianOrdersOperationalPath = normalizedActivePath.startsWith('/orders');
  const shouldUseTechnicianLightBootstrap =
    isTechnicianRole(currentRole) &&
    (isTechnicianMobileOperationalPath || isTechnicianDashboardOperationalPath);
  const shouldSkipGlobalOperationalBootstrapForTechnician =
    isTechnicianRole(currentRole) &&
    (isTechnicianMobileOperationalPath || isTechnicianOrdersOperationalPath || isTechnicianDashboardOperationalPath);
  const shouldUseTechnicianScopedOrdersBootstrap =
    isTechnicianRole(currentRole) &&
    isTechnicianOrdersOperationalPath &&
    Boolean(currentUser?.id);
  const shouldEnsureScheduleUserRoster =
    isScheduleOperationalPath &&
    (isAdminManagementRole(currentRole) || isCsRole(currentRole));
  const shouldWaitForCurrentUserBeforeOperationalBootstrap =
    Boolean(session?.user) && !isCurrentUserResolved;

  const deferredBootstrapTables = React.useMemo(
    () => getDeferredBootstrapTablesForPath(activePath || '/dashboard'),
    [activePath],
  );
  const shouldBootstrapAdPerformanceInputs = React.useMemo(
    () => shouldBootstrapAdPerformanceInputsForPath(activePath || '/dashboard'),
    [activePath],
  );

  const fetchCatalog = React.useMemo(() => createMasterDataFetchCatalog({
    setAreas,
    setBranches,
    setServices,
    setVehicles,
    setPlatforms,
    setSubChannels,
    setAdAccounts,
    setAdAccountAssignments,
    setAdAccountOwnerAssignments,
    setSources,
    setPayments,
    setRoles,
    setAffiliates,
    setVendors,
    setCancelReasons,
    setProspectLabels,
    setLeads,
    setProspectBookings,
    setOrders,
    setWaTemplates,
    setDailyAds,
    setLeadSpamDailyInputs,
    setTechnicianSchedules,
    setAuditLogs,
    mapLeadRow: (lead) => mapLeadFromDB(lead, leadSocialContactsRef.current[lead.id]),
  }), []);

  useReferenceDataBootstrap({
    enabled: !shouldWaitForCurrentUserBeforeOperationalBootstrap,
    scope: JSON.stringify([session?.user?.id, currentRole]),
    refreshVersion: refreshTrigger,
    onLoadingChange: setIsMasterDataLoading,
    createTasks: (signal) => [
      ...fetchCatalog.masters.map(({ table, setter, mapper }) => (
        () => fetchData(table, (value) => {
          if (!signal.aborted) setter(value);
        }, mapper)
      )),
      () => refetchUsersFromProfiles(),
    ],
  });

  // The scheduling roster has its own scope; opening it must not reload all masters.
  useEffect(() => {
    if (shouldEnsureScheduleUserRoster && isCurrentUserResolved) {
      void refetchScheduleUsersFromProfiles();
    }
  }, [shouldEnsureScheduleUserRoster, isCurrentUserResolved, refreshTrigger, currentUser?.id]);

  // Fetch the operational data needed by the current route.
  useEffect(() => {
    let isCancelled = false;
    const controller = new AbortController();
    setIsOperationalDataLoading(true);
    setIsOrdersLoading(true);
    setIsLeadsLoading(true);
    orderLoadGenerationRef.current += 1;
    fetchedOrderDateRangesRef.current.clear();
    fetchedLeadDateRangesRef.current.clear();
    fetchedProspectBookingDateRangesRef.current.clear();
    fetchedTechnicianScheduleDateRangesRef.current.clear();
    fetchedAdPerformanceDateRangesRef.current.clear();
    fetchingOrderDateRangesRef.current.clear();
    fetchingLeadDateRangesRef.current.clear();
    fetchingProspectBookingDateRangesRef.current.clear();
    fetchingTechnicianScheduleDateRangesRef.current.clear();
    fetchingAdPerformanceDateRangesRef.current.clear();

    const deferredTimers: number[] = [];
    const idleRequestIds: number[] = [];
    const idleApi = window as unknown as {
      requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
      cancelIdleCallback?: (id: number) => void;
    };

    const scheduleIdleTask = (task: () => void, timeout = 2_500) => {
      if (idleApi.requestIdleCallback) {
        const idleRequestId = idleApi.requestIdleCallback(() => {
          if (!isCancelled) task();
        }, { timeout });
        idleRequestIds.push(idleRequestId);
        return;
      }

      const timerId = window.setTimeout(() => {
        if (!isCancelled) task();
      }, 250);
      deferredTimers.push(timerId);
    };

    const scheduleDeferredTask = (name: string, delayMs: number, task: () => void, idleTimeoutMs = 4_000) => {
      const timerId = window.setTimeout(() => {
        if (isCancelled) return;
        recordPerfMetric(name, 0, 'scheduled', {
          delayMs,
          idleTimeoutMs,
          role: currentRole,
        });
        scheduleIdleTask(task, idleTimeoutMs);
      }, delayMs);
      deferredTimers.push(timerId);
    };

    const cleanup = () => {
      isCancelled = true;
      controller.abort();
      if (idleApi.cancelIdleCallback) {
        idleRequestIds.forEach((idleRequestId) => {
          idleApi.cancelIdleCallback?.(idleRequestId);
        });
      }
      deferredTimers.forEach((timerId) => window.clearTimeout(timerId));
    };

    if (shouldWaitForCurrentUserBeforeOperationalBootstrap) {
      setIsOrdersLoading(false);
      setIsLeadsLoading(false);
      setIsOperationalDataLoading(false);
      recordPerfMetric('master-data.operational-bootstrap', 0, 'deferred', {
        reason: 'current_user_pending',
        path: normalizedActivePath,
      });
      return cleanup;
    }

    const orderFetch = fetchCatalog.transactional.find(({ table }) => table === 'orders');
    if (orderFetch) {
      const fetchPriorityOrders = async () => {
        const todayKey = getTodayDateKey();

        if (shouldUseTechnicianLightBootstrap) {
          orderFetch.setter([]);
          recordPerfMetric('master-data.today-orders-bootstrap', 0, 'skipped', {
            reason: 'technician_mobile_uses_scoped_endpoint',
            role: currentRole,
            path: normalizedActivePath,
          });
          return;
        }

        const technicianId = shouldUseTechnicianScopedOrdersBootstrap ? currentUser?.id : undefined;
        const priorityOrders = await fetchTodayOrdersDirectly(todayKey, orderFetch.mapper, technicianId);
        if (isCancelled) return;
        orderFetch.setter(priorityOrders);
        // Publish completeness before releasing the page's range loader.
        fetchedOrderDateRangesRef.current.add(`service:${todayKey}:${todayKey}:${technicianId || 'all'}`);

        if (!isCancelled) {
          setIsOrdersLoading(false);
        }

        if (!shouldFetchFullOperationalHistory) {
          recordPerfMetric('master-data.full-orders-bootstrap', 0, 'skipped', {
            reason: 'role_scoped',
            role: currentRole,
          });
          return;
        }

        scheduleDeferredTask('master-data.full-orders-bootstrap', 6_000, () => {
          void fetchData(orderFetch.table, orderFetch.setter, orderFetch.mapper, {
            progressive: true,
            mergeProgressiveWithPrevious: true,
            appData: {
              orderBy: 'service_date',
              ascending: false,
            },
          });
        }, 5_000);
      };

      fetchPriorityOrders().catch((error) => {
        console.error("Error loading priority orders:", error);
      }).finally(() => {
        if (!isCancelled) {
          setIsOrdersLoading(false);
        }
      });
    } else {
      setIsOrdersLoading(false);
    }

    const leadFetch = fetchCatalog.transactional.find(({ table }) => table === 'leads');
    if (leadFetch) {
      const fetchPriorityLeads = async () => {
        const todayKey = getTodayDateKey();

        if (shouldSkipGlobalOperationalBootstrapForTechnician) {
          leadFetch.setter([]);
          recordPerfMetric('master-data.today-leads-bootstrap', 0, 'skipped', {
            reason: 'technician_does_not_use_global_leads_here',
            role: currentRole,
            path: normalizedActivePath,
          });
          return;
        }

        try {
          leadFetch.setter(await fetchTodayLeadsDirectly(todayKey, leadFetch.mapper));
        } catch (directError) {
          if (import.meta.env.DEV) {
            console.warn('[MasterData] direct today leads fetch failed, falling back to app-data', directError);
          }
          const { fromIso, toIso } = toBusinessDayUtcRange(todayKey);
          await fetchData(leadFetch.table, leadFetch.setter, leadFetch.mapper, {
            progressive: true,
            pageSize: 250,
            appData: {
              orderBy: 'created_at',
              ascending: false,
              gte: { created_at: fromIso },
              lte: { created_at: toIso },
            },
          });
        }

        if (!isCancelled) {
          setIsLeadsLoading(false);
        }

        if (!shouldFetchFullOperationalHistory) {
          recordPerfMetric('master-data.full-leads-bootstrap', 0, 'skipped', {
            reason: 'role_scoped',
            role: currentRole,
          });
          return;
        }

        scheduleDeferredTask('master-data.full-leads-bootstrap', 7_000, () => {
          void fetchData(leadFetch.table, leadFetch.setter, leadFetch.mapper, {
            progressive: true,
            mergeProgressiveWithPrevious: true,
            appData: {
              orderBy: 'created_at',
              ascending: false,
            },
          });
        }, 5_000);
      };

      fetchPriorityLeads().finally(() => {
        if (!isCancelled) {
          setIsLeadsLoading(false);
        }
      });
    } else {
      setIsLeadsLoading(false);
    }

    const runDeferredOperationalFetches = () => {
      if (isCancelled) return;

      if (import.meta.env.DEV) {
        console.info('[MasterData] starting deferred operational fetches');
      }

      setIsOperationalDataLoading(true);

      const otherTransactionalFetches = fetchCatalog.transactional.filter(({ table }) =>
        table !== 'orders' &&
        table !== 'leads' &&
        deferredBootstrapTables.has(table)
      );
      const operationalFetchTasks = otherTransactionalFetches.map(({ table, setter, mapper }) => (
        () => fetchData(table, setter, mapper)
      ));
      if (shouldBootstrapAdPerformanceInputs) {
        operationalFetchTasks.push(() => ensureAdPerformanceInputsForDateRange(getCurrentMonthDateRange()));
      }
      if (deferredBootstrapTables.has('lead_social_contacts')) {
        operationalFetchTasks.push(() => fetchLeadSocialContacts());
      }

      if (operationalFetchTasks.length === 0 && !deferredBootstrapTables.has('audit_logs') && !deferredBootstrapTables.has('technician_schedules')) {
        setIsOperationalDataLoading(false);
        return;
      }

      runSettledWithConcurrency(operationalFetchTasks, OPERATIONAL_BOOTSTRAP_CONCURRENCY, controller.signal).finally(() => {
        if (!isCancelled) {
          setIsOperationalDataLoading(false);
        }
      });

      scheduleDeferredTask('master-data.support-bootstrap', 1_500, () => {
        const supportFetchTasks = fetchCatalog.support
          .filter(({ table }) => deferredBootstrapTables.has(table))
          .map(({ table, setter, mapper }) => () => fetchData(table, setter, mapper));
        void runSettledWithConcurrency(supportFetchTasks, OPERATIONAL_BOOTSTRAP_CONCURRENCY, controller.signal);
      }, 2_500);
    };

    scheduleIdleTask(runDeferredOperationalFetches, 1_600);

    return cleanup;

  }, [
    currentRole,
    refreshTrigger,
    shouldFetchFullOperationalHistory,
    deferredBootstrapTables,
    shouldBootstrapAdPerformanceInputs,
    ensureAdPerformanceInputsForDateRange,
    isCurrentUserResolved,
    normalizedActivePath,
    shouldEnsureScheduleUserRoster,
    shouldSkipGlobalOperationalBootstrapForTechnician,
    shouldUseTechnicianLightBootstrap,
    shouldUseTechnicianScopedOrdersBootstrap,
    shouldWaitForCurrentUserBeforeOperationalBootstrap,
    currentUser?.id,
  ]);

  // --- REALTIME SUBSCRIPTIONS ---
  useEffect(() => {
    let isRealtimeDisposed = false;
    let recoveryResubscribeTimer: number | undefined;
    let recoveryRetryDelayMs = 8_000;
    const reducedRealtimeForTechnician =
      isTechnicianRole(currentRole) &&
      (isTechnicianMobileOperationalPath || isTechnicianOrdersOperationalPath || isTechnicianDashboardOperationalPath);

    const scheduleRealtimeRecovery = (status: string) => {
      if (isRealtimeDisposed) return;

      console.warn(`[MasterData] realtime channel ${status}; scheduling throttled recovery`);

      if (recoveryResubscribeTimer !== undefined) return;

      const retryDelay = recoveryRetryDelayMs;
      recoveryRetryDelayMs = Math.min(recoveryRetryDelayMs * 2, 60_000);
      recoveryResubscribeTimer = window.setTimeout(() => {
        if (!isRealtimeDisposed) {
          setRealtimeRetryKey((prev) => prev + 1);
        }
      }, retryDelay);
    };

    // Channel for high-frequency updates (Orders, Leads, Profiles)
    let channel = supabase.channel(`realtime_master_data_${realtimeRetryKey}`);

    if (!reducedRealtimeForTechnician) {
      channel = channel.on(
        'postgres_changes', 
        { event: '*', schema: 'public', table: 'orders' }, 
        (payload) => {
          if (payload.eventType === 'INSERT') {
             const newItem = mapOrderFromDB(payload.new);
             setOrders(prev => [newItem, ...prev.filter(item => item.id !== newItem.id)]);
             
             // 1. Play Sound (Ding!)
             try {
                 const audio = new Audio('https://assets.mixkit.co/active_storage/sfx/2869/2869-preview.mp3');
                 audio.volume = 0.6;
                 audio.play().catch(e => console.warn("Audio autoplay blocked by browser:", e));
             } catch (e) {
                 console.error("Audio error:", e);
             }

             // 2. Add to Notification Bell
             const targetUserId = currentUserRef.current?.id;
             if (targetUserId) {
                 sendNotification({
                    userId: targetUserId,
                    title: 'Pesanan Baru Masuk!',
                    message: `${newItem.customerName} - Rp ${parseInt(String(newItem.price || 0)).toLocaleString('id-ID')}`,
                    type: 'success',
                    relatedId: newItem.id
                 });
             }

             toast.info(`Pesanan Baru: ${newItem.customerName}`);
          } else if (payload.eventType === 'UPDATE') {
             const updatedItem = mapOrderFromDB(payload.new);
             setOrders(prev => {
               const exists = prev.some(item => item.id === updatedItem.id);
               return exists
                 ? prev.map(item => item.id === updatedItem.id ? updatedItem : item)
                 : [updatedItem, ...prev];
             });
          } else if (payload.eventType === 'DELETE') {
             setOrders(prev => prev.filter(item => item.id !== payload.old.id));
          }
        }
      );

      channel = channel.on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'leads' },
        (payload) => {
          if (payload.eventType === 'INSERT') {
             const newItem = mapLeadFromDB(payload.new, leadSocialContactsRef.current[payload.new.id]);
             setLeads(prev => [newItem, ...prev]);
          } else if (payload.eventType === 'UPDATE') {
             const updatedItem = mapLeadFromDB(payload.new, leadSocialContactsRef.current[payload.new.id]);
             setLeads(prev => prev.map(item => item.id === updatedItem.id ? updatedItem : item));
          } else if (payload.eventType === 'DELETE') {
             setLeadSocialContacts(prev => {
               const next = { ...prev };
               delete next[payload.old.id];
               return next;
             });
             setLeads(prev => prev.filter(item => item.id !== payload.old.id));
          }
        }
      );

      channel = channel.on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'prospect_bookings' },
        (payload) => {
          if (payload.eventType === 'INSERT') {
            const newItem = mapProspectBookingFromDB(payload.new);
            setProspectBookings(prev => [newItem, ...prev.filter(item => item.id !== newItem.id)]);
          } else if (payload.eventType === 'UPDATE') {
            const updatedItem = mapProspectBookingFromDB(payload.new);
            setProspectBookings(prev => {
              const exists = prev.some(item => item.id === updatedItem.id);
              return exists
                ? prev.map(item => item.id === updatedItem.id ? updatedItem : item)
                : [updatedItem, ...prev];
            });
          } else if (payload.eventType === 'DELETE') {
            setProspectBookings(prev => prev.filter(item => item.id !== payload.old.id));
          }
        }
      );

      channel = channel.on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'lead_spam_daily_inputs' },
        (payload) => {
          if (payload.eventType === 'INSERT') {
            const newItem = mapLeadSpamDailyInputFromDB(payload.new);
            setLeadSpamDailyInputs((prev) => [newItem, ...prev.filter((item) => item.id !== newItem.id)]);
          } else if (payload.eventType === 'UPDATE') {
            const updatedItem = mapLeadSpamDailyInputFromDB(payload.new);
            setLeadSpamDailyInputs((prev) => prev.map((item) => item.id === updatedItem.id ? updatedItem : item));
          } else if (payload.eventType === 'DELETE') {
            setLeadSpamDailyInputs((prev) => prev.filter((item) => item.id !== payload.old.id));
          }
        }
      );

      channel = channel.on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'daily_ads' },
        (payload) => {
          if (payload.eventType === 'INSERT') {
            const newItem = mapDailyAdFromDB(payload.new);
            setDailyAds((prev) => [newItem, ...prev.filter((item) => item.id !== newItem.id)]);
          } else if (payload.eventType === 'UPDATE') {
            const updatedItem = mapDailyAdFromDB(payload.new);
            setDailyAds((prev) => {
              const exists = prev.some((item) => item.id === updatedItem.id);
              return exists
                ? prev.map((item) => item.id === updatedItem.id ? updatedItem : item)
                : [updatedItem, ...prev];
            });
          } else if (payload.eventType === 'DELETE') {
            setDailyAds((prev) => prev.filter((item) => item.id !== payload.old.id));
          }
        }
      );

      channel = channel.on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'daily_ads_sync_runs' },
        (payload) => {
          const status = String(payload.new?.status || '');
          if (status === 'succeeded' || status === 'partial' || status === 'failed') {
            window.dispatchEvent(new Event(ADS_DAILY_SYNC_HISTORY_UPDATED_EVENT));
          }
        },
      );

      channel = channel.on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'technician_schedules' },
        (payload) => {
          if (payload.eventType === 'INSERT') {
            const newItem = mapScheduleFromDB(payload.new);
            setTechnicianSchedules(prev => [...prev.filter(item => item.id !== newItem.id), newItem]);
          } else if (payload.eventType === 'UPDATE') {
            const updatedItem = mapScheduleFromDB(payload.new);
            setTechnicianSchedules(prev => {
              const exists = prev.some(item => item.id === updatedItem.id);
              return exists
                ? prev.map(item => item.id === updatedItem.id ? updatedItem : item)
                : [...prev, updatedItem];
            });
          } else if (payload.eventType === 'DELETE') {
            setTechnicianSchedules(prev => prev.filter(item => item.id !== payload.old.id));
          }
        }
      );
    } else if ((isTechnicianOrdersOperationalPath || isTechnicianDashboardOperationalPath) && currentUser?.id) {
      channel = channel.on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'orders', filter: `technician_id=eq.${currentUser.id}` },
        (payload) => {
          if (payload.eventType === 'INSERT') {
            const newItem = mapOrderFromDB(payload.new);
            setOrders(prev => [newItem, ...prev.filter(item => item.id !== newItem.id)]);
          } else if (payload.eventType === 'UPDATE') {
            const updatedItem = mapOrderFromDB(payload.new);
            setOrders(prev => {
              const exists = prev.some(item => item.id === updatedItem.id);
              return exists
                ? prev.map(item => item.id === updatedItem.id ? updatedItem : item)
                : [updatedItem, ...prev];
            });
          } else if (payload.eventType === 'DELETE') {
            setOrders(prev => prev.filter(item => item.id !== payload.old.id));
          }
        }
      );
    }

    channel = channel.on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'profiles' },
        (payload) => {
           // We only handle UPDATE/INSERT for profiles to keep user list fresh
           // We don't delete users automatically to preserve history/UI consistency until refresh
           if (payload.eventType === 'UPDATE' || payload.eventType === 'INSERT') {
             const p = payload.new;
             const updatedUser = mapProfileToUser(p);
             
             setUsers(prev => {
                if (!updatedUser) {
                  return prev.filter(u => u.id !== p.id);
                }

                const exists = prev.find(u => u.id === updatedUser.id);
                if (exists) return prev.map(u => u.id === updatedUser.id ? updatedUser : u);
                return [updatedUser, ...prev];
             });
           }
        }
      )
      .subscribe((status) => {
         if (status === 'SUBSCRIBED') {
             console.log("Realtime Master Data Connected");
         } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
             scheduleRealtimeRecovery(status);
         }
      });

    return () => {
      isRealtimeDisposed = true;
      if (recoveryResubscribeTimer !== undefined) {
        window.clearTimeout(recoveryResubscribeTimer);
      }
      supabase.removeChannel(channel);
    };
  }, [
    currentRole,
    isTechnicianMobileOperationalPath,
    isTechnicianOrdersOperationalPath,
    isTechnicianDashboardOperationalPath,
    realtimeRetryKey,
    currentUser?.id,
  ]);

  // Use useMemo to prevent unnecessary re-renders
  const value = React.useMemo(() => ({
    areas, branches, activeBranches, services, vehicles, platforms, subChannels, 
    adAccounts, adAccountAssignments, adAccountOwnerAssignments, sources, payments, roles, users,
    leads, prospectLabels, leadSpamDailyInputs, prospectBookings, waTemplates, orders, dailyAds, notifications, affiliates, vendors, cancelReasons,
    technicianSchedules, addSchedule, deleteSchedule,
    auditLogs,

    addUser, createSystemUser, updateUser, updateSystemUser, deleteUser, deleteSystemUser, resetUserPassword,
    addLead, updateLead, deleteLead,
    addProspectLabel, updateProspectLabel, deleteProspectLabel,
    addProspectBooking, updateProspectBooking, deleteProspectBooking,
    addOrder, updateOrder, updateOrderPatch, deleteOrder,
    addWATemplate, updateWATemplate, deleteWATemplate,
    addDailyAd, updateDailyAd, deleteDailyAd,
    addLeadSpamDailyInput, updateLeadSpamDailyInput, deleteLeadSpamDailyInput,
    addArea, updateArea, deleteArea,
    addBranch, updateBranch, deleteBranch,
    addService, updateService, deleteService,
    addVehicle, updateVehicle, deleteVehicle,
    addAdAccount, updateAdAccount, deleteAdAccount,
    assignAdAccountCs, updateAdAccountAssignment, deleteAdAccountAssignment,
    assignAdAccountOwner, updateAdAccountOwnerAssignment, deleteAdAccountOwnerAssignment,
    addPlatform, updatePlatform, deletePlatform,
    addSubChannel, updateSubChannel, deleteSubChannel,
    addSource, updateSource, deleteSource,
    addPayment, updatePayment, deletePayment,
    addRole, updateRole, deleteRole,
    addAffiliate, updateAffiliate, deleteAffiliate,
    addVendor, updateVendor, deleteVendor,
    addCancelReason, updateCancelReason, deleteCancelReason,
    
    markNotificationAsRead, sendNotification,

    refreshTrigger, triggerRefresh,

    setAreas,
    currentRole, currentUser, isCurrentUserResolved, currentUserIssue, setCurrentRole, setCurrentUser,
    isMasterDataLoading, isOperationalDataLoading, isOrdersLoading, isLeadsLoading,
    ensureOrdersForDateRange, ensureLeadsForDateRange, ensureProspectBookingsForDateRange, ensureTechnicianSchedulesForDateRange,
    ensureAdPerformanceInputsForDateRange, refreshAdPerformanceInputsForDateRange,
  }), [
    areas, branches, activeBranches, services, vehicles, platforms, subChannels, 
    adAccounts, adAccountAssignments, adAccountOwnerAssignments, sources, payments, roles, users,
    leads, prospectLabels, leadSpamDailyInputs, prospectBookings, waTemplates, orders, dailyAds, notifications, affiliates, vendors, cancelReasons,
    technicianSchedules,
    auditLogs, currentRole, currentUser, isCurrentUserResolved, currentUserIssue, refreshTrigger,
    isMasterDataLoading, isOperationalDataLoading, isOrdersLoading, isLeadsLoading,
    ensureOrdersForDateRange, ensureLeadsForDateRange, ensureProspectBookingsForDateRange, ensureTechnicianSchedulesForDateRange,
    ensureAdPerformanceInputsForDateRange, refreshAdPerformanceInputsForDateRange
  ]);

  return (
    <MasterDataContext.Provider value={value}>
      {children}
    </MasterDataContext.Provider>
  );
};

export const useMasterData = () => {
  const context = useContext(MasterDataContext);
  if (!context) {
    throw new Error('useMasterData must be used within a MasterDataProvider');
  }
  return context;
};
