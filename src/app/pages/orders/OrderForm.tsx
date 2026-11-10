import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Dialog, DialogFooter } from '../../components/ui/dialog';
import {
  MasterDataDialogBody,
  MasterDataFormDialogContent,
  MasterDataFormHeader,
} from '../../components/ui/master-data-ui';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../components/ui/select';
import { Textarea } from '../../components/ui/textarea';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '../../components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '../../components/ui/popover';
import { cn } from '../../components/ui/utils';
import { useMasterData } from '../master-data/context';
import {
  AVAILABLE_TIME_SLOTS,
  AdAccount,
  AdAccountAssignment,
  Order,
  Platform,
  SubChannel,
  User,
} from '../master-data/data';
import { getTodayDateKey } from '../master-data/dateKeys';
import { usePermissions } from '@/app/hooks/usePermissions';
import { toast } from 'sonner';
import { logActivity } from '@/app/services/auditService';
import {
  isAdvertiserRole,
  isCsRole,
  isOwnerLikeRole,
  isTechnicianRole,
} from '@/app/data/roleHelpers';
import { AlertTriangle, Check, ChevronsUpDown, ClipboardList, Loader2, MapPin } from 'lucide-react';
import { Alert } from '../../components/ui/alert';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "../../components/ui/alert-dialog";
import { getCoordinatesFromUrl, getDistance, expandShortUrl } from '@/utils/mapUtils';
import { OrderStatusReasonFields } from './OrderStatusReasonFields';
import { isReasonRequiredStatus } from './cancelReasonOptions';
import { getOrderCrudErrorMessage } from './orderCrudErrors';
import {
  ORDER_SOURCE_MODE_LABEL,
  ORDER_SOURCE_PLATFORM_NAME,
  buildOrderFormPatch,
  normalizeCustomerPhone,
  uniqueById,
  type OrderSourceMode,
} from './orderFormModel';
import { RequiredLabel } from '../../components/ui/operational-page';
import {
  formatOrderBookingScheduleConflictMessage,
  formatOrderScheduleConflictMessage,
  formatOrderScheduleInactiveWarning,
  formatTechnicianUnavailableMessage,
  getOrderScheduleConflicts,
  getOrderProspectBookingScheduleConflicts,
  getTechnicianDaySchedule,
  shouldValidateOrderScheduleOnSave,
  validateOrderScheduleFromDB,
} from '@/app/services/orderScheduleValidation';
import { normalizeOrderTime } from '@/app/services/orderTime';

const FormSection = ({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) => (
  <section className="orderFormSection rounded-lg border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
    <div className="orderFormSectionHeader mb-4 border-b border-slate-100 pb-3 dark:border-slate-800">
      <h3>{title}</h3>
      {description && <p>{description}</p>}
    </div>
    <div className="orderFormSectionBody">
      {children}
    </div>
  </section>
);

interface OrderFormProps {
  isOpen: boolean;
  onClose: () => void;
  initialData?: Order | null;
  prefillData?: Partial<Order>;
  onSuccess?: (order: Order) => Promise<void> | void;
}

const ORDER_PAYMENT_TYPES: NonNullable<Order['paymentType']>[] = ['Transfer', 'Cash'];
const ORDER_PAYMENT_STATUSES: Order['paymentStatus'][] = ['Unpaid', 'Down Payment', 'Paid'];
const ORDER_PAYMENT_VALIDATIONS: Order['paymentValidation'][] = ['Pending', 'Valid', 'Invalid'];

const isOrderPaymentType = (value: string): value is NonNullable<Order['paymentType']> =>
  ORDER_PAYMENT_TYPES.includes(value as NonNullable<Order['paymentType']>);

const isOrderPaymentStatus = (value: string): value is Order['paymentStatus'] =>
  ORDER_PAYMENT_STATUSES.includes(value as Order['paymentStatus']);

const isOrderPaymentValidation = (value: string): value is Order['paymentValidation'] =>
  ORDER_PAYMENT_VALIDATIONS.includes(value as Order['paymentValidation']);

export const OrderForm: React.FC<OrderFormProps> = ({ isOpen, onClose, initialData, prefillData, onSuccess }) => {
  const { 
    addOrder, updateOrderPatch, orders, prospectBookings, leads,
    services, vehicles, platforms, subChannels, users, areas, payments, activeBranches: branches,
    currentUser, currentRole, technicianSchedules, affiliates,
    cancelReasons,
    adAccounts,
    adAccountAssignments,
    adAccountOwnerAssignments,
  } = useMasterData();
  const { hasPermission } = usePermissions();
  const isAdvertiserUser = isAdvertiserRole(currentRole);
  const isCsUser = isCsRole(currentRole);
  const isTechnicianUser = isTechnicianRole(currentRole);
  const isOwnerLikeUser = isOwnerLikeRole(currentRole);
  const canCreateOrder = hasPermission('order.create');
  const canEditOrderInfo = hasPermission('order.edit') || (!initialData && canCreateOrder);
  const canAssignTechnician = hasPermission('order.assign_technician') || canEditOrderInfo;
  const canEditOrderStatus = hasPermission('order.status.edit') || canEditOrderInfo;
  const canMarkOrderDone = hasPermission('order.status.mark_done') || isOwnerLikeUser;
  const canEditPaymentType = hasPermission('order.payment.edit_type') || canEditOrderInfo;
  const canEditPaymentStatus = hasPermission('order.payment.edit_status');
  const canValidatePayment = canEditPaymentStatus || hasPermission('finance.manage') || isOwnerLikeUser;
  const canEditOrderPrice =
    canEditOrderInfo ||
    canEditPaymentType ||
    canEditPaymentStatus ||
    hasPermission('finance.manage');

  const [formData, setFormData] = useState<Partial<Order>>({});
  const [selectedAdAccountId, setSelectedAdAccountId] = useState('');
  const [orderSourceMode, setOrderSourceMode] = useState<OrderSourceMode>('organic');
  const [openVehicle, setOpenVehicle] = useState(false);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isDirty, setIsDirty] = useState(false);
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const [recommendedBranches, setRecommendedBranches] = useState<{ id: string, name: string, distance: number }[]>([]);
  const [mapsUrlError, setMapsUrlError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const lastInitializedSourceRef = useRef<string | null>(null);

  const formSourceKey = initialData?.id
    ? `edit:${initialData.id}`
    : prefillData?.leadId
      ? `prefill:${prefillData.leadId}`
      : prefillData
        ? `prefill:${JSON.stringify(prefillData)}`
        : 'new';

  const scheduleConflicts = useMemo(
    () => getOrderScheduleConflicts(formData, orders || []),
    [formData.id, formData.technicianId, formData.serviceDate, formData.serviceTime, orders],
  );

  const ignoredBookingLeadIds = useMemo(() => {
    const ignoredIds = new Set(
      (leads || [])
        .filter((lead) => lead.status === 'Cancel' || lead.status === 'Closing')
        .map((lead) => lead.id),
    );
    const activeLeadId = formData.leadId || prefillData?.leadId || initialData?.leadId;
    if (activeLeadId) {
      ignoredIds.add(activeLeadId);
    }
    return ignoredIds;
  }, [formData.leadId, initialData?.leadId, leads, prefillData?.leadId]);

  const scheduleBlockingProspectBookings = useMemo(
    () => (prospectBookings || []).filter((booking) =>
      !booking.leadId || !ignoredBookingLeadIds.has(booking.leadId)
    ),
    [ignoredBookingLeadIds, prospectBookings],
  );

  const blockingConflictMessage = useMemo(() => {
    if (!shouldValidateOrderScheduleOnSave(initialData, formData)) {
      return null;
    }

    if (scheduleConflicts.activeConflicts.length === 0) {
      return null;
    }

    return formatOrderScheduleConflictMessage(
      formData,
      scheduleConflicts.activeConflicts,
      users,
    );
  }, [formData, initialData, scheduleConflicts.activeConflicts, users]);

  const blockingBookingConflictMessage = useMemo(() => {
    if (!shouldValidateOrderScheduleOnSave(initialData, formData)) {
      return null;
    }

    const activeBookingConflicts = getOrderProspectBookingScheduleConflicts(
      formData,
      scheduleBlockingProspectBookings,
    );
    if (activeBookingConflicts.length === 0) {
      return null;
    }

    return formatOrderBookingScheduleConflictMessage(
      formData,
      activeBookingConflicts,
      users,
    );
  }, [formData, initialData, scheduleBlockingProspectBookings, users]);

  const blockingTechnicianAvailabilityMessage = useMemo(() => {
    if (!shouldValidateOrderScheduleOnSave(initialData, formData)) {
      return null;
    }

    const technicianSchedule = getTechnicianDaySchedule(
      formData.technicianId,
      formData.serviceDate,
      technicianSchedules,
    );

    if (!technicianSchedule) {
      return null;
    }

    return formatTechnicianUnavailableMessage(
      formData,
      technicianSchedule,
      users,
    );
  }, [formData, initialData, technicianSchedules, users]);

  const blockingScheduleMessage =
    blockingTechnicianAvailabilityMessage || blockingConflictMessage || blockingBookingConflictMessage;

  const matchingCustomerPhoneHistory = useMemo(() => {
    const normalizedPhone = normalizeCustomerPhone(formData.customerPhone);
    if (normalizedPhone.length < 8) {
      return [];
    }

    const orderMatches = (orders || [])
      .filter((order) =>
        order.id !== formData.id &&
        normalizeCustomerPhone(order.customerPhone) === normalizedPhone
      )
      .map((order) => ({
        type: 'Order',
        id: order.id,
        customerName: order.customerName,
        date: order.serviceDate,
        status: order.status,
      }));

    const bookingMatches = (prospectBookings || [])
      .filter((booking) =>
        !booking.orderId &&
        normalizeCustomerPhone(booking.customerPhone) === normalizedPhone
      )
      .map((booking) => ({
        type: 'Booking',
        id: booking.id,
        customerName: booking.customerName,
        date: booking.scheduleDate,
        status: booking.status,
      }));

    return [...orderMatches, ...bookingMatches]
      .sort((a, b) => (b.date || '').localeCompare(a.date || ''))
      .slice(0, 3);
  }, [formData.customerPhone, formData.id, orders, prospectBookings]);

  const inactiveConflictWarning = useMemo(() => {
    if (
      !formData.technicianId ||
      !formData.serviceDate ||
      !formData.serviceTime ||
      blockingScheduleMessage ||
      scheduleConflicts.inactiveConflicts.length === 0
    ) {
      return null;
    }

    return formatOrderScheduleInactiveWarning(
      formData,
      scheduleConflicts.inactiveConflicts,
      users,
    );
  }, [
    blockingScheduleMessage,
    formData,
    formData.serviceDate,
    formData.serviceTime,
    formData.technicianId,
    scheduleConflicts.inactiveConflicts,
    users,
  ]);

  // --- FILTERING LOGIC (MASTER DATA AKUN IKLAN) ---
  const todayKey = getTodayDateKey();
  const allAdvertiserUsers = React.useMemo<User[]>(
    () => users.filter((user) => isAdvertiserRole(user.role) && user.status === 'active'),
    [users],
  );
  const allCsUsers = React.useMemo<User[]>(
    () => users.filter((user) => isCsRole(user.role) && user.status === 'active'),
    [users],
  );
  const selectedAdvertiserId = formData.advertiserId || (isAdvertiserUser ? currentUser?.id : undefined) || '';
  const selectedPlatformId = formData.platformId || '';
  const selectedSubChannelId = formData.subChannelId || '';
  const sourceOrder = initialData || prefillData;
  const originalAdvertiserId = sourceOrder?.advertiserId || '';
  const originalPlatformId = sourceOrder?.platformId || '';
  const originalSubChannelId = sourceOrder?.subChannelId || '';
  const originalCsId = sourceOrder?.csId || '';
  const attributionDateKey = formData.leadDate || sourceOrder?.leadDate || todayKey;
  const preserveOriginalPlatform = Boolean(sourceOrder) && selectedAdvertiserId === originalAdvertiserId;
  const preserveOriginalSubChannel = preserveOriginalPlatform && selectedPlatformId === originalPlatformId;
  const preserveOriginalCs = preserveOriginalSubChannel && selectedSubChannelId === originalSubChannelId;

  const isActiveAdAssignment = React.useCallback(
    (assignment: { startDate?: string | null; endDate?: string | null; status?: string | null }) => {
      if (assignment.status && assignment.status !== 'active') return false;
      if (assignment.startDate && assignment.startDate > attributionDateKey) return false;
      if (assignment.endDate && assignment.endDate < attributionDateKey) return false;
      return true;
    },
    [attributionDateKey],
  );

  const activeAdAccounts = React.useMemo<AdAccount[]>(
    () => adAccounts.filter((account) => account.status === 'active'),
    [adAccounts],
  );

  const activeOwnerByAccountId = React.useMemo(() => {
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

  const activeCsAssignmentsByAccountId = React.useMemo(() => {
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

  const getAccountAdvertiserId = React.useCallback(
    (account: AdAccount) => activeOwnerByAccountId.get(account.id) || account.advertiserId,
    [activeOwnerByAccountId],
  );

  const getScopedAdAccounts = React.useCallback(
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

  const getAccountSubChannelIds = React.useCallback(
    (accounts: AdAccount[]) => {
      const ids = new Set<string>();
      accounts.forEach((account) => {
        if (account.subChannelId) ids.add(account.subChannelId);
        (activeCsAssignmentsByAccountId.get(account.id) || []).forEach((assignment) => {
          if (assignment.subChannelId) ids.add(assignment.subChannelId);
        });
      });
      return ids;
    },
    [activeCsAssignmentsByAccountId],
  );

  const getSourceModePlatform = React.useCallback(
    (mode: OrderSourceMode) => {
      const platformName = ORDER_SOURCE_PLATFORM_NAME[mode];
      if (!platformName) return undefined;

      return platforms.find((platform) =>
        platform.status === 'active' &&
        platform.name.trim().toLowerCase() === platformName,
      );
    },
    [platforms],
  );

  const filteredAdvertisers = React.useMemo(() => {
    const includeOriginalAdvertiser = (items: User[]) => {
      if (!originalAdvertiserId || items.some((advertiser) => advertiser.id === originalAdvertiserId)) return items;
      const original = allAdvertiserUsers.find((advertiser) => advertiser.id === originalAdvertiserId);
      return original ? uniqueById([...items, original]) : items;
    };

    const scopedAccounts = getScopedAdAccounts();
    if (scopedAccounts.length > 0) {
      const advertiserIds = new Set(scopedAccounts.map(getAccountAdvertiserId).filter(Boolean));
      const fromAdAccounts = allAdvertiserUsers.filter((advertiser) => advertiserIds.has(advertiser.id));
      return includeOriginalAdvertiser(fromAdAccounts);
    }

    return includeOriginalAdvertiser([]);
  }, [allAdvertiserUsers, getAccountAdvertiserId, getScopedAdAccounts, originalAdvertiserId]);

  const filteredPlatforms = React.useMemo(() => {
    const includeOriginalPlatform = (items: Platform[]) => {
      if (!preserveOriginalPlatform || !originalPlatformId) return items;
      if (items.some((platform) => platform.id === originalPlatformId)) return items;

      const original = platforms.find((platform) => platform.id === originalPlatformId);
      return original ? uniqueById([...items, original]) : items;
    };

    if (orderSourceMode !== 'paid_ads') {
      return includeOriginalPlatform(platforms.filter((platform) => platform.status === 'active'));
    }

    const scopedAccounts = getScopedAdAccounts({ advertiserId: selectedAdvertiserId });
    if (scopedAccounts.length > 0) {
      const platformIds = new Set(scopedAccounts.map((account) => account.platformId).filter(Boolean));
      const accountPlatforms = platforms.filter((platform) => platform.status === 'active' && platformIds.has(platform.id));
      return includeOriginalPlatform(accountPlatforms);
    }

    return includeOriginalPlatform([]);
  }, [
    getScopedAdAccounts,
    orderSourceMode,
    originalPlatformId,
    platforms,
    preserveOriginalPlatform,
    selectedAdvertiserId,
  ]);

  const filteredSubChannels = React.useMemo(() => {
    const includeOriginalSubChannel = (items: SubChannel[]) => {
      if (!preserveOriginalSubChannel || !originalSubChannelId) return items;
      if (items.some((subChannel) => subChannel.id === originalSubChannelId)) return items;

      const original = subChannels.find((subChannel) => subChannel.id === originalSubChannelId);
      return original ? uniqueById([...items, original]) : items;
    };

    let scopedSubChannels = subChannels.filter((subChannel) => subChannel.status === 'active');

    if (selectedPlatformId) {
      scopedSubChannels = scopedSubChannels.filter((subChannel) => subChannel.platformId === selectedPlatformId);
    }

    if (orderSourceMode !== 'paid_ads') {
      return includeOriginalSubChannel(scopedSubChannels);
    }

    const scopedAccounts = getScopedAdAccounts({
      advertiserId: selectedAdvertiserId,
      platformId: selectedPlatformId,
    });
    const accountSubChannelIds = getAccountSubChannelIds(scopedAccounts);

    if (accountSubChannelIds.size > 0) {
      return includeOriginalSubChannel(
        scopedSubChannels.filter((subChannel) => accountSubChannelIds.has(subChannel.id)),
      );
    }

    return includeOriginalSubChannel([]);
  }, [
    getAccountSubChannelIds,
    getScopedAdAccounts,
    orderSourceMode,
    originalSubChannelId,
    preserveOriginalSubChannel,
    selectedAdvertiserId,
    selectedPlatformId,
    subChannels,
  ]);

  const filteredCS = React.useMemo(() => {
    const includeOriginalCs = (items: User[]) => {
      if (!preserveOriginalCs || !originalCsId) return items;
      if (items.some((cs) => cs.id === originalCsId)) return items;

      const original = allCsUsers.find((cs) => cs.id === originalCsId);
      return original ? uniqueById([...items, original]) : items;
    };

    if (orderSourceMode !== 'paid_ads') {
      return includeOriginalCs(allCsUsers);
    }

    const scopedAccounts = getScopedAdAccounts({
      advertiserId: selectedAdvertiserId,
      platformId: selectedPlatformId,
      subChannelId: selectedSubChannelId,
    });
    const accountCsIds = new Set<string>();
    scopedAccounts.forEach((account) => {
      (activeCsAssignmentsByAccountId.get(account.id) || []).forEach((assignment) => {
        if (assignment.csId) accountCsIds.add(assignment.csId);
      });
    });

    if (accountCsIds.size > 0) {
      return includeOriginalCs(allCsUsers.filter((cs) => accountCsIds.has(cs.id)));
    }

    return includeOriginalCs([]);
  }, [
    activeCsAssignmentsByAccountId,
    allCsUsers,
    getScopedAdAccounts,
    orderSourceMode,
    originalCsId,
    preserveOriginalCs,
    selectedAdvertiserId,
    selectedPlatformId,
    selectedSubChannelId,
  ]);

  const userNameById = React.useMemo(
    () => new Map(users.map((user) => [user.id, user.name])),
    [users],
  );

  const platformNameById = React.useMemo(
    () => new Map(platforms.map((platform) => [platform.id, platform.name])),
    [platforms],
  );

  const subChannelNameById = React.useMemo(
    () => new Map(subChannels.map((subChannel) => [subChannel.id, subChannel.name])),
    [subChannels],
  );

  const getPrimaryAdAccountAssignment = React.useCallback(
    (accountId: string, preferredCsId?: string) => {
      const assignments = [...(activeCsAssignmentsByAccountId.get(accountId) || [])]
        .sort((left, right) => (right.startDate || '').localeCompare(left.startDate || ''));

      if (preferredCsId) {
        return assignments.find((assignment) => assignment.csId === preferredCsId) || assignments[0];
      }

      return assignments[0];
    },
    [activeCsAssignmentsByAccountId],
  );

  const orderAdAccountOptions = React.useMemo(() => {
    const scopedCsId = isCsUser && currentUser ? currentUser.id : formData.csId;

    return getScopedAdAccounts({ csId: scopedCsId || undefined })
      .map((account) => {
        const preferredCsId = isCsUser ? currentUser?.id : undefined;
        const assignment = getPrimaryAdAccountAssignment(account.id, preferredCsId);
        const advertiserId = getAccountAdvertiserId(account);
        const platformId = account.platformId;
        const subChannelId = account.subChannelId || assignment?.subChannelId || undefined;
        const csId = isCsUser && currentUser ? currentUser.id : assignment?.csId;

        const advertiserName = advertiserId ? userNameById.get(advertiserId) : undefined;
        const platformName = platformId ? platformNameById.get(platformId) : undefined;
        const subChannelName = subChannelId ? subChannelNameById.get(subChannelId) : undefined;
        const csName = csId ? userNameById.get(csId) : undefined;

        return {
          account,
          advertiserId,
          advertiserName: advertiserName || 'Belum diset',
          csId,
          csName: csName || 'Belum diset',
          isComplete: Boolean(advertiserId && platformId && csId),
          platformId,
          platformName: platformName || 'Belum diset',
          subChannelId,
          subChannelName: subChannelName || 'Tanpa sub channel',
        };
      })
      .sort((left, right) => left.account.accountName.localeCompare(right.account.accountName));
  }, [
    currentUser,
    formData.csId,
    getAccountAdvertiserId,
    getPrimaryAdAccountAssignment,
    getScopedAdAccounts,
    isCsUser,
    platformNameById,
    subChannelNameById,
    userNameById,
  ]);

  const selectedAdAccountOption = React.useMemo(
    () => orderAdAccountOptions.find((option) => option.account.id === selectedAdAccountId) || null,
    [orderAdAccountOptions, selectedAdAccountId],
  );
  const isLeadConversionPrefill = Boolean(!initialData && prefillData?.leadId);
  const hasLeadConversionAttribution = Boolean(
    isLeadConversionPrefill &&
    orderSourceMode === 'paid_ads' &&
    formData.platformId &&
    formData.csId,
  );
  const paidAdsAttributionSummary = React.useMemo(() => {
    if (selectedAdAccountOption) {
      return {
        advertiserName: selectedAdAccountOption.advertiserName,
        csName: selectedAdAccountOption.csName,
        platformName: selectedAdAccountOption.platformName,
        subChannelName: selectedAdAccountOption.subChannelName,
      };
    }

    return {
      advertiserName: formData.advertiserId ? userNameById.get(formData.advertiserId) || '-' : '-',
      csName:
        (formData.csId ? userNameById.get(formData.csId) : undefined) ||
        (isCsUser ? currentUser?.name : undefined) ||
        '-',
      platformName: formData.platformId ? platformNameById.get(formData.platformId) || '-' : '-',
      subChannelName: formData.subChannelId ? subChannelNameById.get(formData.subChannelId) || 'Tanpa sub channel' : 'Tanpa sub channel',
    };
  }, [
    currentUser?.name,
    formData.advertiserId,
    formData.csId,
    formData.platformId,
    formData.subChannelId,
    isCsUser,
    platformNameById,
    selectedAdAccountOption,
    subChannelNameById,
    userNameById,
  ]);

  const inferAdAccountIdFromOrder = React.useCallback(
    (draft: Partial<Order>) => {
      if (draft.adAccountId && orderAdAccountOptions.some((option) => option.account.id === draft.adAccountId)) {
        return draft.adAccountId;
      }

      const hasAdAttribution =
        Boolean(draft.advertiserId) ||
        Boolean(draft.platformId) ||
        Boolean(draft.subChannelId);

      if (!hasAdAttribution) {
        return '';
      }

      const exactMatch = orderAdAccountOptions.find((option) =>
        (!draft.advertiserId || option.advertiserId === draft.advertiserId) &&
        (!draft.platformId || option.platformId === draft.platformId) &&
        (!draft.subChannelId || option.subChannelId === draft.subChannelId) &&
        (!draft.csId || option.csId === draft.csId)
      );

      return exactMatch?.account.id || '';
    },
    [orderAdAccountOptions],
  );

  const inferOrderSourceMode = React.useCallback(
    (draft: Partial<Order>, inferredAdAccountId?: string): OrderSourceMode => {
      if (inferredAdAccountId || inferAdAccountIdFromOrder(draft)) {
        return 'paid_ads';
      }

      const platformName = draft.platformId
        ? platformNameById.get(draft.platformId)?.trim().toLowerCase()
        : '';

      if (platformName === ORDER_SOURCE_PLATFORM_NAME.repeat_order) return 'repeat_order';
      if (platformName === ORDER_SOURCE_PLATFORM_NAME.organic) return 'organic';
      if (draft.platformId) return 'paid_ads';

      return 'organic';
    },
    [inferAdAccountIdFromOrder, platformNameById],
  );

  const applyAdAccountFieldsToDraft = React.useCallback(
    (draft: Partial<Order>, accountId: string) => {
      const option = orderAdAccountOptions.find((item) => item.account.id === accountId);
      if (!option?.isComplete) return draft;

      return {
        ...draft,
        adAccountId: option.account.id,
        advertiserId: option.advertiserId,
        platformId: option.platformId,
        subChannelId: option.subChannelId,
        csId: option.csId,
      };
    },
    [orderAdAccountOptions],
  );

  const formatAdAccountContext = React.useCallback((account: AdAccount) => {
    const ownerId = getAccountAdvertiserId(account);
    const ownerName = ownerId ? userNameById.get(ownerId) : undefined;
    const platformName = platformNameById.get(account.platformId);
    const subChannelName = account.subChannelId ? subChannelNameById.get(account.subChannelId) : undefined;

    return [
      account.accountName,
      platformName,
      subChannelName,
      ownerName,
    ].filter(Boolean).join(' / ');
  }, [getAccountAdvertiserId, platformNameById, subChannelNameById, userNameById]);

  const adAccountContextText = React.useMemo(() => {
    if (orderSourceMode !== 'paid_ads') {
      return {
        title: ORDER_SOURCE_MODE_LABEL[orderSourceMode],
        description: 'Order non-iklan tidak perlu advertiser atau akun iklan. CS owner tetap dicatat untuk follow up.',
        tone: 'neutral' as const,
      };
    }

    if (!formData.csId && !isCsUser) {
      return {
        title: 'Pilih CS owner dulu',
        description: 'Daftar akun iklan akan mengikuti assignment CS yang dipilih.',
        tone: 'neutral' as const,
      };
    }

    if (activeAdAccounts.length === 0) {
      return {
        title: 'Belum ada akun iklan aktif',
        description: 'Aktifkan akun iklan di Master Data Akun Iklan sebelum membuat pesanan dari iklan.',
        tone: 'warning' as const,
      };
    }

    if (orderAdAccountOptions.length === 0) {
      if (hasLeadConversionAttribution) {
        return {
          title: 'Data prospek siap dikonversi',
          description: 'Attribution mengikuti data prospek lama. Pilih akun iklan hanya jika ingin mengganti mapping.',
          tone: 'success' as const,
        };
      }

      return {
        title: 'Tidak ada akun iklan sesuai akses',
        description: 'Akun aktif tersedia, tapi belum ada yang sesuai role atau assignment user ini.',
        tone: 'warning' as const,
      };
    }

    if (!selectedAdAccountOption) {
      if (hasLeadConversionAttribution) {
        return {
          title: 'Data prospek siap dikonversi',
          description: 'Attribution mengikuti data prospek lama. Pilih akun iklan hanya jika ingin mengganti mapping.',
          tone: 'success' as const,
        };
      }

      return {
        title: 'Pilih akun iklan',
        description: 'Advertiser, platform, sub channel, dan CS akan terisi otomatis dari akun iklan yang dipilih.',
        tone: 'neutral' as const,
      };
    }

    if (!selectedAdAccountOption.isComplete) {
      return {
        title: 'Akun iklan belum lengkap',
        description: 'Lengkapi advertiser, platform, dan CS assignment di Master Akun Iklan sebelum dipakai untuk pesanan.',
        tone: 'warning' as const,
      };
    }

    return {
      title: selectedAdAccountOption.account.accountName,
      description: 'Attribution pesanan otomatis mengikuti Master Data Akun Iklan.',
      tone: 'success' as const,
    };
  }, [
    activeAdAccounts.length,
    formData.csId,
    hasLeadConversionAttribution,
    isCsUser,
    orderAdAccountOptions.length,
    orderSourceMode,
    selectedAdAccountOption,
  ]);

  useEffect(() => {
    if (formData.platformId && !filteredPlatforms.some((platform) => platform.id === formData.platformId)) {
      setFormData((prev) => ({
        ...prev,
        platformId: undefined,
        subChannelId: undefined,
        csId: isCsUser ? currentUser?.id : undefined,
      }));
    }
  }, [currentUser?.id, filteredPlatforms, formData.platformId, isCsUser]);

  useEffect(() => {
    if (formData.subChannelId && !filteredSubChannels.some((subChannel) => subChannel.id === formData.subChannelId)) {
      setFormData((prev) => ({
        ...prev,
        subChannelId: undefined,
        csId: isCsUser ? currentUser?.id : prev.csId,
      }));
    }
  }, [currentUser?.id, filteredSubChannels, formData.subChannelId, isCsUser]);

  useEffect(() => {
    if (isCsUser && currentUser) {
      if (formData.csId !== currentUser.id) {
        setFormData((prev) => ({ ...prev, csId: currentUser.id }));
      }
      return;
    }

    if (formData.csId && !filteredCS.some((cs) => cs.id === formData.csId)) {
      setFormData((prev) => ({ ...prev, csId: undefined }));
    }
  }, [currentUser, filteredCS, formData.csId, isCsUser]);

  const validateMapsUrl = async (url: string, silent = false): Promise<{ lat: number, lng: number } | null> => {
      let targetUrl = url || '';
      if (!targetUrl) return null;
      targetUrl = targetUrl.trim().replace(/[.,;]+$/, '');
      
      // 1. Cek apakah ini short URL yang dikenal
      const isShortUrl = targetUrl.includes('goo.gl') || targetUrl.includes('maps.app.goo.gl') || targetUrl.includes('bit.ly') || targetUrl.includes('g.co');
      
      if (isShortUrl) {
         if (!silent) toast.info("Mengambil detail lokasi dari link pendek...", { duration: 2000 });
         try {
             const expanded = await expandShortUrl(targetUrl);
             if (expanded && expanded !== targetUrl) {
                 targetUrl = expanded;
             }
         } catch (e) {
             console.error("Expand error:", e);
         }
      }

      // 2. Coba ambil koordinat
      let coords = getCoordinatesFromUrl(targetUrl);

      // 3. Jika gagal & bukan short URL (mungkin URL panjang tapi aneh), coba expand juga sebagai upaya terakhir
      if (!coords && !isShortUrl && targetUrl.startsWith('http')) {
          if (!silent) toast.info("Mencoba analisis link maps...", { duration: 2000 });
          try {
             const expanded = await expandShortUrl(targetUrl);
             if (expanded && expanded !== targetUrl) {
                 targetUrl = expanded;
                 coords = getCoordinatesFromUrl(targetUrl);
             }
          } catch (e) {
             console.error("Deep expand error:", e);
          }
      }

      if (!coords) {
         if (!silent) {
             toast.error('Gagal mendapatkan titik koordinat dari link ini.');
             // Tampilkan hint kenapa gagal
             if (targetUrl.includes('/search/')) {
                 setMapsUrlError("Link ini adalah hasil pencarian, bukan lokasi spesifik. Mohon pilih satu lokasi lalu klik 'Bagikan' > 'Salin Link'.");
             } else {
                 setMapsUrlError("Pastikan link mengandung koordinat atau gunakan tombol 'Bagikan' di Google Maps.");
             }
         }
         return null;
      }
      return coords;
  };

  const handleRecommendBranch = async () => {
    setMapsUrlError(null);
    const coords = await validateMapsUrl(formData.mapsUrl || '');
    if (!coords) {
        setMapsUrlError("URL tidak valid atau lokasi tidak ditemukan");
        return;
    }
    let foundBranches: { id: string, name: string, distance: number }[] = [];
    branches.forEach(branch => {
        let branchLat = branch.lat;
        let branchLng = branch.lng;
        if ((!branchLat || !branchLng) && branch.mapsUrl) {
            const branchCoords = getCoordinatesFromUrl(branch.mapsUrl);
            if (branchCoords) {
                branchLat = branchCoords.lat;
                branchLng = branchCoords.lng;
            }
        }
        if (branchLat && branchLng) {
            const dist = getDistance(coords.lat, coords.lng, branchLat, branchLng);
            foundBranches.push({ id: branch.id, name: branch.name, distance: dist });
        }
    });
    if (foundBranches.length > 0) {
        foundBranches.sort((a, b) => a.distance - b.distance);
        const topBranches = foundBranches.slice(0, 5);
        setRecommendedBranches(topBranches);
        toast.success(`Ditemukan ${topBranches.length} rekomendasi cabang terdekat.`);
    } else {
        toast.warning('Tidak dapat menemukan lokasi cabang yang valid untuk perbandingan.');
    }
  };

  useEffect(() => {
    if (!isOpen) {
      lastInitializedSourceRef.current = null;
      setSelectedAdAccountId('');
      setOrderSourceMode('organic');
      return;
    }

    if (lastInitializedSourceRef.current === formSourceKey) {
      return;
    }

    lastInitializedSourceRef.current = formSourceKey;
    setIsDirty(false);
    setRecommendedBranches([]); 
    setMapsUrlError(null);

    if (initialData) {
      const nextFormData = {
        ...initialData,
        serviceTime: normalizeOrderTime(initialData.serviceTime),
        units: initialData.units || 1,
      };
      const inferredAdAccountId = inferAdAccountIdFromOrder(nextFormData);
      setOrderSourceMode(inferOrderSourceMode(nextFormData, inferredAdAccountId));
      setSelectedAdAccountId(inferredAdAccountId);
      setFormData(
        inferredAdAccountId
          ? applyAdAccountFieldsToDraft(nextFormData, inferredAdAccountId)
          : nextFormData,
      );
      return;
    }

    const normalizedPrefillData = prefillData
      ? {
          ...prefillData,
          serviceTime: prefillData.serviceTime
            ? normalizeOrderTime(prefillData.serviceTime)
            : prefillData.serviceTime,
        }
      : undefined;

    const nextFormData: Partial<Order> = {
      id: `OP-${Math.random().toString(36).substr(2, 5).toUpperCase()}`,
      leadDate: new Date().toISOString().split('T')[0],
      status: 'pending',
      paymentType: 'Transfer',
      paymentStatus: 'Unpaid',
      paymentValidation: 'Pending',
      serviceCategory: 'Visit',
      units: 1,
      csId: isCsUser ? currentUser?.id : undefined,
      branchId: isTechnicianUser ? currentUser?.branchId : undefined,
      advertiserId: isAdvertiserUser ? currentUser?.id : undefined,
      ...normalizedPrefillData
    };
    if ((nextFormData.price === undefined || nextFormData.price === null) && nextFormData.serviceId) {
      nextFormData.price = services.find((service) => service.id === nextFormData.serviceId)?.price;
    }
    const inferredAdAccountId = inferAdAccountIdFromOrder(nextFormData);
    setOrderSourceMode(inferOrderSourceMode(nextFormData, inferredAdAccountId));
    setSelectedAdAccountId(inferredAdAccountId);
    setFormData(
      inferredAdAccountId
        ? applyAdAccountFieldsToDraft(nextFormData, inferredAdAccountId)
        : nextFormData,
    );
  }, [
    applyAdAccountFieldsToDraft,
    currentUser?.branchId,
    currentUser?.id,
    formSourceKey,
    inferAdAccountIdFromOrder,
    inferOrderSourceMode,
    initialData,
    isAdvertiserUser,
    isCsUser,
    isOpen,
    isTechnicianUser,
    prefillData,
  ]);

  useEffect(() => {
    if (!isOpen || formData.price !== undefined || !formData.serviceId) {
      return;
    }

    const selectedService = services.find((service) => service.id === formData.serviceId);
    if (!selectedService) {
      return;
    }

    setFormData((prev) => (
      prev.price === undefined && prev.serviceId === selectedService.id
        ? { ...prev, price: selectedService.price }
        : prev
    ));
  }, [formData.price, formData.serviceId, isOpen, services]);

  useEffect(() => {
    if (!isOpen || selectedAdAccountId || orderAdAccountOptions.length === 0) {
      return;
    }

    const inferredAdAccountId = inferAdAccountIdFromOrder(formData);
    if (!inferredAdAccountId) {
      return;
    }

    setSelectedAdAccountId(inferredAdAccountId);
    setOrderSourceMode('paid_ads');
    setFormData((prev) => applyAdAccountFieldsToDraft(prev, inferredAdAccountId));
  }, [
    applyAdAccountFieldsToDraft,
    formData.advertiserId,
    formData.csId,
    formData.leadDate,
    formData.platformId,
    formData.subChannelId,
    inferAdAccountIdFromOrder,
    isOpen,
    orderAdAccountOptions.length,
    selectedAdAccountId,
  ]);

  useEffect(() => {
    if (!isOpen || orderSourceMode !== 'paid_ads' || !selectedAdAccountId) {
      return;
    }

    const selectedOption = orderAdAccountOptions.find((option) => option.account.id === selectedAdAccountId);
    if (!selectedOption?.isComplete) {
      return;
    }

    setFormData((prev) => {
      const next = applyAdAccountFieldsToDraft(prev, selectedAdAccountId);
      if (
        next.advertiserId === prev.advertiserId &&
        next.platformId === prev.platformId &&
        next.subChannelId === prev.subChannelId &&
        next.adAccountId === prev.adAccountId &&
        next.csId === prev.csId
      ) {
        return prev;
      }
      return next;
    });
  }, [
    applyAdAccountFieldsToDraft,
    attributionDateKey,
    isOpen,
    orderAdAccountOptions,
    orderSourceMode,
    selectedAdAccountId,
  ]);

  useEffect(() => {
    if (formData.technicianId) {
      const tech = users.find(u => u.id === formData.technicianId);
      if (tech && tech.branchId) {
        setFormData(prev => {
            // Prevent unnecessary updates/renders if branchId is already correct
            if (prev.branchId === tech.branchId) return prev;
            return { ...prev, branchId: tech.branchId };
        });
      }
    }
  }, [formData.technicianId, users]);

  const handleChange = <K extends keyof Order>(field: K, value: Order[K]) => {
    setSubmitError(null);
    setFormData(prev => {
      const normalizedValue = field === 'serviceTime' ? normalizeOrderTime(value) : value;
      const next = {
        ...prev,
        [field]: normalizedValue,
      };

      if (field === 'advertiserId' && normalizedValue !== prev.advertiserId) {
        next.platformId = undefined;
        next.subChannelId = undefined;
        next.csId = isCsUser ? currentUser?.id : undefined;
      }

      if (field === 'platformId' && normalizedValue !== prev.platformId) {
        next.subChannelId = undefined;
        next.csId = isCsUser ? currentUser?.id : undefined;
      }

      if (field === 'subChannelId' && normalizedValue !== prev.subChannelId) {
        next.csId = isCsUser ? currentUser?.id : undefined;
      }

      return next;
    });
    setIsDirty(true);
  };

  const reportSubmitError = (error: unknown, fallback?: string) => {
    const message = getOrderCrudErrorMessage(error, fallback);
    setSubmitError(message);
    toast.error(message);
  };

  const handleCsOwnerChange = (csId: string) => {
    setFormData((prev) => ({
      ...prev,
      csId,
      ...(orderSourceMode === 'paid_ads'
        ? {
	            advertiserId: undefined,
	            platformId: undefined,
	            subChannelId: undefined,
	            adAccountId: undefined,
	          }
        : {}),
    }));
    setSelectedAdAccountId('');
    setIsDirty(true);
  };

  const handleOrderSourceModeChange = (mode: OrderSourceMode) => {
    setOrderSourceMode(mode);
    setIsDirty(true);

    if (mode === 'paid_ads') {
      const canAutoPickAccount = Boolean(isCsUser || formData.csId);
      const onlyCompleteAccount =
        canAutoPickAccount &&
        orderAdAccountOptions.length === 1 &&
        orderAdAccountOptions[0].isComplete
          ? orderAdAccountOptions[0].account.id
          : '';

      setSelectedAdAccountId(onlyCompleteAccount);
      setFormData((prev) => {
        const next = {
          ...prev,
	          advertiserId: undefined,
	          platformId: undefined,
	          subChannelId: undefined,
	          adAccountId: undefined,
	          csId: isCsUser && currentUser ? currentUser.id : prev.csId,
        };

        return onlyCompleteAccount
          ? applyAdAccountFieldsToDraft(next, onlyCompleteAccount)
          : next;
      });
      return;
    }

    const sourcePlatform = getSourceModePlatform(mode);
    setSelectedAdAccountId('');
    setFormData((prev) => ({
      ...prev,
	      advertiserId: undefined,
	      platformId: sourcePlatform?.id,
	      subChannelId: undefined,
	      adAccountId: undefined,
	      csId: isCsUser && currentUser ? currentUser.id : prev.csId,
    }));

    if (!sourcePlatform) {
      toast.warning(`Platform ${ORDER_SOURCE_MODE_LABEL[mode]} belum ada di master platform.`);
    }
  };

  const handleAdAccountSelect = (accountId: string) => {
    const option = orderAdAccountOptions.find((item) => item.account.id === accountId);
    setSelectedAdAccountId(accountId);
    setOrderSourceMode('paid_ads');
    setFormData((prev) => applyAdAccountFieldsToDraft(prev, accountId));
    setIsDirty(true);

    if (!option?.isComplete) {
      toast.warning('Akun iklan ini belum lengkap. Lengkapi advertiser, platform, dan CS assignment di Master Data.');
    }
  };

  const handleStatusChange = (value: string) => {
    setFormData((prev) => {
      const nextStatus = value as Order['status'];
      const shouldResetReason =
        !isReasonRequiredStatus(nextStatus) ||
        (isReasonRequiredStatus(prev.status) && prev.status !== nextStatus);

      return {
        ...prev,
        status: nextStatus,
        ...(shouldResetReason
          ? {
              cancelReason: undefined,
              cancelReasonNote: undefined,
            }
          : {}),
      };
    });
    setIsDirty(true);
  };

  const handleClose = () => {
    if (isDirty) {
      setShowCancelConfirm(true);
    } else {
      onClose();
    }
  };

  const normalizeOrderAttributionFields = React.useCallback((draft: Partial<Order>) => {
    const next = { ...draft };
    const selectedOption = selectedAdAccountId
      ? orderAdAccountOptions.find((option) => option.account.id === selectedAdAccountId)
      : null;

    if (orderSourceMode !== 'paid_ads') {
      next.adAccountId = undefined;
      next.advertiserId = undefined;
      next.subChannelId = undefined;
    } else if (selectedOption?.isComplete) {
      next.adAccountId = selectedOption.account.id;
      next.advertiserId = selectedOption.advertiserId;
      next.platformId = selectedOption.platformId;
      next.subChannelId = selectedOption.subChannelId;
      next.csId = selectedOption.csId;
    }

    if (isAdvertiserUser && currentUser) {
      next.advertiserId = currentUser.id;
    }

    if (isCsUser && currentUser) {
      next.csId = currentUser.id;
    }

    if (next.advertiserId && !filteredAdvertisers.some((advertiser) => advertiser.id === next.advertiserId)) {
      next.advertiserId = undefined;
    }

    if (next.platformId && !filteredPlatforms.some((platform) => platform.id === next.platformId)) {
      next.platformId = undefined;
      next.subChannelId = undefined;
    }

    if (next.subChannelId && !filteredSubChannels.some((subChannel) => subChannel.id === next.subChannelId)) {
      next.subChannelId = undefined;
    }

    const validCsUsers = orderSourceMode === 'paid_ads' ? filteredCS : allCsUsers;

    if (next.csId && !validCsUsers.some((cs) => cs.id === next.csId)) {
      next.csId = isCsUser && currentUser ? currentUser.id : undefined;
    }

    return next;
  }, [
    allCsUsers,
    currentUser,
    filteredAdvertisers,
    filteredCS,
    filteredPlatforms,
    filteredSubChannels,
    isAdvertiserUser,
    isCsUser,
    orderSourceMode,
    orderAdAccountOptions,
    selectedAdAccountId,
  ]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Sanitize empty strings to undefined to prevent Foreign Key Violation
    const sanitizedData = { ...formData };
    const nullableKeys: (keyof Order)[] = [
      'advertiserId', 'platformId', 'subChannelId', 'adAccountId', 'vehicleId', 'csId',
      'branchId', 'technicianId', 'areaId', 'paymentMethodId', 'serviceId'
    ];
    
    nullableKeys.forEach(key => {
        if (sanitizedData[key] === "") {
            delete sanitizedData[key];
        }
    });

    const selectedOption = selectedAdAccountId
      ? orderAdAccountOptions.find((option) => option.account.id === selectedAdAccountId)
      : null;
    const canUseLeadConversionAttribution = Boolean(
      !initialData &&
      prefillData?.leadId &&
      orderSourceMode === 'paid_ads' &&
      sanitizedData.platformId &&
      sanitizedData.csId,
    );
    const requiresMasterAdAccount =
      orderSourceMode === 'paid_ads' &&
      canEditOrderInfo &&
      !canUseLeadConversionAttribution;

    if (requiresMasterAdAccount && !selectedOption?.isComplete) {
      reportSubmitError('Pilih akun iklan yang lengkap dari Master Data Akun Iklan.');
      return;
    }

	    if (orderSourceMode !== 'paid_ads') {
	      const sourcePlatform = getSourceModePlatform(orderSourceMode);
	      sanitizedData.adAccountId = undefined;
	      sanitizedData.advertiserId = undefined;
	      sanitizedData.subChannelId = undefined;
      sanitizedData.platformId = sourcePlatform?.id || sanitizedData.platformId;
    }

    const attributionBeforeValidation = {
      advertiserId: sanitizedData.advertiserId,
      platformId: sanitizedData.platformId,
      subChannelId: sanitizedData.subChannelId,
      csId: sanitizedData.csId,
    };
	    const normalizedAttribution = normalizeOrderAttributionFields(sanitizedData);
	    sanitizedData.adAccountId = normalizedAttribution.adAccountId;
	    sanitizedData.advertiserId = normalizedAttribution.advertiserId;
    sanitizedData.platformId = normalizedAttribution.platformId;
    sanitizedData.subChannelId = normalizedAttribution.subChannelId;
    sanitizedData.csId = normalizedAttribution.csId;

    const invalidAttributionLabels = [
      attributionBeforeValidation.advertiserId && !sanitizedData.advertiserId ? 'Advertiser' : '',
      attributionBeforeValidation.platformId && !sanitizedData.platformId ? 'Platform' : '',
      attributionBeforeValidation.subChannelId && !sanitizedData.subChannelId ? 'Sub Channel' : '',
      attributionBeforeValidation.csId && !sanitizedData.csId ? 'CS' : '',
    ].filter(Boolean);

    if (invalidAttributionLabels.length > 0) {
      reportSubmitError(`Pilihan ${invalidAttributionLabels.join(', ')} tidak sesuai Master Data Akun Iklan. Pilih ulang sebelum menyimpan.`);
      return;
    }

    sanitizedData.serviceTime = normalizeOrderTime(sanitizedData.serviceTime);

    const requiredFields: (keyof Order)[] = [
      'leadDate', 'customerName', 'customerPhone', 'address', 
      'serviceDate', 'serviceTime', 'serviceId', 'serviceCategory', 
      'mapsUrl', 'platformId', 'price', 'csId'
    ];
    const requiredFieldLabels: Partial<Record<keyof Order, string>> = {
      leadDate: 'Tanggal lead',
      customerName: 'Nama customer',
      customerPhone: 'Nomor telepon',
      address: 'Alamat lengkap',
      serviceDate: 'Tanggal service',
      serviceTime: 'Jam',
      serviceId: 'Layanan',
      serviceCategory: 'Jenis layanan',
      mapsUrl: 'Maps URL',
      platformId: 'Platform',
      price: 'Harga',
      csId: 'CS',
    };
    const isMissingRequiredField = (field: keyof Order) => {
      const value = sanitizedData[field];
      if (field === 'price') {
        return value === undefined || value === null || value === '' || !Number.isFinite(Number(value));
      }
      if (typeof value === 'string') {
        return value.trim().length === 0;
      }
      return value === undefined || value === null;
    };
    const missingFields = requiredFields.filter(isMissingRequiredField);
    if (missingFields.length > 0) {
      if (missingFields.includes('mapsUrl')) {
        setMapsUrlError('Maps URL wajib diisi.');
      }
      const missingLabels = missingFields.map(field => requiredFieldLabels[field] || String(field));
      reportSubmitError(`Mohon lengkapi field wajib: ${missingLabels.join(', ')}`);
      return;
    }

    const normalizedPrice = Number(sanitizedData.price);
    if (!Number.isFinite(normalizedPrice) || normalizedPrice < 0) {
      reportSubmitError('Harga harus berupa angka 0 atau lebih.');
      return;
    }
    sanitizedData.price = normalizedPrice;

    // Validate cancel reason when status is cancelled or reschedule
    if ((sanitizedData.status === 'cancelled' || sanitizedData.status === 'reschedule') && !sanitizedData.cancelReason) {
      reportSubmitError('Mohon pilih alasan ' + (sanitizedData.status === 'cancelled' ? 'pembatalan' : 'jadwal ulang'));
      return;
    }

    if (blockingScheduleMessage) {
      reportSubmitError(blockingScheduleMessage);
      return;
    }

    // Clear cancel reason fields if status is not cancelled/reschedule
    if (sanitizedData.status !== 'cancelled' && sanitizedData.status !== 'reschedule') {
      sanitizedData.cancelReason = undefined;
      sanitizedData.cancelReasonNote = undefined;
    }

    // Auto-reset follow-up when status changes to cancelled/reschedule (new cancel)
    if (initialData && (sanitizedData.status === 'cancelled' || sanitizedData.status === 'reschedule') && initialData.status !== sanitizedData.status) {
      sanitizedData.isFollowedUp = false;
      sanitizedData.followedUpBy = undefined;
      sanitizedData.followedUpAt = undefined;
      sanitizedData.followUpNote = undefined;
    }

    setIsSubmitting(true);
    if (sanitizedData.mapsUrl) {
       const coords = await validateMapsUrl(sanitizedData.mapsUrl, true);
       if (!coords) {
           setMapsUrlError("URL Maps tidak valid. Mohon periksa kembali linknya.");
           reportSubmitError("URL Maps tidak valid. Tidak dapat menyimpan pesanan.");
           setIsSubmitting(false);
           return;
       }
    }

    // Fresh DB validation to prevent double-booking from stale context data
    if (shouldValidateOrderScheduleOnSave(initialData, sanitizedData)) {
      const dbConflict = await validateOrderScheduleFromDB(sanitizedData, users, {
        ignoredBookingLeadIds,
      });
      if (dbConflict) {
        reportSubmitError(dbConflict);
        setIsSubmitting(false);
        return;
      }
    }

    try {
      let savedOrder: Order | undefined;
      if (initialData) {
        const patch = buildOrderFormPatch(initialData, sanitizedData);
        savedOrder = Object.keys(patch).length > 0
          ? await updateOrderPatch(initialData.id, patch, { silent: true, skipFreshScheduleValidation: true })
          : initialData;
        toast.success('Pesanan berhasil diperbarui');
        if (currentUser) {
          logActivity(
            { id: currentUser.id, name: currentUser.name, role: currentUser.role },
            'UPDATE',
            'Pesanan',
            `Memperbarui pesanan: ${sanitizedData.customerName}`,
            initialData.id || '',
            { service: sanitizedData.serviceId, status: sanitizedData.status }
          );
        }
      } else {
        savedOrder = await addOrder(sanitizedData as Order, { skipFreshScheduleValidation: true });
        toast.success('Pesanan berhasil dibuat');
        if (currentUser) {
          logActivity(
            { id: currentUser.id, name: currentUser.name, role: currentUser.role },
            'CREATE',
            'Pesanan',
            `Membuat pesanan baru: ${sanitizedData.customerName}`,
            '',
            { service: sanitizedData.serviceId, customer: sanitizedData.customerName }
          );
        }
      }
      if (onSuccess) await onSuccess((savedOrder || sanitizedData) as Order);
      onClose();
    } catch (error: unknown) {
      reportSubmitError(error, 'Gagal menyimpan pesanan');
    } finally {
      setIsSubmitting(false);
    }
  };

  const canEdit = (field: keyof Order): boolean => {
    const commonFields: (keyof Order)[] = [
      'leadDate', 'customerName', 'customerPhone', 'address', 
      'serviceDate', 'serviceTime', 'serviceId', 'serviceCategory', 
      'mapsUrl', 'vehicleId', 'price', 'platformId', 'subChannelId', 'notes',
      'areaId', 'affiliateName'
    ];
    if (commonFields.includes(field)) {
      if (field === 'price') {
        return canEditOrderPrice;
      }
      return canEditOrderInfo;
    }
    if (field === 'status') {
      return canEditOrderStatus;
    }
    if (field === 'paymentMethodId') {
      return canEditPaymentType;
    }
    if (field === 'csId') {
      return canEditOrderInfo && !isCsUser;
    }
    if (field === 'technicianId') {
       return canAssignTechnician;
    }
    if (field === 'advertiserId') {
       return canEditOrderInfo;
    }
    if (field === 'branchId') {
       return canEditOrderInfo && !isTechnicianUser;
    }
    if (field === 'paymentValidation') {
       return canValidatePayment;
    }
    if (field === 'paymentStatus' || field === 'income') {
       return canEditPaymentStatus;
    }
    return true; 
  };

  const csUsers = orderSourceMode === 'paid_ads' ? filteredCS : allCsUsers;
  const techUsers = users.filter((u) => isTechnicianRole(u.role) && u.status === 'active');
  const filteredAreas = formData.branchId ? areas.filter(a => a.branchId === formData.branchId) : areas;
  const selectedCsDisplayName =
    (formData.csId ? userNameById.get(formData.csId) : undefined) ||
    (isCsUser ? currentUser?.name : undefined) ||
    '-';
  const canSelectPaidAdAccount = Boolean(formData.csId || isCsUser);
  const selectedSourcePlatform = getSourceModePlatform(orderSourceMode);
  // Use real data from affiliates context instead of mock
  const activeAffiliates = (affiliates || []).filter(a => a.status === 'Active');

  return (
    <>
      <Dialog open={isOpen} onOpenChange={(open) => { if (!open) handleClose(); }}>
        <MasterDataFormDialogContent
          size="wide"
          className="orderFormSheet orderFormDialog masterDataManagedForm"
          preventOutsideClose={false}
          onEscapeKeyDown={(e) => {
            e.preventDefault();
            handleClose();
          }}
        >
          <MasterDataFormHeader
            className="orderFormHeader"
            icon={ClipboardList}
            title={initialData ? 'Edit Pesanan' : 'Tambah Pesanan Baru'}
            description="Lengkapi detail pesanan berikut."
          />

          <MasterDataDialogBody className="orderFormBody">
          <form id="order-form" onSubmit={handleSubmit} className="orderManagedForm masterDataForm space-y-4">
            
            <FormSection title="Data Pelanggan" description="Identitas customer, kontak, alamat, dan lokasi maps.">
              <div className="grid grid-cols-1 gap-4">
               <div className="grid grid-cols-2 gap-4">
                 <div className="space-y-2">
                   <Label>ID Order</Label>
                   <Input value={formData.id || ''} disabled className="bg-slate-50 dark:bg-slate-800 font-mono text-sm" />
                 </div>
                 <div className="space-y-2">
                   <RequiredLabel>Tanggal Leads</RequiredLabel>
                   <Input 
                      type="date" 
                      value={formData.leadDate || ''} 
                      onChange={(e) => handleChange('leadDate', e.target.value)}
                      disabled={!canEdit('leadDate')}
                   />
                 </div>
               </div>

               <div className="space-y-2">
                 <RequiredLabel>Nama Lengkap Client</RequiredLabel>
                 <Input 
                    value={formData.customerName || ''} 
                    onChange={(e) => handleChange('customerName', e.target.value)}
                    disabled={!canEdit('customerName')}
                    className="font-medium"
                 />
               </div>

               <div className="space-y-2">
                 <RequiredLabel>No Whatsapp</RequiredLabel>
                 <Input 
                    value={formData.customerPhone || ''} 
                    onChange={(e) => handleChange('customerPhone', e.target.value)}
                    disabled={!canEdit('customerPhone')}
                 />
                 {matchingCustomerPhoneHistory.length > 0 && (
                   <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                     <div className="flex items-start gap-2">
                       <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                       <div className="space-y-1">
                         <p className="font-medium">Nomor ini punya riwayat order/booking.</p>
                         <p className="leading-relaxed">
                           Repeat order tetap boleh disimpan; yang diblokir hanya jadwal aktif dengan teknisi, tanggal, dan jam yang sama.
                         </p>
                         <div className="space-y-0.5 text-amber-800">
                           {matchingCustomerPhoneHistory.map((item) => (
                             <p key={`${item.type}-${item.id}`}>
                               {item.type} {item.id} - {item.date || '-'} - {item.status}
                             </p>
                           ))}
                         </div>
                       </div>
                     </div>
                   </div>
                 )}
               </div>

               <div className="space-y-2">
                 <RequiredLabel>Alamat Lengkap</RequiredLabel>
                 <Textarea 
                    value={formData.address || ''} 
                    onChange={(e) => handleChange('address', e.target.value)}
                    disabled={!canEdit('address')}
                    className="min-h-[80px]"
                 />
               </div>

               <div className="orderFormMapField space-y-2">
                 <RequiredLabel>Maps URL</RequiredLabel>
                 <div className="orderFormMapControl">
                   <div className="orderFormMapInput">
                     <Input 
                         value={formData.mapsUrl || ''} 
                         onChange={(e) => {
                             handleChange('mapsUrl', e.target.value);
                             if (mapsUrlError) setMapsUrlError(null); 
                             if (!e.target.value) {
                                setRecommendedBranches([]);
                                setMapsUrlError(null);
                             }
                         }}
                         disabled={!canEdit('mapsUrl')}
                         placeholder="https://maps.google.com/..."
                         className={mapsUrlError ? "border-red-500 focus-visible:ring-red-500" : ""}
                     />
                   </div>
                     <Button
                         type="button"
                         variant="secondary"
                         size="icon"
                         onClick={handleRecommendBranch}
                         disabled={!formData.mapsUrl}
                         title="Cari Cabang Terdekat"
                         className="orderFormMapButton"
                     >
                         <MapPin className="w-4 h-4" />
                     </Button>
                 </div>
                 {mapsUrlError && (
                    <p className="text-xs text-red-500 font-medium animate-in slide-in-from-top-1">{mapsUrlError}</p>
                 )}
                 {recommendedBranches.length > 0 && (
                    <div className="mt-2 space-y-2">
                        {recommendedBranches.map((branch, idx) => (
                            <Alert key={branch.id} className={`p-2 flex items-center gap-2 bg-blue-50 border-blue-200 dark:bg-blue-900/20 dark:border-blue-800 ${idx === 0 ? 'border-l-4 border-l-blue-500' : ''}`}>
                                <MapPin className="h-4 w-4 text-blue-600 dark:text-blue-400 shrink-0" />
                                <div className="flex-1 flex items-center justify-between min-w-0">
                                    <div className="flex items-center gap-2 text-xs text-blue-900 dark:text-blue-200 overflow-hidden">
                                        <span className="font-bold uppercase shrink-0">{idx === 0 ? 'Utama' : `#${idx + 1}`}</span>
                                        <span className="truncate" title={branch.name}>{branch.name}</span>
                                        <span className="font-mono font-bold text-blue-700 dark:text-blue-400 shrink-0">({branch.distance.toFixed(1)} km)</span>
                                    </div>
                                    <Button 
                                        type="button" 
                                        size="sm" 
                                        variant="secondary" 
                                        className="ml-2 h-6 px-2 text-[10px] shrink-0"
                                        onClick={() => {
                                            handleChange('branchId', branch.id);
                                            handleChange('areaId', undefined); 
                                            setRecommendedBranches([]); 
                                            toast.success(`Cabang ${branch.name} dipilih`);
                                        }}
                                    >
                                        Pilih
                                    </Button>
                                </div>
                            </Alert>
                        ))}
                    </div>
                 )}
               </div>
              </div>
            </FormSection>

            <FormSection title="Layanan & Jadwal" description="Atur tanggal, jam, layanan, unit, dan harga.">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
               <div className="space-y-2">
                 <RequiredLabel>Tanggal Service</RequiredLabel>
                 <Input 
                    type="date" 
                    value={formData.serviceDate || ''} 
                    onChange={(e) => handleChange('serviceDate', e.target.value)}
                    disabled={!canEdit('serviceDate')}
                 />
               </div>

               <div className="space-y-2">
                 <RequiredLabel>Jam</RequiredLabel>
                 <Select 
                    value={formData.serviceTime || ''} 
                    onValueChange={(val) => handleChange('serviceTime', val)}
                    disabled={!canEdit('serviceTime')}
                 >
                    <SelectTrigger className={!formData.serviceTime ? "text-slate-500" : ""}>
                        <span className="text-slate-500"><Loader2 className="w-3 h-3 opacity-0" /></span> 
                        <SelectValue placeholder="--:--" />
                    </SelectTrigger>
                    <SelectContent className="max-h-[300px]">
                        {AVAILABLE_TIME_SLOTS.map(time => (
                            <SelectItem key={time} value={time}>{time}</SelectItem>
                        ))}
                    </SelectContent>
                 </Select>
               </div>

               <div className="space-y-2">
                 <RequiredLabel>Layanan</RequiredLabel>
                 <Select 
                   value={formData.serviceId} 
                   onValueChange={(val) => {
                      const selectedService = services.find(s => s.id === val);
                      setFormData(prev => ({ 
                        ...prev, 
                        serviceId: val,
                        price: selectedService ? selectedService.price : prev.price
                      }));
                      setIsDirty(true);
                   }}
                   disabled={!canEdit('serviceId')}
                 >
                   <SelectTrigger><SelectValue placeholder="Pilih Layanan" /></SelectTrigger>
                   <SelectContent>
                     {services.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                   </SelectContent>
                 </Select>
               </div>

               <div className="space-y-2">
                 <RequiredLabel>Jenis Layanan</RequiredLabel>
                 <Select 
                   value={formData.serviceCategory} 
                   onValueChange={(val) => handleChange('serviceCategory', val)}
                   disabled={!canEdit('serviceCategory')}
                 >
                   <SelectTrigger><SelectValue placeholder="Pilih Jenis" /></SelectTrigger>
                   <SelectContent>
                     <SelectItem value="Visit">Visit</SelectItem>
                     <SelectItem value="Home Service">Home Service</SelectItem>
                   </SelectContent>
                 </Select>
               </div>

               <div className="md:col-span-2 grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                     <Label>Tipe Mobil</Label>
                     <Popover open={openVehicle} onOpenChange={setOpenVehicle}>
                       <PopoverTrigger asChild>
                         <Button
                           type="button"
                           variant="outline"
                           role="combobox"
                           aria-expanded={openVehicle}
                           disabled={!canEdit('vehicleId')}
                           className="w-full justify-between bg-white font-normal dark:bg-slate-800"
                         >
                           <span className={cn("truncate", !formData.vehicleId && "text-slate-500")}>
                             {formData.vehicleId
                               ? vehicles.find((vehicle) => vehicle.id === formData.vehicleId)?.name || "Pilih Mobil"
                               : "Pilih Mobil"}
                           </span>
                           <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                         </Button>
                       </PopoverTrigger>
                       <PopoverContent className="z-[1000] w-[--radix-popover-trigger-width] p-0" align="start">
                         <Command>
                           <CommandInput placeholder="Cari mobil..." />
                           <CommandList className="max-h-[320px]">
                             <CommandEmpty>Mobil tidak ditemukan.</CommandEmpty>
                             <CommandGroup>
                               <CommandItem
                                 value="tanpa tipe mobil"
                                 onSelect={() => {
                                   handleChange('vehicleId', undefined);
                                   setOpenVehicle(false);
                                 }}
                               >
                                 <Check
                                   className={cn(
                                     "mr-2 h-4 w-4",
                                     !formData.vehicleId ? "opacity-100" : "opacity-0",
                                   )}
                                 />
                                 Tanpa tipe mobil
                               </CommandItem>
                               {vehicles.map((vehicle) => (
                                 <CommandItem
                                   key={vehicle.id}
                                   value={vehicle.name}
                                   onSelect={() => {
                                     handleChange('vehicleId', vehicle.id);
                                     setOpenVehicle(false);
                                   }}
                                 >
                                   <Check
                                     className={cn(
                                       "mr-2 h-4 w-4",
                                       formData.vehicleId === vehicle.id ? "opacity-100" : "opacity-0",
                                     )}
                                   />
                                   {vehicle.name}
                                 </CommandItem>
                               ))}
                             </CommandGroup>
                           </CommandList>
                         </Command>
                       </PopoverContent>
                     </Popover>
                  </div>
                  <div className="space-y-2">
                     <Label>Jumlah Unit</Label>
                     <Select 
                        value={String(formData.units || 1)} 
                        onValueChange={(val) => handleChange('units', parseInt(val))}
                        disabled={!canEdit('units')}
                     >
                        <SelectTrigger className="bg-white dark:bg-slate-800">
                           <SelectValue placeholder="1 Unit" />
                        </SelectTrigger>
                        <SelectContent>
                           {[1,2,3,4,5,6,7].map(num => (
                              <SelectItem key={num} value={String(num)}>{num} Unit</SelectItem>
                           ))}
                        </SelectContent>
                     </Select>
                  </div>
               </div>

               <div className="md:col-span-2 space-y-2">
                 <RequiredLabel>Harga</RequiredLabel>
                 <Input 
                    type="text"
                    value={formData.price !== undefined && formData.price !== null && Number.isFinite(Number(formData.price)) ? Number(formData.price).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".") : ''}
                    onChange={(e) => {
                      const rawValue = e.target.value.replace(/\./g, '').replace(/[^0-9]/g, '');
                      handleChange('price', rawValue ? parseInt(rawValue, 10) : undefined);
                    }}
                    disabled={!canEdit('price')}
                    placeholder="Rp 0"
                    className="font-bold"
                 />
               </div>
              </div>
            </FormSection>

            <FormSection title="Operasional" description="Sumber order, PIC, cabang, teknisi, daerah, dan status layanan.">
              <div className="orderFormSourceControls">
                <div className="space-y-2">
                  <RequiredLabel>Customer Service</RequiredLabel>
                  {isCsUser ? (
                    <div className="orderFormLockedField">
                      <span>CS owner</span>
                      <strong>{selectedCsDisplayName}</strong>
                      <small>Terkunci sesuai akun login</small>
                    </div>
                  ) : (
                    <Select
                      value={formData.csId || undefined}
                      onValueChange={handleCsOwnerChange}
                      disabled={!canEdit('csId')}
                    >
                      <SelectTrigger><SelectValue placeholder="Pilih CS Owner" /></SelectTrigger>
                      <SelectContent>
                        {csUsers.map(u => <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  )}
                </div>

                <div className="space-y-2">
                  <RequiredLabel>Sumber Order</RequiredLabel>
                  <Select
                    value={orderSourceMode}
                    onValueChange={(val) => handleOrderSourceModeChange(val as OrderSourceMode)}
                    disabled={!canEditOrderInfo}
                  >
                    <SelectTrigger><SelectValue placeholder="Pilih sumber order" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="organic">Organik</SelectItem>
                      <SelectItem value="repeat_order">Repeat Order</SelectItem>
                      <SelectItem value="paid_ads">Iklan</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="orderFormAdAccountContext" data-tone={adAccountContextText.tone}>
                <div className="orderFormAdAccountCopy">
                  <span>{orderSourceMode === 'paid_ads' ? 'Master Akun Iklan' : 'Sumber Non-Iklan'}</span>
                  <strong>{adAccountContextText.title}</strong>
                  <p>{adAccountContextText.description}</p>
                </div>
                {orderSourceMode === 'paid_ads' ? (
                  <div className="orderFormAdAccountChips" aria-label="Akun iklan order">
                    {selectedAdAccountOption ? (
                      <span title={formatAdAccountContext(selectedAdAccountOption.account)}>
                        {selectedAdAccountOption.account.accountName}
                      </span>
                    ) : hasLeadConversionAttribution ? (
                      <span>Data prospek</span>
                    ) : (
                      <span>{canSelectPaidAdAccount ? `${orderAdAccountOptions.length} akun tersedia` : 'Pilih CS dulu'}</span>
                    )}
                  </div>
                ) : null}
              </div>

              {orderSourceMode === 'paid_ads' ? (
                <>
                  <div className="orderFormAdAccountPicker space-y-2">
                    {hasLeadConversionAttribution && !selectedAdAccountOption ? (
                      <Label>Akun Iklan (Opsional)</Label>
                    ) : (
                      <RequiredLabel>Akun Iklan</RequiredLabel>
                    )}
                    <Select
                      value={selectedAdAccountId || undefined}
                      onValueChange={handleAdAccountSelect}
                      disabled={!canEdit('platformId') || !canSelectPaidAdAccount}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder={canSelectPaidAdAccount ? 'Pilih Akun Iklan' : 'Pilih CS dulu'} />
                      </SelectTrigger>
                      <SelectContent>
                        {orderAdAccountOptions.map((option) => (
                          <SelectItem
                            key={option.account.id}
                            value={option.account.id}
                            disabled={!option.isComplete}
                            textValue={`${option.account.accountName} ${option.platformName} ${option.subChannelName} ${option.advertiserName} ${option.csName}`}
                          >
                            {option.account.accountName} - {option.platformName} / {option.subChannelName} / {option.advertiserName} / {option.csName}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="orderFormAutoAttributionGrid">
                    <div>
                      <span>Platform</span>
                      <strong>{paidAdsAttributionSummary.platformName}</strong>
                    </div>
                    <div>
                      <span>Sub Channel</span>
                      <strong>{paidAdsAttributionSummary.subChannelName}</strong>
                    </div>
                    <div>
                      <span>Advertiser</span>
                      <strong>{paidAdsAttributionSummary.advertiserName}</strong>
                    </div>
                    <div>
                      <span>Customer Service</span>
                      <strong>{paidAdsAttributionSummary.csName}</strong>
                    </div>
                  </div>
                </>
              ) : (
                <>
                  <div className="orderFormAutoAttributionGrid isSourceSummary">
                    <div>
                      <span>Customer Service</span>
                      <strong>{selectedCsDisplayName}</strong>
                    </div>
                    <div>
                      <span>Sumber</span>
                      <strong>{ORDER_SOURCE_MODE_LABEL[orderSourceMode]}</strong>
                    </div>
                    <div>
                      <span>Platform</span>
                      <strong>{selectedSourcePlatform?.name || '-'}</strong>
                    </div>
                    <div>
                      <span>Advertiser</span>
                      <strong>-</strong>
                    </div>
                  </div>

                  {!selectedSourcePlatform && (
                    <div className="orderFormLegacyAttributionGrid grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <RequiredLabel>Platform</RequiredLabel>
                        <Select
                          value={formData.platformId}
                          onValueChange={(val) => handleChange('platformId', val)}
                          disabled={!canEdit('platformId')}
                        >
                          <SelectTrigger><SelectValue placeholder="Pilih Platform" /></SelectTrigger>
                          <SelectContent>
                            {filteredPlatforms.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                  )}
                </>
              )}

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Cabang</Label>
                  <Select 
                    value={formData.branchId} 
                    onValueChange={(val) => {
                      // Only reset dependent fields if branch actually changed
                      if (val !== formData.branchId) {
                          setFormData(prev => ({ ...prev, branchId: val, areaId: undefined, technicianId: undefined }));
                          setIsDirty(true);
                      }
                    }}
                    disabled={!canEdit('branchId')}
                  >
                    <SelectTrigger><SelectValue placeholder="Pilih Cabang" /></SelectTrigger>
                    <SelectContent>
                      {branches.map(b => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>Teknisi</Label>
                  <Select 
                    value={formData.technicianId} 
                    onValueChange={(val) => handleChange('technicianId', val)}
                    disabled={!canEdit('technicianId')}
                  >
                    <SelectTrigger><SelectValue placeholder="Pilih Teknisi" /></SelectTrigger>
                    <SelectContent>
                      {techUsers
                        .filter(u => !formData.branchId || u.branchId === formData.branchId)
                        .map(u => {
                        const schedule = getTechnicianDaySchedule(
                          u.id,
                          formData.serviceDate,
                          technicianSchedules,
                        );
                        const isOff = !!schedule;
                        return (
                          <SelectItem 
                            key={u.id} 
                            value={u.id}
                            disabled={isOff}
                            className={isOff ? "opacity-50 cursor-not-allowed" : ""}
                          >
                            {`${u.name} ${isOff ? `(Sedang ${schedule?.type || 'Libur'})` : ''}`}
                          </SelectItem>
                        );
                      })}
                      {techUsers.filter(u => !formData.branchId || u.branchId === formData.branchId).length === 0 && (
                        <div className="p-2 text-sm text-slate-500 text-center">Tidak ada teknisi di cabang ini</div>
                      )}
                    </SelectContent>
                  </Select>
                  {blockingScheduleMessage && (
                    <div className="mt-2 rounded-md border border-red-200 bg-red-50 p-3 animate-in slide-in-from-top-1">
                      <div className="flex items-start gap-2">
                        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-red-600" />
                        <p className="text-sm font-medium leading-tight text-red-800">
                          {blockingScheduleMessage}
                        </p>
                      </div>
                    </div>
                  )}
                  {!blockingScheduleMessage && inactiveConflictWarning && (
                    <div className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2">
                      <p className="text-xs leading-relaxed text-amber-800">
                        {inactiveConflictWarning}
                      </p>
                    </div>
                  )}
                </div>

                <div className="space-y-2">
                  <Label>Daerah</Label>
                  <Select 
                    value={formData.areaId} 
                    onValueChange={(val) => handleChange('areaId', val)}
                    disabled={!canEdit('areaId')}
                  >
                    <SelectTrigger><SelectValue placeholder="Pilih Daerah" /></SelectTrigger>
                    <SelectContent>
                      {filteredAreas.length > 0 ? (
                        filteredAreas.map(a => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)
                      ) : (
                        <div className="p-2 text-sm text-slate-500 text-center">Tidak ada daerah untuk cabang ini</div>
                      )}
                    </SelectContent>
                  </Select>
                </div>
                
                <div className="space-y-2">
                  <Label>Status Service</Label>
                  <Select 
                    value={formData.status} 
                    onValueChange={handleStatusChange}
                    disabled={!canEdit('status')}
                  >
                    <SelectTrigger><SelectValue placeholder="Pilih Status" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="pending">Terjadwal</SelectItem>
                      <SelectItem value="otw">Otw Jalan</SelectItem>
                      <SelectItem value="working">Pengerjaan</SelectItem>
                      <SelectItem value="qc">Menunggu QC</SelectItem>
                      <SelectItem value="done" disabled={!canMarkOrderDone}>Selesai</SelectItem>
                      <SelectItem value="reschedule">Jadwal Ulang</SelectItem>
                      <SelectItem value="cancelled">Batal</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <OrderStatusReasonFields
                  status={formData.status}
                  cancelReasons={cancelReasons || []}
                  value={formData.cancelReason}
                  note={formData.cancelReasonNote}
                  onReasonChange={(value) => {
                    handleChange('cancelReason', value);
                    if (value !== 'Lainnya') {
                      handleChange('cancelReasonNote', '');
                    }
                  }}
                  onNoteChange={(value) => handleChange('cancelReasonNote', value)}
                  className="col-span-1 animate-in slide-in-from-top-2 md:col-span-2"
                />

                <div className="col-span-1 md:col-span-2 space-y-2">
                   <Label>Catatan</Label>
                   <Textarea 
                      value={formData.notes || ''} 
                      onChange={(e) => handleChange('notes', e.target.value)}
                      disabled={!canEdit('notes')}
                      className="min-h-[80px]"
                   />
                </div>
              </div>
            </FormSection>

            <FormSection title="Pembayaran" description="Metode pembayaran, uang masuk, validasi, dan affiliate.">
               <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Jenis Pembayaran</Label>
	                    <Select
	                      value={formData.paymentType || 'Transfer'}
	                      onValueChange={(val) => {
	                         if (!isOrderPaymentType(val)) return;
	                         handleChange('paymentType', val);
	                         if (val === 'Cash') {
	                            handleChange('paymentMethodId', undefined);
	                         }
                      }}
                      disabled={!canEdit('paymentMethodId')}
                    >
                      <SelectTrigger><SelectValue placeholder="Pilih Jenis" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Transfer">Transfer</SelectItem>
                        <SelectItem value="Cash">Cash</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  {(formData.paymentType === 'Transfer' || !formData.paymentType) && (
                  <div className="space-y-2">
                    <Label>Metode Pembayaran</Label>
                    <Select 
                      value={formData.paymentMethodId} 
                      onValueChange={(val) => handleChange('paymentMethodId', val)}
                      disabled={!canEdit('paymentMethodId')}
                    >
                      <SelectTrigger><SelectValue placeholder="Pilih Metode" /></SelectTrigger>
                      <SelectContent>
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
                  )}

                  <div className="space-y-2">
                    <Label>Uang Masuk</Label>
                    <Input 
                      type="text"
                      value={formData.income ? formData.income.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".") : ''} 
                      onChange={(e) => {
                        const rawValue = e.target.value.replace(/\./g, '').replace(/[^0-9]/g, '');
                        handleChange('income', rawValue ? parseInt(rawValue) : 0);
                      }}
                      disabled={!canEdit('income')}
                      placeholder="Rp"
                    />
                  </div>

	                  <div className="space-y-2">
	                    <Label>Status Pembayaran</Label>
	                    <Select
	                      value={formData.paymentStatus}
	                      onValueChange={(val) => {
	                        if (isOrderPaymentStatus(val)) handleChange('paymentStatus', val);
	                      }}
	                      disabled={!canEdit('paymentStatus')}
                    >
                      <SelectTrigger><SelectValue placeholder="Status Bayar" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Unpaid">Unpaid</SelectItem>
                        <SelectItem value="Paid">Paid</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  
                  <div className="space-y-2">
                    <Label className={canEdit('paymentValidation') ? "text-blue-600 dark:text-blue-400 font-bold" : ""}>
                        Validasi Payment
                    </Label>
	                    <Select
	                      value={formData.paymentValidation}
	                      onValueChange={(val) => {
	                        if (isOrderPaymentValidation(val)) handleChange('paymentValidation', val);
	                      }}
	                      disabled={!canEdit('paymentValidation')}
                    >
                      <SelectTrigger className={canEdit('paymentValidation') ? "border-blue-200 bg-blue-50/50" : ""}><SelectValue placeholder="Validasi" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Pending">Pending</SelectItem>
                        <SelectItem value="Valid">Valid</SelectItem>
                        <SelectItem value="Invalid">Invalid</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label>Affiliate</Label>
                    <Select 
                      value={formData.affiliateName || ''} 
                      onValueChange={(val) => handleChange('affiliateName', val)}
                      disabled={!canEdit('affiliateName')}
                    >
                      <SelectTrigger className="bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700">
                        <SelectValue placeholder="Pilih Affiliate" />
                      </SelectTrigger>
                      <SelectContent className="bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700">
                        {activeAffiliates.map((aff) => (
                          <SelectItem key={aff.id} value={aff.name} className="text-slate-900 dark:text-slate-100 focus:bg-slate-100 dark:focus:bg-slate-800 cursor-pointer">
                            {aff.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
               </div>
            </FormSection>

          </form>
          {submitError && (
            <div className="mx-4 mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium leading-relaxed text-red-800 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-200">
              {submitError}
            </div>
          )}
          </MasterDataDialogBody>

          <DialogFooter className="orderFormFooter masterDataFormActions">
          <Button type="button" variant="outline" onClick={handleClose} disabled={isSubmitting} className="w-full sm:w-auto mt-2 sm:mt-0">Batal</Button>
          <Button type="submit" form="order-form" disabled={isSubmitting} className="bg-blue-600 hover:bg-blue-700 text-white w-full sm:w-auto min-w-[140px]">
            {isSubmitting ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Simpan...</> : "Simpan Pesanan"}
          </Button>
          </DialogFooter>
        </MasterDataFormDialogContent>
      </Dialog>

      <AlertDialog open={showCancelConfirm} onOpenChange={setShowCancelConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Batalkan Perubahan?</AlertDialogTitle>
            <AlertDialogDescription>
              Anda memiliki perubahan yang belum disimpan. Data yang sudah diisi akan hilang jika Anda keluar sekarang.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Kembali</AlertDialogCancel>
            <AlertDialogAction variant="danger"
              onClick={() => { 
                setShowCancelConfirm(false); 
                onClose(); 
              }} 
              className="bg-red-600 hover:bg-red-700 text-white"
            >
              Ya, Batalkan
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};
