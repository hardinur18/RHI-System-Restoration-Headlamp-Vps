import React, { useState, useMemo, useEffect } from 'react';
import {
  Search, Plus, Phone,
  Edit, Trash2, MoreVertical, User as UserIcon, Check, CheckCircle2, ArrowRightCircle, LayoutList, KanbanSquare, Copy, ExternalLink, CalendarClock, Ban, MessageCircle, ChevronLeft, ChevronRight, Eye, RefreshCw, Bell, Tags, Save, Settings2, X
} from 'lucide-react';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Textarea } from '../components/ui/textarea';
import { Checkbox } from '../components/ui/checkbox';
import { Badge } from '../components/ui/badge';
import {
  Dialog, DialogFooter
} from '../components/ui/dialog';
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '../components/ui/tooltip';
import { Tabs, TabsRail, TabsTrigger, TabsViewport } from '../components/ui/tabs';
import { useMasterData } from '@/app/pages/master-data/context';
import { usePermissions } from '@/app/hooks/usePermissions';
import { logActivity } from '@/app/services/auditService';
import {
  isAdminManagementRole,
  isAdvertiserRole,
  isCsRole,
  isOwnerLikeRole,
} from '@/app/data/roleHelpers';
import {
  AdAccountAssignment,
  Lead,
  LeadStatus,
  Order,
  ProspectBooking,
  ProspectLabel,
  User,
  WATemplate,
} from './master-data/data';
import { LeadForm } from './leads/LeadForm';
import { getProspectCrudErrorMessage } from './leads/prospectCrudErrors';
import {
  ALL_FILTER,
  EDITABLE_LEAD_STATUS_OPTIONS,
  LEAD_PAGE_SIZE_OPTIONS,
  MANDATORY_PLATFORM_NAMES,
  ProspectFollowUpFilter,
  buildLeadFollowUpTemplates,
  buildActiveBookingByLeadId,
  buildLatestBookingByLeadId,
  buildProspectFollowUpPlan,
  formatProspectBookingDate,
  formatProspectFollowUpDueDate,
  getLatestTemplateHistory,
  getLeadNotesPreview,
  getTemplateUsageCount,
  getProspectBookingStatusLabel,
  getProspectBookingSummary,
  getProspectStatusBadgeClass,
  isAutoWhatsAppLead,
  normalizeLeadNotes,
  toLocalDateKey,
  uniqueById,
} from './leads/prospectModel';
import {
  AutoWhatsAppLeadBadge,
  LeadMobileSkeleton,
  LeadTableSkeleton,
  WhatsappIcon,
} from './leads/prospectPageUi';
import { OrderForm } from './orders/OrderForm';
import { toast } from 'sonner';
import { copyToClipboard } from '@/lib/clipboard';
import { FoundationDateRangePicker } from '../components/ui/date-range-picker';
import { DateRange } from 'react-day-picker';
import { isWithinInterval, startOfDay, endOfDay } from 'date-fns';
import { getTodayDateKey } from './master-data/dateKeys';
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
  createDataTableColumns,
  DataTable,
  TableActionCell,
  TableActionHeader,
  TableActionMenu,
  TableActionMenuItem,
  TableText,
} from '../components/ui/data-table';
import { MasterDataTableTitle } from '../components/ui/master-data-table-title';
import {
  MasterDataDialogBody,
  MasterDataFormActions,
  MasterDataFormDialogContent,
  MasterDataFormHeader,
  MasterDataFormGrid,
  MasterDataFormField,
  MasterDataFieldLabel,
} from '../components/ui/master-data-ui';
import {
  FoundationDetailField,
  FoundationDetailFieldGrid,
  FoundationDetailHero,
  FoundationDetailMetric,
  FoundationDetailMetricGrid,
  FoundationDetailSection,
  FoundationDetailShell,
} from '../components/ui/detail-view';
import { Switch } from '../components/ui/switch';
import { Skeleton } from '../components/ui/skeleton';
import {
  formatLeadSocialHandle,
  getLeadSocialPlatformLabel,
  getLeadSocialPrimaryActionLabel,
  normalizeLeadSocialFields,
  resolveLeadSocialPrimaryUrl,
} from './leads/socialContact';
import { ProspectBookingForm } from './leads/ProspectBookingForm';
import { FilterRow } from '@/app/components/ui/control-layout';

export const Prospek = ({ onNavigate }: { onNavigate?: (page: string) => void }) => {
  const {
    leads,
    prospectBookings,
    platforms,
    subChannels,
    vehicles,
    services,
    branches,
    areas,
    adAccounts,
    adAccountAssignments,
    adAccountOwnerAssignments,
    users,
    prospectLabels,
    addLead,
    updateLead,
    deleteLead,
    addProspectLabel,
    updateProspectLabel,
    deleteProspectLabel,
    addProspectBooking,
    updateProspectBooking,
    currentUser,
    currentRole,
    waTemplates,
    isLeadsLoading,
    ensureLeadsForDateRange,
  } = useMasterData();
  const { hasPermission } = usePermissions();
  const leadsInitialLoading = isLeadsLoading && leads.length === 0;
  const [search, setSearch] = useState('');
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<Lead | null>(null);
  const [leadFormInstanceKey, setLeadFormInstanceKey] = useState(0);
  const [isLabelManagerOpen, setIsLabelManagerOpen] = useState(false);
  const [labelTargetLead, setLabelTargetLead] = useState<Lead | null>(null);
  const [labelEditorIds, setLabelEditorIds] = useState<string[]>([]);
  const [editingLabel, setEditingLabel] = useState<ProspectLabel | null>(null);
  const [labelDraft, setLabelDraft] = useState({
    name: '',
    color: '#2563EB',
    description: '',
    status: 'active' as ProspectLabel['status'],
    followUpEnabled: true,
  });
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [forwardLead, setForwardLead] = useState<Lead | null>(null);
  const [bookingLead, setBookingLead] = useState<Lead | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [advertiserFilter, setAdvertiserFilter] = useState<string>('all');
  const [platformFilter, setPlatformFilter] = useState<string>('all');
  const [subChannelFilter, setSubChannelFilter] = useState<string>('all');
  const [csFilter, setCsFilter] = useState<string>('all');
  const [labelFilter, setLabelFilter] = useState<string>('all');
  const [followUpFilter, setFollowUpFilter] = useState<ProspectFollowUpFilter>('all');
  const [dateRange, setDateRange] = useState<DateRange | undefined>({
    from: new Date(),
    to: new Date()
  });
  const [viewMode, setViewMode] = useState<'list' | 'kanban'>('list');
  const [isMobileFilterExpanded, setIsMobileFilterExpanded] = useState(false);
  const [isDateRangeLoading, setIsDateRangeLoading] = useState(false);

  // Pagination & Selection State
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(50);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showSelection, setShowSelection] = useState(false);

  // Bulk Edit State
  const [isBulkEditOpen, setIsBulkEditOpen] = useState(false);
  const [bulkField, setBulkField] = useState<string>('');
  const [bulkValue, setBulkValue] = useState<string>('');

  // WA Template Selection State
  const [selectedWaLead, setSelectedWaLead] = useState<Lead | null>(null);
  const [detailLead, setDetailLead] = useState<Lead | null>(null);
  const leadDetailBodyRef = React.useRef<HTMLDivElement>(null);
  const leadTableDragRef = React.useRef({
    active: false,
    dragging: false,
    leadId: null as string | null,
    pointerId: null as number | null,
    scrollLeft: 0,
    startX: 0,
  });
  const suppressLeadTableClickRef = React.useRef(false);
  const deleteLeadTarget = useMemo(
    () => (deleteId ? leads.find((lead) => lead.id === deleteId) || null : null),
    [deleteId, leads],
  );

  useEffect(() => {
    if (!detailLead) return;

    window.requestAnimationFrame(() => {
      leadDetailBodyRef.current?.scrollTo({ top: 0, left: 0, behavior: 'auto' });
    });
  }, [detailLead?.id]);

  const activePlatforms = useMemo(() => platforms.filter(p => p.status === 'active'), [platforms]);
  const activeVehicles = useMemo(() => vehicles.filter(v => v.status === 'active'), [vehicles]);
  const advertiserUsers = useMemo(() => users.filter((u) => isAdvertiserRole(u.role) && u.status === 'active'), [users]);
  const csUsers = useMemo(() => users.filter((u) => isCsRole(u.role) && u.status === 'active'), [users]);
  const isAdvertiserView = isAdvertiserRole(currentRole);
  const isAdminManagementUser = isAdminManagementRole(currentRole);
  const isOwnerLikeUser = isOwnerLikeRole(currentRole);
  const isCsUser = isCsRole(currentRole);
  const todayKey = getTodayDateKey();
  const bulkStatusOptions = useMemo(
    () => (isOwnerLikeUser ? [...EDITABLE_LEAD_STATUS_OPTIONS, 'Closing' as LeadStatus] : EDITABLE_LEAD_STATUS_OPTIONS),
    [isOwnerLikeUser],
  );

  const isActiveAdAssignment = React.useCallback(
    (assignment: { startDate?: string | null; endDate?: string | null; status?: string | null }) => {
      if (assignment.status && assignment.status !== 'active') return false;
      if (assignment.startDate && assignment.startDate > todayKey) return false;
      if (assignment.endDate && assignment.endDate < todayKey) return false;
      return true;
    },
    [todayKey],
  );

  const activeAdAccounts = useMemo(
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

  const getAccountAdvertiserId = React.useCallback(
    (account: (typeof adAccounts)[number]) => activeOwnerByAccountId.get(account.id) || account.advertiserId,
    [activeOwnerByAccountId],
  );

  const isMandatoryPlatform = React.useCallback(
    (platformId?: string) => {
      if (!platformId) return false;
      const platform = platforms.find((item) => item.id === platformId);
      return Boolean(platform && MANDATORY_PLATFORM_NAMES.includes(platform.name.toLowerCase()));
    },
    [platforms],
  );

  const getScopedAdAccounts = React.useCallback(
    (scope?: { advertiserId?: string; platformId?: string; subChannelId?: string; csId?: string }) => {
      let accounts = activeAdAccounts;

      if (isAdvertiserView && currentUser) {
        accounts = accounts.filter((account) => getAccountAdvertiserId(account) === currentUser.id);
      } else if (isCsUser && currentUser) {
        accounts = accounts.filter((account) =>
          (activeCsAssignmentsByAccountId.get(account.id) || []).some((assignment) => assignment.csId === currentUser.id),
        );
      }

      if (scope?.advertiserId && scope.advertiserId !== ALL_FILTER) {
        accounts = accounts.filter((account) => getAccountAdvertiserId(account) === scope.advertiserId);
      }

      if (scope?.platformId && scope.platformId !== ALL_FILTER) {
        accounts = accounts.filter((account) => account.platformId === scope.platformId);
      }

      if (scope?.subChannelId && scope.subChannelId !== ALL_FILTER) {
        accounts = accounts.filter((account) =>
          account.subChannelId === scope.subChannelId ||
          (activeCsAssignmentsByAccountId.get(account.id) || []).some((assignment) => assignment.subChannelId === scope.subChannelId),
        );
      }

      if (scope?.csId && scope.csId !== ALL_FILTER) {
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
      isAdvertiserView,
      isCsUser,
    ],
  );

  const isPlatformAllowedForLead = React.useCallback(
    (lead: Lead, platformId?: string, advertiserId = lead.advertiserId) => {
      if (!platformId) return true;
      if (isMandatoryPlatform(platformId)) return true;
      if (!advertiserId) return activePlatforms.some((platform) => platform.id === platformId);

      if (getScopedAdAccounts({ advertiserId, platformId }).length > 0) return true;

      return activeAdAccounts.length === 0 && activePlatforms.some((platform) => platform.id === platformId);
    },
    [activeAdAccounts.length, activePlatforms, getScopedAdAccounts, isMandatoryPlatform],
  );

  const isSubChannelAllowedForLead = React.useCallback(
    (lead: Lead, subChannelId?: string, platformId = lead.platformId, advertiserId = lead.advertiserId) => {
      if (!subChannelId) return true;
      const subChannel = subChannels.find((item) => item.id === subChannelId);
      if (!subChannel || subChannel.status !== 'active') return false;
      if (platformId && subChannel.platformId !== platformId) return false;
      if (isMandatoryPlatform(platformId)) return true;
      if (!advertiserId) return true;

      const matchingAccounts = getScopedAdAccounts({ advertiserId, platformId, subChannelId });
      if (matchingAccounts.length > 0) return true;

      return activeAdAccounts.length === 0;
    },
    [activeAdAccounts.length, getScopedAdAccounts, isMandatoryPlatform, subChannels],
  );

  const isCsAllowedForLead = React.useCallback(
    (lead: Lead, csId?: string, platformId = lead.platformId, subChannelId = lead.subChannelId, advertiserId = lead.advertiserId) => {
      if (!csId) return true;
      if (!csUsers.some((user) => user.id === csId)) return false;
      if (isCsUser && currentUser) return csId === currentUser.id;
      if (!advertiserId || isMandatoryPlatform(platformId)) return true;

      const matchingAccounts = getScopedAdAccounts({ advertiserId, platformId, subChannelId });
      const assignedCsIds = new Set<string>();
      matchingAccounts.forEach((account) => {
        (activeCsAssignmentsByAccountId.get(account.id) || []).forEach((assignment) => {
          if (assignment.csId) assignedCsIds.add(assignment.csId);
        });
      });
      if (assignedCsIds.size > 0) return assignedCsIds.has(csId);

      return activeAdAccounts.length === 0;
    },
    [activeAdAccounts.length, activeCsAssignmentsByAccountId, csUsers, currentUser, getScopedAdAccounts, isCsUser, isMandatoryPlatform],
  );

  // --- ROLE BASED DATA VISIBILITY ---
  const roleBasedLeads = useMemo(() => {
    if (!currentUser) return [];
    if (isAdminManagementUser) return leads;
    if (isCsUser) return leads.filter(l => l.csId === currentUser.id);
    if (isAdvertiserView) {
        const subordinateCsIds = users.filter(u => u.parentUserId === currentUser.id).map(u => u.id);
        return leads.filter(l => l.advertiserId === currentUser.id || (l.csId && subordinateCsIds.includes(l.csId)));
    }
    return []; 
  }, [currentUser, isAdminManagementUser, isAdvertiserView, isCsUser, leads, users]);

  const sortedProspectLabels = useMemo(
    () => [...prospectLabels].sort((left, right) => {
      const sortDelta = (left.sortOrder || 0) - (right.sortOrder || 0);
      if (sortDelta !== 0) return sortDelta;
      return left.name.localeCompare(right.name, 'id-ID', { sensitivity: 'base' });
    }),
    [prospectLabels],
  );

  const activeProspectLabels = useMemo(
    () => sortedProspectLabels.filter((label) => label.status === 'active'),
    [sortedProspectLabels],
  );

  const prospectLabelById = useMemo(
    () => new Map(prospectLabels.map((label) => [label.id, label])),
    [prospectLabels],
  );

  const prospectLabelUsageCount = useMemo(() => {
    const counts = new Map<string, number>();
    leads.forEach((lead) => {
      (lead.labels || []).forEach((labelId) => {
        counts.set(labelId, (counts.get(labelId) || 0) + 1);
      });
    });
    return counts;
  }, [leads]);

  const getProspectLabelName = (labelId: string) =>
    prospectLabelById.get(labelId)?.name || labelId;

  const getProspectLabelStyle = (labelId: string) => {
    const color = prospectLabelById.get(labelId)?.color;
    return color ? { borderColor: `${color}55`, color } : undefined;
  };

  // --- DYNAMIC FILTERS (Based on Actual Data) ---
  const availableAdvertisers = useMemo(() => {
      const uniqueIds = new Set(roleBasedLeads.map(l => l.advertiserId).filter(Boolean));
      return users.filter(u => uniqueIds.has(u.id));
  }, [roleBasedLeads, users]);

  const availablePlatforms = useMemo(() => {
      const uniqueIds = new Set(roleBasedLeads.map(l => l.platformId).filter(Boolean));
      return platforms.filter(p => uniqueIds.has(p.id));
  }, [roleBasedLeads, platforms]);

  const availableSubChannels = useMemo(() => {
      const uniqueIds = new Set(roleBasedLeads.map(l => l.subChannelId).filter(Boolean));
      let relevant = subChannels.filter(sc => uniqueIds.has(sc.id));
      if (platformFilter !== 'all') {
          relevant = relevant.filter(sc => sc.platformId === platformFilter);
      }
      return relevant;
  }, [roleBasedLeads, subChannels, platformFilter]);

  const availableCS = useMemo(() => {
      const uniqueIds = new Set(roleBasedLeads.map(l => l.csId).filter(Boolean));
      return users.filter(u => uniqueIds.has(u.id));
  }, [roleBasedLeads, users]);

  const availableLabels = useMemo(() => {
    const usedLabelIds = new Set<string>();
    roleBasedLeads.forEach((lead) => {
      (lead.labels || []).forEach((labelId) => usedLabelIds.add(labelId));
    });
    return activeProspectLabels.filter((label) => usedLabelIds.has(label.id));
  }, [activeProspectLabels, roleBasedLeads]);

  // Prospek only shows templates from the Prospek/Leads category.
  const leadTemplates = useMemo(() => {
      return buildLeadFollowUpTemplates(waTemplates);
  }, [waTemplates]);

  const followUpPlanByLeadId = useMemo(() => {
    const map = new Map<string, ReturnType<typeof buildProspectFollowUpPlan>>();
    roleBasedLeads.forEach((lead) => {
      map.set(lead.id, buildProspectFollowUpPlan(lead, leadTemplates));
    });
    return map;
  }, [leadTemplates, roleBasedLeads]);

  const latestBookingByLeadId = useMemo(
    () => buildLatestBookingByLeadId(prospectBookings),
    [prospectBookings],
  );

  const activeBookingByLeadId = useMemo(
    () => buildActiveBookingByLeadId(prospectBookings),
    [prospectBookings],
  );

  const getPlatformName = (id?: string) => {
    if (!id) return '-';
    return platforms.find(p => p.id === id)?.name || '-';
  };

  const getVehicleName = (id?: string) => {
    if (!id) return '-';
    return vehicles.find(v => v.id === id)?.name || '-';
  };

  const getServiceName = (id?: string) => {
    if (!id) return '-';
    return services.find(service => service.id === id)?.name || '-';
  };

  const getBranchName = (id?: string) => {
    if (!id) return '-';
    return branches.find(branch => branch.id === id)?.name || '-';
  };

  const getAreaName = (id?: string) => {
    if (!id) return '-';
    return areas.find(area => area.id === id)?.name || '-';
  };

  const getCSName = (id?: string) => {
    if (!id) return '-';
    return users.find(u => u.id === id)?.name || 'Unknown';
  }

  const getSubChannelName = (id?: string) => {
    if (!id) return '-';
    return subChannels.find(sc => sc.id === id)?.name || '-';
  };

  const getLeadBooking = (leadId: string) => latestBookingByLeadId.get(leadId);
  const getActiveLeadBooking = (leadId: string) => activeBookingByLeadId.get(leadId);

  const getBookingSummary = (leadId: string) => {
    return getProspectBookingSummary(getLeadBooking(leadId));
  };

  const formatBookingDate = formatProspectBookingDate;

  const getBookingStatusLabel = getProspectBookingStatusLabel;

  const buildProspectLabelSlug = (name: string) => {
    const slug = name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
    return slug || `label-${Date.now()}`;
  };

  const resetLabelDraft = () => {
    setEditingLabel(null);
    setLabelDraft({
      name: '',
      color: '#2563EB',
      description: '',
      status: 'active',
      followUpEnabled: true,
    });
  };

  const openEditProspectLabel = (label: ProspectLabel) => {
    setEditingLabel(label);
    setLabelDraft({
      name: label.name,
      color: label.color || '#2563EB',
      description: label.description || '',
      status: label.status,
      followUpEnabled: label.followUpEnabled,
    });
  };

  const handleSaveProspectLabel = async () => {
    const name = labelDraft.name.trim();
    if (!name) {
      toast.error('Nama label wajib diisi');
      return;
    }

    const slug = editingLabel?.slug || buildProspectLabelSlug(name);
    const duplicate = prospectLabels.some((label) =>
      label.id !== editingLabel?.id &&
      (label.name.trim().toLowerCase() === name.toLowerCase() || label.slug.toLowerCase() === slug.toLowerCase())
    );
    if (duplicate) {
      toast.error('Nama label sudah ada');
      return;
    }

    const payload: ProspectLabel = {
      id: editingLabel?.id || crypto.randomUUID(),
      name,
      slug,
      color: labelDraft.color || '#2563EB',
      description: labelDraft.description.trim() || null,
      status: labelDraft.status,
      followUpEnabled: labelDraft.followUpEnabled,
      sortOrder: editingLabel?.sortOrder ?? prospectLabels.length + 1,
      createdAt: editingLabel?.createdAt,
      updatedAt: new Date().toISOString(),
    };

    if (editingLabel) {
      await updateProspectLabel(payload);
    } else {
      await addProspectLabel(payload);
    }
    resetLabelDraft();
  };

  const handleArchiveProspectLabel = async (label: ProspectLabel) => {
    await updateProspectLabel({ ...label, status: 'inactive', updatedAt: new Date().toISOString() });
  };

  const handleDeleteProspectLabel = async (label: ProspectLabel) => {
    const usageCount = prospectLabelUsageCount.get(label.id) || 0;
    if (usageCount > 0) {
      await handleArchiveProspectLabel(label);
      toast.info(`Label dipakai ${usageCount} prospek, jadi dinonaktifkan agar histori tetap aman.`);
      return;
    }
    await deleteProspectLabel(label.id);
    if (editingLabel?.id === label.id) resetLabelDraft();
  };

  const openBookingForm = (lead: Lead) => {
    if (!canManageLeadBooking(lead)) {
      toast.error('Anda tidak memiliki akses untuk mengelola booking prospek ini');
      return;
    }

    if (lead.status === 'Closing') {
      toast.info('Prospek yang sudah Closing tidak bisa dibuat booking lagi');
      return;
    }
    setBookingLead(lead);
  };

  const openAddLeadForm = () => {
    setEditingItem(null);
    setLeadFormInstanceKey(prev => prev + 1);
    setIsAddOpen(true);
  };

  const openEditLeadForm = (lead: Lead) => {
    setEditingItem(lead);
    setLeadFormInstanceKey(prev => prev + 1);
    setIsAddOpen(true);
  };

  const openLeadLabelEditor = (lead: Lead) => {
    if (!canEditLead(lead)) {
      toast.error('Anda tidak memiliki akses untuk mengubah label prospek ini');
      return;
    }
    setLabelTargetLead(lead);
    setLabelEditorIds([...(lead.labels || [])]);
  };

  const closeLeadLabelEditor = () => {
    setLabelTargetLead(null);
    setLabelEditorIds([]);
  };

  const toggleLeadLabel = (labelId: string) => {
    setLabelEditorIds((current) => {
      if (current.includes(labelId)) return current.filter((id) => id !== labelId);
      return [...current, labelId].slice(0, 6);
    });
  };

  const handleSaveLeadLabels = async () => {
    if (!labelTargetLead) return;
    try {
      await Promise.resolve(updateLead({
        ...labelTargetLead,
        labels: labelEditorIds,
      }));
      toast.success('Label prospek berhasil diperbarui');
      closeLeadLabelEditor();
    } catch (error: any) {
      toast.error('Label prospek gagal disimpan', {
        description: getProspectCrudErrorMessage(error),
      });
    }
  };

  const handleAddSheetOpenChange = (open: boolean) => {
    setIsAddOpen(open);
    if (!open) {
      setEditingItem(null);
    }
  };

  const getLeadSocialHandle = (lead: Lead) => formatLeadSocialHandle(lead.socialUsername);

  const getLeadSocialUrl = (lead: Lead) => resolveLeadSocialPrimaryUrl(lead);

  const resetLeadTableDrag = (target: HTMLDivElement, pointerId?: number) => {
    if (pointerId !== undefined && target.hasPointerCapture?.(pointerId)) {
      target.releasePointerCapture(pointerId);
    }
    target.removeAttribute('data-dragging');
    leadTableDragRef.current.active = false;
    leadTableDragRef.current.dragging = false;
    leadTableDragRef.current.leadId = null;
    leadTableDragRef.current.pointerId = null;
  };

  const openLeadDetail = (lead: Lead) => {
    setDetailLead(lead);
  };

  const isLeadRowInteractiveTarget = (target: EventTarget | null) => {
    return target instanceof HTMLElement && Boolean(
      target.closest('button, a, input, textarea, select, [data-slot="checkbox"], [role="menuitem"]'),
    );
  };

  const handleLeadRowClick = (event: React.MouseEvent<HTMLTableRowElement>, lead: Lead) => {
    if (isLeadRowInteractiveTarget(event.target)) return;

    if (suppressLeadTableClickRef.current || leadTableDragRef.current.dragging) {
      event.preventDefault();
      event.stopPropagation();
      suppressLeadTableClickRef.current = false;
      return;
    }

    openLeadDetail(lead);
  };

  const handleLeadRowKeyDown = (event: React.KeyboardEvent<HTMLTableRowElement>, lead: Lead) => {
    if (isLeadRowInteractiveTarget(event.target)) return;

    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      openLeadDetail(lead);
    }
  };

  const handleLeadTableClickCapture = (event: React.MouseEvent<HTMLDivElement>) => {
    if (isLeadRowInteractiveTarget(event.target)) return;

    if (suppressLeadTableClickRef.current || leadTableDragRef.current.dragging) {
      event.preventDefault();
      event.stopPropagation();
      suppressLeadTableClickRef.current = false;
      return;
    }

    const target = event.target;
    const row = target instanceof HTMLElement
      ? target.closest<HTMLTableRowElement>('tr[data-lead-id]')
      : null;
    const leadId = row?.dataset.leadId;
    if (!leadId) return;

    const lead = roleBasedLeads.find((item) => item.id === leadId);
    if (!lead) return;

    event.stopPropagation();
    openLeadDetail(lead);
  };

  const handleLeadTablePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;

    const target = event.target as HTMLElement;
    if (target.closest('button, a, input, textarea, select, [data-slot="checkbox"], [role="menuitem"]')) {
      return;
    }
    const leadId = target.closest<HTMLTableRowElement>('tr[data-lead-id]')?.dataset.leadId || null;

    const scroller = event.currentTarget;
    if (scroller.scrollWidth <= scroller.clientWidth) {
      leadTableDragRef.current.leadId = leadId;
      return;
    }

    suppressLeadTableClickRef.current = false;
    leadTableDragRef.current = {
      active: true,
      dragging: false,
      leadId,
      pointerId: event.pointerId,
      scrollLeft: scroller.scrollLeft,
      startX: event.clientX,
    };
    scroller.setPointerCapture?.(event.pointerId);
  };

  const handleLeadTablePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = leadTableDragRef.current;
    if (!drag.active || drag.pointerId !== event.pointerId) return;

    const deltaX = event.clientX - drag.startX;
    if (Math.abs(deltaX) > 8) {
      drag.dragging = true;
      suppressLeadTableClickRef.current = true;
      event.currentTarget.setAttribute('data-dragging', 'true');
      event.preventDefault();
      event.currentTarget.scrollLeft = drag.scrollLeft - deltaX;
    }
  };

  const handleLeadTablePointerEnd = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = leadTableDragRef.current;
    if (!drag.active || drag.pointerId !== event.pointerId) return;

    if (drag.dragging) {
      suppressLeadTableClickRef.current = true;
      window.setTimeout(() => {
        suppressLeadTableClickRef.current = false;
      }, 0);
    } else if (drag.leadId) {
      const lead = roleBasedLeads.find((item) => item.id === drag.leadId);
      if (lead) {
        event.preventDefault();
        event.stopPropagation();
        openLeadDetail(lead);
      }
    }
    resetLeadTableDrag(event.currentTarget, event.pointerId);
  };

  const handleLeadSocialOpen = (lead: Lead) => {
    const targetUrl = getLeadSocialUrl(lead);

    if (!targetUrl) {
      toast.error('Kontak sosial belum lengkap', {
        description: 'Isi username atau link sosial buyer terlebih dahulu.',
      });
      return;
    }

    window.open(targetUrl, '_blank', 'noopener,noreferrer');
  };

  const handleLeadSocialCopy = async (lead: Lead) => {
    const handle = getLeadSocialHandle(lead);

    if (!handle) {
      toast.error('Username sosial belum tersedia');
      return;
    }

    await copyToClipboard(handle, {
      successMessage: 'Username sosial berhasil disalin',
      description: getLeadSocialPlatformLabel(lead.socialPlatform) || 'Kontak sosial buyer',
    });
  };

  // --- WA LOGIC ---
  const handleWhatsappClick = async (lead: Lead, template?: WATemplate) => {
    const phone = lead.phone.replace(/^0/, '62').replace(/\D/g, '');
    let message = "";
    let pendingWindow: Window | null = null;

    if (template) {
        message = template.message;
        message = message.replace(/\[Nama\]/g, lead.name);
        const vehicleName = getVehicleName(lead.vehicleId);
        message = message.replace(/\[Mobil\]/g, vehicleName !== '-' ? vehicleName : 'mobil');
        message = message.replace(/\[Order ID\]/g, `\`\`\`${lead.id}\`\`\``);
        
        const newHistory = {
            templateId: template.id,
            templateName: template.title,
            sentAt: new Date().toISOString(),
            sentBy: currentUser?.id
        };
        
        const updatedLead = {
            ...lead,
            templateHistory: [...(lead.templateHistory || []), newHistory],
            lastContact: 'Baru saja'
        };
        pendingWindow = window.open('', '_blank');
        if (pendingWindow) {
          pendingWindow.opener = null;
        }

        try {
          await Promise.resolve(updateLead(updatedLead));

          setDetailLead((current) => (current?.id === lead.id ? updatedLead : current));
          setSelectedWaLead((current) => (current?.id === lead.id ? updatedLead : current));
        } catch (error: any) {
          pendingWindow?.close();
          toast.error('Gagal mencatat follow up WhatsApp', {
            description: error?.message || 'Coba ulang beberapa detik lagi.',
          });
          return;
        }
    }

    const url = `https://wa.me/${phone}${message ? `?text=${encodeURIComponent(message)}` : ''}`;
    if (pendingWindow) {
      pendingWindow.location.href = url;
    } else {
      window.open(url, '_blank', 'noopener,noreferrer');
    }
  };

  const isTemplateUsed = (lead: Lead, templateId: string) => {
      return lead.templateHistory?.some(h => h.templateId === templateId);
  };

  const formatTemplateSentAt = (sentAt?: string) => {
    if (!sentAt) return '';
    try {
      return new Date(sentAt).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' });
    } catch {
      return sentAt;
    }
  };

  const getTemplateSenderName = (sentBy?: string) => {
    if (!sentBy) return '-';
    return users.find((user) => user.id === sentBy)?.name || '-';
  };

  const visibleFollowUpTemplates = leadTemplates.slice(0, 6);
  const hiddenFollowUpTemplateCount = Math.max(leadTemplates.length - visibleFollowUpTemplates.length, 0);
  const canSendLeadTemplate = hasPermission('leads.edit') && !isAdvertiserView && (isAdminManagementUser || isCsUser || isOwnerLikeUser);

  const getLeadFollowUpPlan = (lead: Lead) =>
    followUpPlanByLeadId.get(lead.id) || buildProspectFollowUpPlan(lead, leadTemplates);

  const getFollowUpPlanBadgeClass = (lead: Lead) => {
    const plan = getLeadFollowUpPlan(lead);
    if (plan.isOverdue) return 'border-red-200 bg-red-50 text-red-700';
    if (plan.isDueToday) return 'border-amber-200 bg-amber-50 text-amber-700';
    if (plan.isUpcoming) return 'border-blue-200 bg-blue-50 text-blue-700';
    if (plan.isCompleted) return 'border-emerald-200 bg-emerald-50 text-emerald-700';
    return 'border-slate-200 bg-slate-50 text-slate-600';
  };

  const getFollowUpPlanLabel = (lead: Lead) => {
    const plan = getLeadFollowUpPlan(lead);
    if (plan.isCompleted) return 'FU selesai';
    if (!plan.nextStep || !plan.nextTemplate) return 'Tanpa plan';
    if (plan.isOverdue) return `FU ${plan.nextStep} terlambat`;
    if (plan.isDueToday) return `FU ${plan.nextStep} hari ini`;
    return `FU ${plan.nextStep} ${formatProspectFollowUpDueDate(plan.dueDate)}`;
  };

  const getFollowUpPlanShortLabel = (lead: Lead) => {
    const plan = getLeadFollowUpPlan(lead);
    if (plan.isCompleted) return 'Selesai';
    if (!plan.nextStep || !plan.nextTemplate) return '-';
    return `FU ${plan.nextStep}`;
  };

  // --- PERMISSION LOGIC ---
  const canEditLead = (lead: Lead) => {
    if (!hasPermission('leads.edit')) return false;
    if (lead.status === 'Closing' && !isOwnerLikeUser) return false;
    return roleBasedLeads.some(item => item.id === lead.id);
  };

  const canDeleteLead = (lead: Lead) => {
    if (!hasPermission('leads.delete')) return false;
    if (lead.status === 'Closing' && !isOwnerLikeUser) return false;
    return roleBasedLeads.some(item => item.id === lead.id);
  };

  const canManageLeadBooking = (lead: Lead) => canEditLead(lead);

  const canForwardLeadToOrder = (lead: Lead) => {
    if (!hasPermission('order.create')) return false;
    if (lead.status === 'Closing') return false;
    return canEditLead(lead);
  };

  const selectedEditableLeads = useMemo(
    () => roleBasedLeads.filter((lead) => selectedIds.has(lead.id) && canEditLead(lead)),
    [roleBasedLeads, selectedIds, hasPermission, isOwnerLikeUser],
  );

  const selectedDeletableLeads = useMemo(
    () => roleBasedLeads.filter((lead) => selectedIds.has(lead.id) && canDeleteLead(lead)),
    [roleBasedLeads, selectedIds, hasPermission, isOwnerLikeUser],
  );

  const bulkAdvertiserOptions = useMemo(() => {
    const advertiserIds = new Set(getScopedAdAccounts().map(getAccountAdvertiserId).filter(Boolean));
    const accountAdvertisers = advertiserUsers.filter((user) => advertiserIds.has(user.id));
    return accountAdvertisers.length > 0 ? accountAdvertisers : advertiserUsers;
  }, [advertiserUsers, getAccountAdvertiserId, getScopedAdAccounts]);

  const bulkPlatformOptions = useMemo(() => {
    const platformIds = new Set(getScopedAdAccounts().map((account) => account.platformId).filter(Boolean));
    const accountPlatforms = activePlatforms.filter((platform) => platformIds.has(platform.id));
    const mandatoryPlatforms = activePlatforms.filter((platform) => isMandatoryPlatform(platform.id));
    const scopedPlatforms = uniqueById([
      ...accountPlatforms,
      ...(isAdvertiserView ? [] : mandatoryPlatforms),
    ]);

    return scopedPlatforms.length > 0 ? scopedPlatforms : activePlatforms;
  }, [activePlatforms, getScopedAdAccounts, isAdvertiserView, isMandatoryPlatform]);

  const bulkSubChannelOptions = useMemo(() => {
    const subChannelIds = new Set<string>();
    getScopedAdAccounts().forEach((account) => {
      if (account.subChannelId) subChannelIds.add(account.subChannelId);
      (activeCsAssignmentsByAccountId.get(account.id) || []).forEach((assignment) => {
        if (assignment.subChannelId) subChannelIds.add(assignment.subChannelId);
      });
    });

    const scopedSubChannels = subChannels.filter((item) => item.status === 'active' && subChannelIds.has(item.id));
    return scopedSubChannels.length > 0
      ? scopedSubChannels
      : subChannels.filter((item) => item.status === 'active');
  }, [activeCsAssignmentsByAccountId, getScopedAdAccounts, subChannels]);

  const bulkCsOptions = useMemo(() => {
    const csIds = new Set<string>();
    getScopedAdAccounts().forEach((account) => {
      (activeCsAssignmentsByAccountId.get(account.id) || []).forEach((assignment) => {
        if (assignment.csId) csIds.add(assignment.csId);
      });
    });

    const accountCsUsers = csUsers.filter((user) => csIds.has(user.id));
    return accountCsUsers.length > 0 ? accountCsUsers : csUsers;
  }, [activeCsAssignmentsByAccountId, csUsers, getScopedAdAccounts]);

  const normalizeLeadAttributionUpdate = React.useCallback(
    (lead: Lead, updates: Partial<Lead>) => {
      const next: Lead = { ...lead, ...updates };

      if (!isPlatformAllowedForLead(lead, next.platformId, next.advertiserId)) {
        next.platformId = undefined;
        next.subChannelId = undefined;
      }

      if (!isSubChannelAllowedForLead(lead, next.subChannelId, next.platformId, next.advertiserId)) {
        next.subChannelId = undefined;
      }

      if (!isCsAllowedForLead(lead, next.csId, next.platformId, next.subChannelId, next.advertiserId)) {
        next.csId = undefined;
      }

      return next;
    },
    [isCsAllowedForLead, isPlatformAllowedForLead, isSubChannelAllowedForLead],
  );

  const isBulkUpdateApplicable = React.useCallback(
    (nextLead: Lead, field: string, value: string) => {
      if (field === 'platformId') return nextLead.platformId === value;
      if (field === 'subChannelId') return nextLead.subChannelId === value;
      if (field === 'csId') return nextLead.csId === value;
      if (field === 'advertiserId') return nextLead.advertiserId === value;
      return true;
    },
    [],
  );
  
  // --- ORDER GENERATION LOGIC ---
  const handleBookingSubmit = async (booking: ProspectBooking) => {
    if (bookingLead && !canManageLeadBooking(bookingLead)) {
      toast.error('Anda tidak memiliki akses untuk mengelola booking prospek ini');
      return;
    }

    if (bookingLead?.status === 'Closing') {
      toast.error('Booking tidak bisa disimpan karena prospek sudah Closing');
      setBookingLead(null);
      return;
    }

    const existingBooking = prospectBookings.find(item => item.id === booking.id);

    try {
      let nextLeadStatus = bookingLead?.status;
      if (bookingLead) {
        if (booking.status === 'cancelled') {
          nextLeadStatus = bookingLead.status === 'Booking' ? 'Pending' : bookingLead.status;
        } else if (bookingLead.status !== 'Booking') {
          nextLeadStatus = 'Booking';
        }
      }

      const nextLeadName = booking.customerName.trim();
      const nextLeadPhone = booking.customerPhone.trim();
      const shouldUpdateLead =
        Boolean(bookingLead) &&
        (
          bookingLead?.name !== nextLeadName ||
          bookingLead?.phone !== nextLeadPhone ||
          bookingLead?.status !== nextLeadStatus
        );

      if (bookingLead && shouldUpdateLead) {
        await Promise.resolve(updateLead({
          ...bookingLead,
          name: nextLeadName,
          phone: nextLeadPhone,
          status: nextLeadStatus || bookingLead.status,
        }));
      }

      if (existingBooking) {
        await updateProspectBooking(booking);
        toast.success('Booking prospek berhasil diperbarui');
      } else {
        await addProspectBooking(booking);
        toast.success('Booking prospek berhasil dibuat');
      }

      setBookingLead(null);
    } catch (error: any) {
      toast.error('Booking prospek gagal disimpan', {
        description: getProspectCrudErrorMessage(error),
      });
    }
  };

  const handleCancelLeadBooking = async (lead: Lead, booking?: ProspectBooking | null) => {
    if (!canManageLeadBooking(lead)) {
      toast.error('Anda tidak memiliki akses untuk membatalkan booking prospek ini');
      return;
    }

    const targetBooking = booking ?? getActiveLeadBooking(lead.id);

    if (!targetBooking) {
      toast.error('Booking aktif tidak ditemukan');
      return;
    }

    if (targetBooking.status === 'cancelled') {
      toast.info('Booking ini sudah dibatalkan');
      if (bookingLead?.id === lead.id) setBookingLead(null);
      return;
    }

    try {
      await updateProspectBooking({
        ...targetBooking,
        status: 'cancelled',
        updatedAt: new Date().toISOString(),
      });

      if (lead.status === 'Booking') {
        await Promise.resolve(updateLead({ ...lead, status: 'Pending' }));
      }

      toast.success('Booking prospek dibatalkan dan dihapus dari jadwal');

      if (bookingLead?.id === lead.id) {
        setBookingLead(null);
      }
    } catch (error: any) {
      toast.error(error?.message || 'Booking prospek gagal dibatalkan');
    }
  };

  const handleOrderSuccess = async (order?: Order) => {
    if (forwardLead) {
      try {
        const activeBooking = getActiveLeadBooking(forwardLead.id);

        if (activeBooking && order?.id) {
          await updateProspectBooking({
            ...activeBooking,
            orderId: order.id,
            status: activeBooking.status === 'cancelled' ? 'cancelled' : 'confirmed',
            updatedAt: new Date().toISOString(),
          });
        }

        await Promise.resolve(updateLead({ ...forwardLead, status: 'Closing' }));
      } catch (error: any) {
        toast.error(error?.message || 'Pesanan dibuat, tapi status prospek belum tersinkron');
      } finally {
        setForwardLead(null);
        if (onNavigate) {
          onNavigate('orders');
        }
      }
    }
  };

  const activeForwardBooking = forwardLead ? getActiveLeadBooking(forwardLead.id) : undefined;
  const selectedLeadBooking = bookingLead ? getActiveLeadBooking(bookingLead.id) : undefined;
  const forwardOrderPrefill = useMemo<Partial<Order> | null>(() => {
    if (!forwardLead) return null;

    const normalizedLead = normalizeLeadAttributionUpdate(forwardLead, {
      advertiserId: activeForwardBooking?.advertiserId || forwardLead.advertiserId,
      platformId: activeForwardBooking?.platformId || forwardLead.platformId,
      subChannelId: activeForwardBooking?.subChannelId || forwardLead.subChannelId,
      csId: activeForwardBooking?.csId || forwardLead.csId,
    });

    return {
      customerName: forwardLead.name,
      customerPhone: forwardLead.phone,
      vehicleId: activeForwardBooking?.vehicleId || forwardLead.vehicleId || '',
      platformId: normalizedLead.platformId || '',
      subChannelId: normalizedLead.subChannelId || '',
      advertiserId: normalizedLead.advertiserId || '',
      csId: normalizedLead.csId || '',
      leadId: forwardLead.id,
      leadDate: forwardLead.timestamp.split('T')[0],
      status: 'pending',
      paymentType: 'Transfer',
      paymentStatus: 'Unpaid',
      paymentValidation: 'Pending',
      serviceDate: activeForwardBooking?.scheduleDate || '',
      serviceTime: activeForwardBooking?.scheduleTime || '',
      branchId: activeForwardBooking?.branchId || '',
      areaId: activeForwardBooking?.areaId || '',
      mapsUrl: activeForwardBooking?.mapsUrl || '',
      address: activeForwardBooking?.address || '',
      technicianId: activeForwardBooking?.technicianId || '',
      serviceId: activeForwardBooking?.serviceId || '',
      notes: [forwardLead.notes, activeForwardBooking?.notes].filter(Boolean).join('\n\n'),
    };
  }, [activeForwardBooking, forwardLead, normalizeLeadAttributionUpdate]);

  // --- FILTERING BASE (All filters EXCEPT Status) ---
  const filteredLeadsBase = useMemo(() => {
    return roleBasedLeads.filter(item => {
      const platformName = getPlatformName(item.platformId);
      const vehicleName = getVehicleName(item.vehicleId);
      const csName = getCSName(item.csId);
      const socialHandle = getLeadSocialHandle(item);
      const socialPlatformLabel = getLeadSocialPlatformLabel(item.socialPlatform);
      const socialSearchableLink = [item.socialProfileUrl, item.socialChatUrl].filter(Boolean).join(' ');
      const originLabel = isAutoWhatsAppLead(item) ? 'auto wa api whatsapp otomatis' : '';
      const labelText = (item.labels || []).map(getProspectLabelName).join(' ');
      const followUpPlan = followUpPlanByLeadId.get(item.id);

      const matchesSearch = 
        item.name.toLowerCase().includes(search.toLowerCase()) ||
        item.phone.toLowerCase().includes(search.toLowerCase()) ||
        platformName.toLowerCase().includes(search.toLowerCase()) ||
        vehicleName.toLowerCase().includes(search.toLowerCase()) ||
        csName.toLowerCase().includes(search.toLowerCase()) ||
        socialHandle.toLowerCase().includes(search.toLowerCase()) ||
        socialPlatformLabel.toLowerCase().includes(search.toLowerCase()) ||
        socialSearchableLink.toLowerCase().includes(search.toLowerCase()) ||
        labelText.toLowerCase().includes(search.toLowerCase()) ||
        originLabel.includes(search.toLowerCase());
      
      const matchesAdvertiser = advertiserFilter === 'all' || item.advertiserId === advertiserFilter;
      const matchesPlatform = platformFilter === 'all' || item.platformId === platformFilter;
      const matchesSubChannel = subChannelFilter === 'all' || item.subChannelId === subChannelFilter;
      const matchesCS = csFilter === 'all' || item.csId === csFilter;
      const matchesLabel = labelFilter === 'all' || (item.labels || []).includes(labelFilter);
      const matchesFollowUp =
        followUpFilter === 'all' ||
        (followUpFilter === 'due_today' && Boolean(followUpPlan?.isDueToday || followUpPlan?.isOverdue)) ||
        (followUpFilter === 'overdue' && Boolean(followUpPlan?.isOverdue)) ||
        (followUpFilter === 'upcoming' && Boolean(followUpPlan?.isUpcoming)) ||
        (followUpFilter === 'completed' && Boolean(followUpPlan?.isCompleted)) ||
        (followUpFilter === 'unscheduled' && followUpPlan?.status === 'unscheduled');

      let matchesDate = true;
      if (dateRange?.from && followUpFilter === 'all') {
        const itemDate = new Date(item.timestamp);
        const start = startOfDay(dateRange.from);
        const end = dateRange.to ? endOfDay(dateRange.to) : endOfDay(dateRange.from);
        matchesDate = isWithinInterval(itemDate, { start, end });
      }

      return matchesSearch && matchesAdvertiser && matchesPlatform && matchesSubChannel && matchesDate && matchesCS && matchesLabel && matchesFollowUp;
    });
  }, [roleBasedLeads, search, advertiserFilter, platformFilter, subChannelFilter, csFilter, labelFilter, followUpFilter, followUpPlanByLeadId, dateRange, platforms, vehicles, users, prospectLabelById]);
  const leadsRangeLoading = isDateRangeLoading && filteredLeadsBase.length === 0;
  const leadTableLoading = leadsInitialLoading || leadsRangeLoading;

  useEffect(() => {
    if (!dateRange?.from) return;

    let isCancelled = false;
    const from = toLocalDateKey(dateRange.from);
    const to = toLocalDateKey(dateRange.to || dateRange.from);

    setIsDateRangeLoading(true);
    ensureLeadsForDateRange({ from, to })
      .catch((error) => {
        if (import.meta.env.DEV) {
          console.warn('[Prospek] failed to fetch filtered lead range', error);
        }
      })
      .finally(() => {
        if (!isCancelled) {
          setIsDateRangeLoading(false);
        }
      });

    return () => {
      isCancelled = true;
    };
  }, [
    dateRange?.from?.getTime(),
    dateRange?.to?.getTime(),
    ensureLeadsForDateRange,
  ]);

  // --- FINAL FILTERED DATA (Includes Status) ---
  const filteredData = useMemo(() => {
      return filteredLeadsBase.filter(item => {
           return statusFilter === 'all' || item.status === statusFilter;
      });
  }, [filteredLeadsBase, statusFilter]);

  // Reset page when filters change
  useEffect(() => {
      setCurrentPage(1);
      setSelectedIds(new Set());
  }, [filteredData]);

  useEffect(() => {
      if (!showSelection) {
          setSelectedIds(new Set());
      }
  }, [showSelection]);

  // Pagination Logic
  const totalPages = Math.ceil(filteredData.length / itemsPerPage);
  const paginatedLeads = useMemo(() => {
      const start = (currentPage - 1) * itemsPerPage;
      return filteredData.slice(start, start + itemsPerPage);
  }, [filteredData, currentPage, itemsPerPage]);

  useEffect(() => {
      if (totalPages > 0 && currentPage > totalPages) {
          setCurrentPage(totalPages);
      }
  }, [currentPage, totalPages]);

  const selectedOnPageCount = useMemo(() => {
      return paginatedLeads.filter((lead) => selectedIds.has(lead.id)).length;
  }, [paginatedLeads, selectedIds]);

  const allPageSelected = paginatedLeads.length > 0 && selectedOnPageCount === paginatedLeads.length;

  const isDefaultDateRange = Boolean(
      dateRange?.from &&
      !dateRange?.to &&
      startOfDay(dateRange.from).getTime() === startOfDay(new Date()).getTime()
  ) || Boolean(
      dateRange?.from &&
      dateRange?.to &&
      startOfDay(dateRange.from).getTime() === startOfDay(new Date()).getTime() &&
      startOfDay(dateRange.to).getTime() === startOfDay(new Date()).getTime()
  );

  const hasActiveFilters = Boolean(
      search ||
      statusFilter !== 'all' ||
      advertiserFilter !== 'all' ||
      platformFilter !== 'all' ||
      subChannelFilter !== 'all' ||
      csFilter !== 'all' ||
      labelFilter !== 'all' ||
      followUpFilter !== 'all' ||
      !isDefaultDateRange
  );

  const activeFilterCount = [
      Boolean(search),
      statusFilter !== 'all',
      advertiserFilter !== 'all',
      platformFilter !== 'all',
      subChannelFilter !== 'all',
      csFilter !== 'all',
      labelFilter !== 'all',
      followUpFilter !== 'all',
      !isDefaultDateRange,
  ].filter(Boolean).length;

  const resetFilters = () => {
      setSearch('');
      setStatusFilter('all');
      setAdvertiserFilter('all');
      setCsFilter('all');
      setLabelFilter('all');
      setFollowUpFilter('all');
      setPlatformFilter('all');
      setSubChannelFilter('all');
      setDateRange({ from: new Date(), to: new Date() });
      setIsMobileFilterExpanded(false);
  };

  const handleSelectAll = (checked: boolean) => {
      if (checked) {
          const newSelected = new Set(selectedIds);
          paginatedLeads.forEach(l => newSelected.add(l.id));
          setSelectedIds(newSelected);
      } else {
          const newSelected = new Set(selectedIds);
          paginatedLeads.forEach(l => newSelected.delete(l.id));
          setSelectedIds(newSelected);
      }
  };

  const handleSelectRow = (id: string, checked: boolean) => {
      const newSelected = new Set(selectedIds);
      if (checked) newSelected.add(id);
      else newSelected.delete(id);
      setSelectedIds(newSelected);
  };

  const [isMassDeleteOpen, setIsMassDeleteOpen] = useState(false);

  const handleMassDelete = () => {
      if (selectedDeletableLeads.length === 0) {
          toast.error("Tidak ada prospek terpilih yang bisa dihapus");
          return;
      }
      setIsMassDeleteOpen(true);
  };

  const confirmMassDelete = async () => {
      const ids = selectedDeletableLeads.map((lead) => lead.id);
      const skippedCount = selectedIds.size - ids.length;

      if (ids.length === 0) {
        toast.error("Tidak ada prospek yang bisa dihapus");
        setIsMassDeleteOpen(false);
        return;
      }

      const results = await Promise.allSettled(ids.map(id => deleteLead(id, { silent: true })));
      const successCount = results.filter(result => result.status === 'fulfilled').length;
      const failedIds = ids.filter((_, index) => results[index].status === 'rejected');

      setSelectedIds(new Set(failedIds));

      if (successCount > 0) {
        toast.success(`${successCount} prospek berhasil dihapus${skippedCount > 0 ? `, ${skippedCount} dilewati` : ''}`);
        if (currentUser) {
          logActivity(
            { id: currentUser.id, name: currentUser.name, role: currentUser.role },
            'DELETE',
            'Prospek',
            `Menghapus ${successCount} prospek secara massal`,
            '',
            { count: successCount, skipped: skippedCount }
          );
        }
      }

      if (failedIds.length > 0) {
        toast.error(`Gagal menghapus ${failedIds.length} prospek`);
      }

      setIsMassDeleteOpen(false);
  };

  const handleBulkUpdate = async () => {
      if (!bulkField || !bulkValue) {
          toast.error("Mohon pilih field dan nilai yang akan diupdate");
          return;
      }

      if (bulkField === 'status' && !bulkStatusOptions.includes(bulkValue as LeadStatus)) {
          toast.error("Status ini tidak bisa dipakai untuk update massal");
          return;
      }

      if (selectedEditableLeads.length === 0) {
          toast.error("Tidak ada prospek terpilih yang bisa diedit");
          return;
      }
      
      const toastId = toast.loading(`Mengupdate ${selectedEditableLeads.length} prospek...`);
      
      try {
        let successCount = 0;
        let skippedCount = selectedIds.size - selectedEditableLeads.length;
        
        for (const lead of selectedEditableLeads) {
             const updates: any = {};
             if (bulkField === 'status') updates.status = bulkValue;
             else if (bulkField === 'csId') updates.csId = bulkValue;
             else if (bulkField === 'advertiserId') updates.advertiserId = bulkValue;
             else if (bulkField === 'platformId') updates.platformId = bulkValue;
             else if (bulkField === 'subChannelId') updates.subChannelId = bulkValue;
             else if (bulkField === 'vehicleId') updates.vehicleId = bulkValue;

             const nextLead = normalizeLeadAttributionUpdate(lead, updates);

             if (!isBulkUpdateApplicable(nextLead, bulkField, bulkValue)) {
               skippedCount++;
               continue;
             }

             await updateLead(nextLead);
             successCount++;
        }
        
        toast.dismiss(toastId);
        if (successCount > 0) {
          toast.success(`${successCount} prospek berhasil diperbarui${skippedCount > 0 ? `, ${skippedCount} dilewati` : ''}`);
        } else {
          toast.error('Tidak ada prospek yang cocok dengan nilai update massal');
        }
        if (currentUser) {
          logActivity(
            { id: currentUser.id, name: currentUser.name, role: currentUser.role },
            'UPDATE',
            'Prospek',
            `Memperbarui ${successCount} prospek secara massal`,
            '',
            { count: successCount, skipped: skippedCount, field: bulkField }
          );
        }
        setIsBulkEditOpen(false);
        setBulkField('');
        setBulkValue('');
        setSelectedIds(new Set());
      } catch (error) {
        console.error(error);
        toast.dismiss(toastId);
        toast.error("Terjadi kesalahan saat update massal");
      }
  };

  // Statistics
  const stats = useMemo(() => {
    // User requested stats to reflect ALL filters including Status
    const data = filteredData;
    const total = data.length;
    const pending = data.filter(l => l.status === 'Pending').length;
    const closing = data.filter(l => l.status === 'Closing').length;
    const autoWhatsApp = data.filter(isAutoWhatsAppLead).length;
    const dueToday = data.filter((lead) => {
      const plan = followUpPlanByLeadId.get(lead.id);
      return Boolean(plan?.isDueToday || plan?.isOverdue);
    }).length;
    const conversionRate = total > 0 ? ((closing / total) * 100).toFixed(1) : '0.0';
    return { total, pending, closing, autoWhatsApp, dueToday, conversionRate };
  }, [filteredData, followUpPlanByLeadId]);
  const leadTableColumnCount = isAdvertiserView ? (showSelection ? 10 : 9) : (showSelection ? 11 : 10);

  // Access Control
  if (!hasPermission('leads.view')) {
    return (
      <div className="flex flex-col items-center justify-center h-[80vh] text-center p-8">
        <div className="bg-slate-100 dark:bg-slate-800 p-6 rounded-full mb-4">
           <svg className="w-12 h-12 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
           </svg>
        </div>
        <h2 className="text-2xl font-bold text-slate-900 dark:text-slate-100">Akses Ditolak</h2>
        <p className="text-slate-500 dark:text-slate-400 mt-2 max-w-md">
          Anda tidak memiliki izin untuk mengakses halaman Prospek.
        </p>
      </div>
    );
  }

  const handleSubmit = async (formData: any) => {
    // Sanitize foreign keys: convert "none_*" and empty strings to undefined
    if (formData.advertiserId === "none_advertiser" || formData.advertiserId === "") formData.advertiserId = undefined;
    if (formData.platformId === "none_platform" || formData.platformId === "") formData.platformId = undefined;
    if (formData.subChannelId === "none_subchannel" || formData.subChannelId === "") formData.subChannelId = undefined;
    if (formData.vehicleId === "none_vehicle" || formData.vehicleId === "__no_vehicle__" || formData.vehicleId === "") formData.vehicleId = undefined;
    if (formData.csId === "none_cs" || formData.csId === "") formData.csId = undefined;

    const normalizedSocialFields = normalizeLeadSocialFields(formData);
    Object.assign(formData, normalizedSocialFields);

    if (formData.status === 'Closing' && !isOwnerLikeUser && editingItem?.status !== 'Closing') {
      toast.error('Status Closing hanya dibuat lewat proses order');
      return;
    }

    const attributionDraft = normalizeLeadAttributionUpdate(
      {
        id: editingItem?.id || 'draft',
        name: formData.name,
        phone: formData.phone,
        status: formData.status || 'Pending',
        timestamp: editingItem?.timestamp || new Date().toISOString(),
        ...editingItem,
        ...formData,
      },
      {},
    );
    formData.advertiserId = attributionDraft.advertiserId;
    formData.platformId = attributionDraft.platformId;
    formData.subChannelId = attributionDraft.subChannelId;
    formData.csId = attributionDraft.csId;

    if (editingItem) {
      const updatedLead = { ...editingItem, ...formData };
      try {
        await Promise.resolve(updateLead(updatedLead));
        toast.success("Prospek berhasil diperbarui");
        if (currentUser) {
          logActivity(
            { id: currentUser.id, name: currentUser.name, role: currentUser.role },
            'UPDATE',
            'Prospek',
            `Memperbarui prospek: ${formData.name || editingItem.name}`,
            editingItem.id,
            { status: formData.status }
          );
        }
        setIsAddOpen(false);
        setEditingItem(null);
      } catch (error: any) {
        console.error("Error updating lead:", error);
        toast.error("Gagal memperbarui prospek", {
          description: getProspectCrudErrorMessage(error),
        });
      }
    } else {
      // Generate 7-char random ID (Uppercase + Numbers)
      const generateShortId = () => {
          const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
          let result = '';
          for (let i = 0; i < 7; i++) {
              result += chars.charAt(Math.floor(Math.random() * chars.length));
          }
          return result;
      };

      const newItem: Lead = {
        id: generateShortId(),
        timestamp: new Date().toISOString(), 
        lastContact: 'Baru saja',
        ...formData
      };
      try {
          await addLead(newItem, { silent: true });
          toast.success("Prospek berhasil ditambahkan");
          if (currentUser) {
            logActivity(
              { id: currentUser.id, name: currentUser.name, role: currentUser.role },
              'CREATE',
              'Prospek',
              `Menambahkan prospek baru: ${newItem.name}`,
              newItem.id,
              { platform: formData.platformId }
            );
          }
          setIsAddOpen(false);
          setEditingItem(null);
      } catch (err: any) {
          console.error("Error submitting lead:", err);
          toast.error("Gagal menambahkan prospek", {
            description: getProspectCrudErrorMessage(err),
          });
      }
    }
  };

  const confirmDelete = async () => {
    if (deleteId) {
      const leadToDelete = leads.find(l => l.id === deleteId);
      try {
        await deleteLead(deleteId, { silent: true });
        toast.success("Prospek berhasil dihapus");
        if (currentUser && leadToDelete) {
          logActivity(
            { id: currentUser.id, name: currentUser.name, role: currentUser.role },
            'DELETE',
            'Prospek',
            `Menghapus prospek: ${leadToDelete.name}`,
            deleteId
          );
        }
        setDeleteId(null);
      } catch (error: any) {
        toast.error(`Gagal menghapus prospek: ${error.message || 'Terjadi kesalahan'}`);
      }
    }
  };

  const getStatusBadgeVariant = getProspectStatusBadgeClass;

  // Kanban Component (Memoized View)
  const kanbanView = useMemo(() => {
    const stages: LeadStatus[] = ['Pending', 'Follow Up', 'Booking', 'Closing', 'Cancel'];

    return (
      <div className="leadKanbanBoard" aria-label="Board follow up prospek">
        {stages.map((stage) => {
          const items = filteredData.filter((item) => item.status === stage);

          return (
            <section key={stage} className="leadKanbanColumn" aria-label={`Kolom ${stage}`}>
              <div className="leadKanbanColumnHeader">
                <div className="leadKanbanColumnTitle">
                  <Badge className={`leadStatusBadge ${getStatusBadgeVariant(stage)}`} variant="outline">
                    {stage}
                  </Badge>
                  <span className="leadKanbanCount">{items.length}</span>
                </div>
              </div>

              <div className="leadKanbanList">
                {items.length === 0 ? (
                  <div className="leadKanbanEmpty">
                    <strong>Belum ada prospek</strong>
                    <span>Tidak ada data pada status ini.</span>
                  </div>
                ) : items.map((item) => {
                  const booking = getLeadBooking(item.id);
                  const activeBooking = getActiveLeadBooking(item.id);
                  const socialHandle = getLeadSocialHandle(item);
                  const socialUrl = getLeadSocialUrl(item);
                  const itemLabels = item.labels || [];
                  const followUpPlan = getLeadFollowUpPlan(item);

                  return (
                    <article
                      key={item.id}
                      className="leadKanbanCard"
                      role="button"
                      tabIndex={0}
                      onClick={() => openLeadDetail(item)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          openLeadDetail(item);
                        }
                      }}
                    >
                      <div className="leadKanbanCardHeader">
                        <div className="leadKanbanCardTitle">
                          <div className="leadKanbanNameRow">
                            <h4>{item.name}</h4>
                            <AutoWhatsAppLeadBadge lead={item} className="shrink-0" />
                          </div>
                          {!isAdvertiserView && <span className="leadKanbanPhone">{item.phone}</span>}
                        </div>

                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="leadKanbanMoreButton"
                              onClick={(event) => event.stopPropagation()}
                            >
                              <MoreVertical className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" onClick={(event) => event.stopPropagation()}>
                            {canEditLead(item) && (
                              <DropdownMenuItem onClick={() => openEditLeadForm(item)}>Edit</DropdownMenuItem>
                            )}
                            {canEditLead(item) && (
                              <DropdownMenuItem onClick={() => openLeadLabelEditor(item)}>
                                <Tags className="w-4 h-4 mr-2" /> Atur Label
                              </DropdownMenuItem>
                            )}
                            {canManageLeadBooking(item) && (
                              <DropdownMenuItem onClick={() => openBookingForm(item)}>
                                Booking Jadwal
                              </DropdownMenuItem>
                            )}
                            {canManageLeadBooking(item) && activeBooking && (
                              <DropdownMenuItem onClick={() => void handleCancelLeadBooking(item, activeBooking)}>
                                <Ban className="w-4 h-4 mr-2" /> Batalkan Booking
                              </DropdownMenuItem>
                            )}
                            {canForwardLeadToOrder(item) && (
                              <DropdownMenuItem onClick={() => { setForwardLead(item); }}>Proses Order</DropdownMenuItem>
                            )}
                            {canEditLead(item) && (
                              <>
                                <DropdownMenuSeparator />
                                <DropdownMenuLabel>Ubah Status</DropdownMenuLabel>
                                {stages.filter((targetStage) => targetStage !== stage).map((targetStage) => (
                                  <DropdownMenuItem key={targetStage} onClick={() => updateLead({ ...item, status: targetStage })}>
                                    Pindah ke {targetStage}
                                  </DropdownMenuItem>
                                ))}
                              </>
                            )}
                            {canDeleteLead(item) && (
                              <>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem onClick={() => setDeleteId(item.id)} className="text-red-600">
                                  <Trash2 className="w-4 h-4 mr-2" /> Hapus
                                </DropdownMenuItem>
                              </>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>

                      <div className="leadKanbanMetaGrid">
                        <div className="leadKanbanMetaPill">
                          <span>Sumber</span>
                          <strong>{isAutoWhatsAppLead(item) ? 'WhatsApp' : item.platformId ? getPlatformName(item.platformId) : '-'}</strong>
                        </div>
                        <div className="leadKanbanMetaPill">
                          <span>Mobil</span>
                          <strong>{getVehicleName(item.vehicleId)}</strong>
                        </div>
                      </div>

                      <div className="flex flex-wrap gap-1.5">
                        <span
                          className={`inline-flex items-center rounded-full border px-2 py-1 text-[11px] font-bold ${getFollowUpPlanBadgeClass(item)}`}
                          title={followUpPlan.dueDate ? `Jadwal: ${formatProspectFollowUpDueDate(followUpPlan.dueDate)}` : undefined}
                        >
                          {getFollowUpPlanLabel(item)}
                        </span>
                        {itemLabels.slice(0, 3).map((labelId) => (
                          <span
                            key={labelId}
                            className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] font-bold text-slate-600"
                            style={getProspectLabelStyle(labelId)}
                          >
                            #{getProspectLabelName(labelId)}
                          </span>
                        ))}
                      </div>

                      {item.notes && (
                        <p className="leadKanbanNote" title={normalizeLeadNotes(item.notes)}>
                          {getLeadNotesPreview(item.notes, 118)}
                        </p>
                      )}

                      {booking && (
                        <div className="leadKanbanBooking" title={getBookingSummary(item.id)}>
                          <strong>Booking {getBookingStatusLabel(booking)}</strong>
                          <span>{getBookingSummary(item.id)}</span>
                        </div>
                      )}

                      {!isAdvertiserView && socialHandle && (
                        <div className="leadKanbanSocial">
                          {item.socialPlatform && <span>{getLeadSocialPlatformLabel(item.socialPlatform)}</span>}
                          <strong>{socialHandle}</strong>
                        </div>
                      )}

                      <div className="leadKanbanFooter">
                        <div className="leadKanbanOwner">
                          <UserIcon className="h-3.5 w-3.5" />
                          <span>{getCSName(item.csId)}</span>
                        </div>
                        <time dateTime={item.timestamp}>
                          {new Date(item.timestamp).toLocaleDateString('id-ID', { day: 'numeric', month: 'short' })}
                        </time>
                      </div>

                      {!isAdvertiserView && (
                        <div className="leadKanbanActions" onClick={(event) => event.stopPropagation()}>
                          <div className="leadKanbanFollowUps" aria-label="Template follow up">
                            {visibleFollowUpTemplates.length > 0 ? visibleFollowUpTemplates.map((template) => {
                              const usageCount = getTemplateUsageCount(item, template.id);
                              const latestHistory = getLatestTemplateHistory(item, template.id);
                              const isUsed = usageCount > 0;
                              const tooltipText = isUsed
                                ? `${template.title} sudah dipakai ${usageCount}x${latestHistory ? ` - ${formatTemplateSentAt(latestHistory.sentAt)}` : ''}`
                                : `${template.title} belum dipakai`;

                              return (
                                <Tooltip key={template.id}>
                                  <TooltipTrigger asChild>
                                    <button
                                      type="button"
                                      className={`leadFollowUpButton ${isUsed ? 'isUsed' : ''}`}
                                      disabled={!canSendLeadTemplate}
                                      onClick={() => {
                                        if (!canSendLeadTemplate) return;
                                        handleWhatsappClick(item, template);
                                      }}
                                      aria-label={tooltipText}
                                    >
                                      {isUsed ? <CheckCircle2 className="h-4 w-4" /> : <MessageCircle className="h-4 w-4" />}
                                    </button>
                                  </TooltipTrigger>
                                  <TooltipContent side="top" className="leadFollowUpTooltip">
                                    <div>
                                      <strong>{template.title}</strong>
                                      <span>{isUsed ? `Dipakai ${usageCount}x` : 'Belum dipakai'}</span>
                                      {latestHistory && <small>{formatTemplateSentAt(latestHistory.sentAt)} - {getTemplateSenderName(latestHistory.sentBy)}</small>}
                                    </div>
                                  </TooltipContent>
                                </Tooltip>
                              );
                            }) : (
                              <span className="leadFollowUpEmpty">-</span>
                            )}
                            {hiddenFollowUpTemplateCount > 0 && (
                              <button
                                type="button"
                                className="leadFollowUpMore"
                                disabled={!canSendLeadTemplate}
                                onClick={() => {
                                  if (!canSendLeadTemplate) return;
                                  setSelectedWaLead(item);
                                }}
                                aria-label={`Lihat ${hiddenFollowUpTemplateCount} template lain`}
                              >
                                +{hiddenFollowUpTemplateCount}
                              </button>
                            )}
                          </div>

                          <div className="leadKanbanQuickActions">
                            <Button
                              type="button"
                              size="icon"
                              variant="outline"
                              className="leadKanbanQuickButton"
                              onClick={() => setSelectedWaLead(item)}
                              aria-label="Buka template WhatsApp"
                            >
                              <Phone className="h-4 w-4" />
                            </Button>
                            {socialUrl && (
                              <Button
                                type="button"
                                size="icon"
                                variant="outline"
                                className="leadKanbanQuickButton"
                                onClick={() => handleLeadSocialOpen(item)}
                                aria-label={getLeadSocialPrimaryActionLabel(item)}
                              >
                                <ExternalLink className="h-4 w-4" />
                              </Button>
                            )}
                            {socialHandle && (
                              <Button
                                type="button"
                                size="icon"
                                variant="outline"
                                className="leadKanbanQuickButton"
                                onClick={() => void handleLeadSocialCopy(item)}
                                aria-label="Salin kontak sosial"
                              >
                                <Copy className="h-4 w-4" />
                              </Button>
                            )}
                          </div>
                        </div>
                      )}
                    </article>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>
    );
  }, [filteredData, updateLead, getStatusBadgeVariant, isAdvertiserView, visibleFollowUpTemplates, hiddenFollowUpTemplateCount, canSendLeadTemplate]);

  return (
    <OperationalPageShell>
      <div className="flex flex-col space-y-4">
        <OperationalPageHeader
          eyebrow="Operasional"
          icon={UserIcon}
          title="Kotak Masuk Prospek"
          subtitle="Kelola leads, follow up, booking awal, dan konversi menjadi pesanan."
          actions={
	            <div className="leadHeaderActions">
	                 {hasPermission('leads.edit') && (
	                  <Button
	                    type="button"
	                    variant="outline"
	                    className="leadAddButton"
	                    icon={<Tags className="h-4 w-4" />}
	                    onClick={() => {
	                      resetLabelDraft();
	                      setIsLabelManagerOpen(true);
	                    }}
	                  >
	                    Kelola Label
	                  </Button>
	                 )}
	                 {hasPermission('leads.create') && (
	                  <>
                    <Button
                      size="sm"
                      aria-label="Tambah prospek"
                      className="leadAddIconButton"
                      onClick={() => {
                        openAddLeadForm();
                      }}
                    >
                      <Plus className="h-5 w-5" />
                    </Button>

                    <Button
                      className="leadAddButton"
                      icon={<Plus className="h-4 w-4" />}
                      onClick={() => {
                        openAddLeadForm();
                      }}
                    >
                      Tambah Prospek
                    </Button>
                  </>
                 )}
            </div>
          }
        />

        <Tabs value={viewMode} onValueChange={(value) => setViewMode(value as 'list' | 'kanban')} className="masterDataTabsShell leadViewTabsShell">
          <TabsViewport>
            <TabsRail className="masterDataTabs leadViewTabs">
              <TabsTrigger value="list" className="masterDataTab leadViewTab">
                <LayoutList className="h-4 w-4" />
              <span>List Prospek</span>
              </TabsTrigger>
              <TabsTrigger value="kanban" className="masterDataTab leadViewTab">
                <KanbanSquare className="h-4 w-4" />
                <span>Board Follow Up</span>
              </TabsTrigger>
            </TabsRail>
          </TabsViewport>
        </Tabs>

        {/* Stats Cards */}
        <OperationalKpiGrid className="leadKpiGrid">
          <OperationalKpiCard label="Total" value={leadTableLoading ? <Skeleton className="h-6 w-14 rounded-md" /> : stats.total} icon={UserIcon} />
          <OperationalKpiCard label="Pending" value={leadTableLoading ? <Skeleton className="h-6 w-14 rounded-md" /> : stats.pending} icon={CalendarClock} tone="amber" />
          <OperationalKpiCard label="Closing" value={leadTableLoading ? <Skeleton className="h-6 w-14 rounded-md" /> : stats.closing} icon={CheckCircle2} tone="emerald" />
          <OperationalKpiCard label="Auto WA" value={leadTableLoading ? <Skeleton className="h-6 w-14 rounded-md" /> : stats.autoWhatsApp} icon={MessageCircle} tone="emerald" />
          <OperationalKpiCard label="FU Hari Ini" value={leadTableLoading ? <Skeleton className="h-6 w-14 rounded-md" /> : stats.dueToday} icon={Bell} tone="amber" />
          <OperationalKpiCard label="Conversion Rate" value={leadTableLoading ? <Skeleton className="h-6 w-16 rounded-md" /> : `${stats.conversionRate}%`} icon={ArrowRightCircle} tone="blue" />
        </OperationalKpiGrid>

        {!isAdvertiserView && stats.dueToday > 0 && (
          <div className="flex flex-col gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-amber-900 shadow-sm sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3">
              <Bell className="mt-0.5 h-5 w-5 shrink-0" />
              <div>
                <p className="text-sm font-bold">{stats.dueToday} prospek perlu follow up</p>
                <p className="text-xs font-medium text-amber-800">Termasuk jadwal hari ini dan yang sudah lewat.</p>
              </div>
            </div>
            <Button
              type="button"
              variant="outline"
              className="border-amber-200 bg-white text-amber-900 hover:bg-amber-100"
              onClick={() => {
                setFollowUpFilter('due_today');
                setIsMobileFilterExpanded(true);
              }}
            >
              Lihat Jadwal FU
            </Button>
          </div>
        )}


        <OperationalFilterPanel
          className="leadFilterPanel"
          collapsible
          isExpanded={isMobileFilterExpanded}
          onExpandedChange={setIsMobileFilterExpanded}
          summary={activeFilterCount > 0 ? `${activeFilterCount} filter aktif` : 'Semua data ditampilkan'}
          contentClassName="leadFilterContent"
        >
          <FilterRow className="leadFilterGrid">
            <div className="leadFilterDate leadFilterItem">
              <FoundationDateRangePicker
                date={dateRange}
                setDate={setDateRange}
              />
            </div>

            <div className="leadAdvancedFilter leadFilterItem">
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="leadFilterControl">
                  <SelectValue placeholder="Semua Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Semua Status</SelectItem>
                  {['Pending', 'Follow Up', 'Booking', 'Closing', 'Cancel'].map(status => (
                    <SelectItem key={status} value={status}>{status}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="leadAdvancedFilter leadFilterItem">
              <Select value={platformFilter} onValueChange={(val) => {
                setPlatformFilter(val);
                setSubChannelFilter('all');
              }}>
                <SelectTrigger className="leadFilterControl">
                  <SelectValue placeholder="Semua Sumber" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Semua Sumber</SelectItem>
                  {availablePlatforms.map(platform => (
                    <SelectItem key={platform.id} value={platform.id}>{platform.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="leadAdvancedFilter leadFilterItem">
              <Select value={subChannelFilter} onValueChange={setSubChannelFilter}>
                <SelectTrigger className="leadFilterControl">
                  <SelectValue placeholder="Semua Sub Channel" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Semua Sub Channel</SelectItem>
                  {availableSubChannels.map(sc => (
                    <SelectItem key={sc.id} value={sc.id}>{sc.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {(isAdminManagementUser || isAdvertiserView) && (
              <div className="leadAdvancedFilter leadFilterItem">
                <Select value={csFilter} onValueChange={setCsFilter}>
                  <SelectTrigger className="leadFilterControl">
                    <SelectValue placeholder="Semua CS" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Semua CS</SelectItem>
                    {availableCS.map((user) => (
                      <SelectItem key={user.id} value={user.id}>{user.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {!isAdvertiserView && (
              <div className="leadAdvancedFilter leadFilterItem">
                <Select value={advertiserFilter} onValueChange={setAdvertiserFilter}>
                  <SelectTrigger className="leadFilterControl">
                    <SelectValue placeholder="Semua Advertiser" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Semua Advertiser</SelectItem>
                    {availableAdvertisers.map(user => (
                      <SelectItem key={user.id} value={user.id}>{user.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="leadAdvancedFilter leadFilterItem">
              <Select value={labelFilter} onValueChange={setLabelFilter}>
                <SelectTrigger className="leadFilterControl">
                  <SelectValue placeholder="Semua Label" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Semua Label</SelectItem>
                  {availableLabels.map((label) => (
                    <SelectItem key={label.id} value={label.id}>
                      {label.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="leadAdvancedFilter leadFilterItem">
              <Select value={followUpFilter} onValueChange={(value) => setFollowUpFilter(value as ProspectFollowUpFilter)}>
                <SelectTrigger className="leadFilterControl">
                  <SelectValue placeholder="Semua Jadwal FU" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Semua Jadwal FU</SelectItem>
                  <SelectItem value="due_today">FU Hari Ini</SelectItem>
                  <SelectItem value="overdue">FU Terlambat</SelectItem>
                  <SelectItem value="upcoming">FU Mendatang</SelectItem>
                  <SelectItem value="completed">Plan Selesai</SelectItem>
                  <SelectItem value="unscheduled">Belum Ada Plan</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="leadSearchBox leadFilterItem">
              <Search className="leadSearchIcon" />
              <Input
                placeholder="Cari nama, nomor, platform, label, atau catatan..."
                className="leadSearchInput"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>

            <Button
              type="button"
              variant="outline"
              className="leadResetButton"
              onClick={resetFilters}
              disabled={!hasActiveFilters}
            >
              <RefreshCw className="h-4 w-4" />
              <span>Reset</span>
            </Button>
          </FilterRow>
        </OperationalFilterPanel>

        {/* Content Card */}
        {viewMode === 'list' ? (
          <OperationalTableCard className="leadTableCard">
            <div className="leadTableHeader">
              <MasterDataTableTitle title="Data Prospek" count={filteredData.length} icon={UserIcon} />
              <div className="leadTableHeaderActions">
                {showSelection && selectedIds.size > 0 && hasPermission('leads.edit') && (
                  <Button
                    type="button"
                    variant="outline"
                    className="leadBulkButton"
                    onClick={() => setIsBulkEditOpen(true)}
                    disabled={selectedEditableLeads.length === 0}
                  >
                    <Edit className="h-4 w-4" />
                    <span>Edit Massal</span>
                  </Button>
                )}
                {showSelection && selectedIds.size > 0 && hasPermission('leads.delete') && (
                  <Button
                    type="button"
                    variant="danger"
                    className="leadBulkDangerButton"
                    onClick={handleMassDelete}
                    disabled={selectedDeletableLeads.length === 0}
                  >
                    <Trash2 className="h-4 w-4" />
                    <span>Hapus Massal</span>
                  </Button>
                )}
                <label className="leadSelectionSwitch">
                  <Switch checked={showSelection} onCheckedChange={setShowSelection} />
                  <span>Pilih baris</span>
                </label>
              </div>
            </div>

            {showSelection && (
              <div className="leadSelectionToolbar">
                <div>
                  <strong>{selectedIds.size} dipilih</strong>
                  <span>{paginatedLeads.length} data aktif di halaman ini</span>
                </div>
                <div className="leadSelectionToolbarActions">
                  <Button type="button" variant="outline" onClick={() => handleSelectAll(true)}>
                    Pilih semua
                  </Button>
                  <Button type="button" variant="outline" onClick={() => setSelectedIds(new Set())} disabled={selectedIds.size === 0}>
                    Bersihkan
                  </Button>
                </div>
              </div>
            )}

            <DataTable
              className="leadDataTable"
              onClickCapture={handleLeadTableClickCapture}
              onPointerCancel={handleLeadTablePointerEnd}
              onPointerDown={handleLeadTablePointerDown}
              onPointerLeave={handleLeadTablePointerEnd}
              onPointerMove={handleLeadTablePointerMove}
              onPointerUp={handleLeadTablePointerEnd}
              columns={createDataTableColumns([
                showSelection && { preset: 'checkbox', width: 48, minWidth: 48 },
                { preset: 'number', width: 56, minWidth: 56 },
                { preset: 'date', width: 'clamp(124px, 9vw, 148px)', minWidth: 124 },
                { preset: 'name', width: 'clamp(210px, 16vw, 270px)', minWidth: 210 },
                { preset: 'text', width: 'clamp(174px, 12vw, 220px)', minWidth: 174 },
                { preset: 'text', width: 'clamp(156px, 11vw, 204px)', minWidth: 156 },
                { preset: 'text', width: 'clamp(180px, 13vw, 230px)', minWidth: 180 },
                { preset: 'description', width: 'clamp(222px, 16vw, 286px)', minWidth: 222 },
                { preset: 'status', width: 150, minWidth: 150 },
                { preset: 'compact', width: 236, minWidth: 220, className: 'leadFollowUpColumn' },
                !isAdvertiserView && { preset: 'action', width: 64, minWidth: 64 },
              ])}
              rowMinHeight={84}
              cellY={16}
              textMax={260}
            >
              <table>
                <thead>
                  <tr>
                    {showSelection && (
                      <th className="leadSelectCell">
                        <Checkbox
                          className="leadSoftCheckbox"
                          checked={allPageSelected}
                          onCheckedChange={(checked) => handleSelectAll(checked as boolean)}
                        />
                      </th>
                    )}
                    <th>No</th>
                    <th>Waktu</th>
                    <th>Prospek</th>
                    <th>CS / Staff</th>
                    <th>Sumber</th>
                    <th>Mobil</th>
                    <th>Catatan</th>
                    <th>Status</th>
                    <th>Follow Up</th>
                    {!isAdvertiserView && <TableActionHeader />}
                  </tr>
                </thead>
                <tbody>
                  {leadTableLoading ? (
                    <LeadTableSkeleton columns={leadTableColumnCount} />
                  ) : paginatedLeads.length === 0 ? (
                    <tr>
                      <td colSpan={leadTableColumnCount}>
                        <OperationalEmptyState
                          icon={UserIcon}
                          title="Tidak ada data prospek ditemukan"
                          description={
                            leads.length === 0
                              ? 'Belum ada prospek pada periode ini.'
                              : 'Coba ubah filter, tanggal, atau kata kunci pencarian.'
                          }
                        />
                      </td>
                    </tr>
                  ) : (
                    paginatedLeads.map((item, index) => {
                      const booking = getLeadBooking(item.id);
                      const socialHandle = getLeadSocialHandle(item);
                      const platformLabel = isAutoWhatsAppLead(item) ? 'WhatsApp' : item.platformId ? getPlatformName(item.platformId) : '-';
                      const subChannelLabel = isAutoWhatsAppLead(item) && !item.subChannelId ? 'Auto API' : getSubChannelName(item.subChannelId);
                      const rowNumber = (currentPage - 1) * itemsPerPage + index + 1;
                      const itemLabels = item.labels || [];
                      const followUpPlan = getLeadFollowUpPlan(item);

                      return (
                        <tr
                          key={item.id}
                          data-lead-id={item.id}
                          role="button"
                          tabIndex={0}
                          className={`leadClickableRow ${selectedIds.has(item.id) ? 'isSelected' : ''}`}
                          aria-label={`Buka detail prospek ${item.name}`}
                          title={`Klik untuk melihat detail ${item.name}`}
                          onClick={(event) => handleLeadRowClick(event, item)}
                          onKeyDown={(event) => handleLeadRowKeyDown(event, item)}
                        >
                          {showSelection && (
                            <td className="leadSelectCell" onClick={(event) => event.stopPropagation()}>
                              <Checkbox
                                className="leadSoftCheckbox"
                                checked={selectedIds.has(item.id)}
                                onCheckedChange={(checked) => handleSelectRow(item.id, checked as boolean)}
                              />
                            </td>
                          )}
                          <td className="leadNoCell">{rowNumber}</td>
                          <td>
                            <TableText
                              primary={new Date(item.timestamp).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' })}
                              secondary={new Date(item.timestamp).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}
                            />
                          </td>
                          <td>
                            <div className="leadNameCell">
                              <TableText
                                primary={item.name}
                                secondary={!isAdvertiserView ? item.phone : undefined}
                                title={`${item.name} - ${item.phone}`}
                              />
                              <div className="leadInlineMeta">
                                <AutoWhatsAppLeadBadge lead={item} />
                                {itemLabels.slice(0, 3).map((labelId) => (
                                  <span
                                    key={labelId}
                                    title={`Label: ${getProspectLabelName(labelId)}`}
                                    style={getProspectLabelStyle(labelId)}
                                  >
                                    #{getProspectLabelName(labelId)}
                                  </span>
                                ))}
                                {!isAdvertiserView && socialHandle && (
                                  <span title={socialHandle}>
                                    {item.socialPlatform ? getLeadSocialPlatformLabel(item.socialPlatform) : 'Sosial'}: {socialHandle}
                                  </span>
                                )}
                              </div>
                            </div>
                          </td>
                          <td>
                            <TableText
                              primary={item.csId ? getCSName(item.csId) : '-'}
                              secondary={item.advertiserId ? users.find((user) => user.id === item.advertiserId)?.name : undefined}
                            />
                          </td>
                          <td>
                            <TableText primary={platformLabel} secondary={subChannelLabel} />
                          </td>
                          <td>
                            <TableText primary={getVehicleName(item.vehicleId)} />
                          </td>
                          <td>
                            <TableText
                              primary={getLeadNotesPreview(item.notes, 82)}
                              secondary={item.lastContact ? `Kontak: ${item.lastContact}` : 'Belum ada kontak'}
                              title={normalizeLeadNotes(item.notes)}
                            />
                          </td>
                          <td>
                            <div className="leadStatusStack">
                              <Badge variant="outline" className={`leadStatusBadge ${getStatusBadgeVariant(item.status)}`}>
                                {item.status}
                              </Badge>
                              {booking && (
                                <span className="leadBookingMeta" title={getBookingSummary(item.id)}>
                                  Booking {getBookingStatusLabel(booking)} - {getBookingSummary(item.id)}
                                </span>
                              )}
                            </div>
                          </td>
                          <td>
                            <div className="leadFollowUpCell" aria-label="Template follow up">
                              <span
                                className={`leadFollowUpPlanBadge ${getFollowUpPlanBadgeClass(item)}`}
                                title={getFollowUpPlanLabel(item)}
                              >
                                {getFollowUpPlanShortLabel(item)}
                              </span>
                              {visibleFollowUpTemplates.length > 0 ? visibleFollowUpTemplates.map((template) => {
                                const usageCount = getTemplateUsageCount(item, template.id);
                                const latestHistory = getLatestTemplateHistory(item, template.id);
                                const isUsed = usageCount > 0;
                                const tooltipText = isUsed
                                  ? `${template.title} sudah dipakai ${usageCount}x${latestHistory ? ` - ${formatTemplateSentAt(latestHistory.sentAt)}` : ''}`
                                  : `${template.title} belum dipakai`;

                                return (
                                  <Tooltip key={template.id}>
                                    <TooltipTrigger asChild>
                                      <button
                                        type="button"
                                        className={`leadFollowUpButton ${isUsed ? 'isUsed' : ''}`}
                                        disabled={!canSendLeadTemplate}
                                        onClick={(event) => {
                                          event.stopPropagation();
                                          if (!canSendLeadTemplate) return;
                                          handleWhatsappClick(item, template);
                                        }}
                                        aria-label={tooltipText}
                                      >
                                        {isUsed ? <CheckCircle2 className="h-4 w-4" /> : <MessageCircle className="h-4 w-4" />}
                                      </button>
                                    </TooltipTrigger>
                                    <TooltipContent side="top" className="leadFollowUpTooltip">
                                      <div>
                                        <strong>{template.title}</strong>
                                        <span>{isUsed ? `Dipakai ${usageCount}x` : 'Belum dipakai'}</span>
                                        {latestHistory && <small>{formatTemplateSentAt(latestHistory.sentAt)} - {getTemplateSenderName(latestHistory.sentBy)}</small>}
                                      </div>
                                    </TooltipContent>
                                  </Tooltip>
                                );
                              }) : (
                                <span className="leadFollowUpEmpty">-</span>
                              )}
                              {hiddenFollowUpTemplateCount > 0 && (
                                <button
                                  type="button"
                                  className="leadFollowUpMore"
                                  disabled={!canSendLeadTemplate}
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    if (!canSendLeadTemplate) return;
                                    setSelectedWaLead(item);
                                  }}
                                  aria-label={`Lihat ${hiddenFollowUpTemplateCount} template lain`}
                                >
                                  +{hiddenFollowUpTemplateCount}
                                </button>
                              )}
                            </div>
                          </td>
                          {!isAdvertiserView && (
                            <TableActionCell onClick={(event) => event.stopPropagation()}>
                              <TableActionMenu contentClassName="w-56">
                                <TableActionMenuItem icon={Eye} onClick={() => openLeadDetail(item)}>
                                  Detail
                                </TableActionMenuItem>
                                {canSendLeadTemplate && (
                                  <TableActionMenuItem icon={Phone} onClick={() => setSelectedWaLead(item)}>
                                    Template WA
                                  </TableActionMenuItem>
                                )}
                                {getLeadSocialUrl(item) && (
                                  <TableActionMenuItem icon={ExternalLink} onClick={() => handleLeadSocialOpen(item)}>
                                    {getLeadSocialPrimaryActionLabel(item)}
                                  </TableActionMenuItem>
                                )}
                                {socialHandle && (
                                  <TableActionMenuItem icon={Copy} onClick={() => void handleLeadSocialCopy(item)}>
                                    Salin Username
                                  </TableActionMenuItem>
                                )}
                                {canEditLead(item) && (
                                  <TableActionMenuItem icon={Edit} onClick={() => openEditLeadForm(item)}>
                                    Edit
                                  </TableActionMenuItem>
                                )}
                                {canEditLead(item) && (
                                  <TableActionMenuItem icon={Tags} onClick={() => openLeadLabelEditor(item)}>
                                    Atur Label
                                  </TableActionMenuItem>
                                )}
                                {canManageLeadBooking(item) && (
                                  <TableActionMenuItem icon={CalendarClock} onClick={() => openBookingForm(item)}>
                                    Booking Jadwal
                                  </TableActionMenuItem>
                                )}
                                {canManageLeadBooking(item) && getActiveLeadBooking(item.id) && (
                                  <TableActionMenuItem icon={Ban} onClick={() => void handleCancelLeadBooking(item, getActiveLeadBooking(item.id))}>
                                    Batalkan Booking
                                  </TableActionMenuItem>
                                )}
                                {canForwardLeadToOrder(item) && (
                                  <TableActionMenuItem icon={ArrowRightCircle} onClick={() => setForwardLead(item)}>
                                    Proses Order
                                  </TableActionMenuItem>
                                )}
                                {canDeleteLead(item) && (
                                  <TableActionMenuItem danger icon={Trash2} onClick={() => setDeleteId(item.id)}>
                                    Hapus
                                  </TableActionMenuItem>
                                )}
                              </TableActionMenu>
                            </TableActionCell>
                          )}
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </DataTable>

            <div className="leadMobileCardList">
              {leadTableLoading ? (
                <LeadMobileSkeleton />
              ) : paginatedLeads.length === 0 ? (
                <OperationalEmptyState
                  icon={UserIcon}
                  title="Tidak ada data prospek ditemukan"
                  description={
                    leads.length === 0
                      ? 'Belum ada prospek pada periode ini.'
                      : 'Coba ubah filter, tanggal, atau kata kunci pencarian.'
                  }
                />
              ) : (
                paginatedLeads.map((item, index) => {
                  const booking = getLeadBooking(item.id);
                  const activeBooking = getActiveLeadBooking(item.id);
                  const socialHandle = getLeadSocialHandle(item);
                  const socialUrl = getLeadSocialUrl(item);
                  const platformLabel = isAutoWhatsAppLead(item) ? 'WhatsApp' : item.platformId ? getPlatformName(item.platformId) : '-';
                  const subChannelLabel = isAutoWhatsAppLead(item) && !item.subChannelId ? 'Auto API' : getSubChannelName(item.subChannelId);
                  const rowNumber = (currentPage - 1) * itemsPerPage + index + 1;
                  const itemLabels = item.labels || [];
                  const followUpPlan = getLeadFollowUpPlan(item);

                  return (
                    <article
                      key={item.id}
                      className={`leadMobileCard ${selectedIds.has(item.id) ? 'isSelected' : ''}`}
                      role="button"
                      tabIndex={0}
                      onClick={() => openLeadDetail(item)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          openLeadDetail(item);
                        }
                      }}
                    >
                      <div className="leadMobileCardHeader">
                        <div className="leadMobileCardIdentity">
                          <div className="leadMobileCardTitleRow">
                            {showSelection && (
                              <span className="leadMobileSelect" onClick={(event) => event.stopPropagation()}>
                                <Checkbox
                                  className="leadSoftCheckbox"
                                  checked={selectedIds.has(item.id)}
                                  onCheckedChange={(checked) => handleSelectRow(item.id, checked as boolean)}
                                />
                              </span>
                            )}
                            <span className="leadMobileCardNo">#{rowNumber}</span>
                            <h3>{item.name}</h3>
                          </div>
                          {!isAdvertiserView && <span className="leadMobilePhone">{item.phone}</span>}
                        </div>

                        {!isAdvertiserView && (
                          <TableActionMenu
                            contentClassName="w-56"
                            trigger={(
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="leadMobileMoreButton"
                                onClick={(event) => event.stopPropagation()}
                                aria-label="Aksi prospek"
                              >
                                <MoreVertical className="h-4 w-4" />
                              </Button>
                            )}
                          >
                            <TableActionMenuItem icon={Eye} onClick={() => openLeadDetail(item)}>
                              Detail
                            </TableActionMenuItem>
                            {canSendLeadTemplate && (
                              <TableActionMenuItem icon={Phone} onClick={() => setSelectedWaLead(item)}>
                                Template WA
                              </TableActionMenuItem>
                            )}
                            {socialUrl && (
                              <TableActionMenuItem icon={ExternalLink} onClick={() => handleLeadSocialOpen(item)}>
                                {getLeadSocialPrimaryActionLabel(item)}
                              </TableActionMenuItem>
                            )}
                            {socialHandle && (
                              <TableActionMenuItem icon={Copy} onClick={() => void handleLeadSocialCopy(item)}>
                                Salin Username
                              </TableActionMenuItem>
                            )}
                            {canEditLead(item) && (
                              <TableActionMenuItem icon={Edit} onClick={() => openEditLeadForm(item)}>
                                Edit
                              </TableActionMenuItem>
                            )}
                            {canEditLead(item) && (
                              <TableActionMenuItem icon={Tags} onClick={() => openLeadLabelEditor(item)}>
                                Atur Label
                              </TableActionMenuItem>
                            )}
                            {canManageLeadBooking(item) && (
                              <TableActionMenuItem icon={CalendarClock} onClick={() => openBookingForm(item)}>
                                Booking Jadwal
                              </TableActionMenuItem>
                            )}
                            {canManageLeadBooking(item) && activeBooking && (
                              <TableActionMenuItem icon={Ban} onClick={() => void handleCancelLeadBooking(item, activeBooking)}>
                                Batalkan Booking
                              </TableActionMenuItem>
                            )}
                            {canForwardLeadToOrder(item) && (
                              <TableActionMenuItem icon={ArrowRightCircle} onClick={() => setForwardLead(item)}>
                                Proses Order
                              </TableActionMenuItem>
                            )}
                            {canDeleteLead(item) && (
                              <TableActionMenuItem danger icon={Trash2} onClick={() => setDeleteId(item.id)}>
                                Hapus
                              </TableActionMenuItem>
                            )}
                          </TableActionMenu>
                        )}
                      </div>

                      <div className="leadMobileBadgeRow">
                        <Badge variant="outline" className={`leadStatusBadge ${getStatusBadgeVariant(item.status)}`}>
                          {item.status}
                        </Badge>
                        <Badge
                          variant="outline"
                          className={getFollowUpPlanBadgeClass(item)}
                          title={followUpPlan.dueDate ? `Jadwal: ${formatProspectFollowUpDueDate(followUpPlan.dueDate)}` : undefined}
                        >
                          {getFollowUpPlanLabel(item)}
                        </Badge>
                        <AutoWhatsAppLeadBadge lead={item} />
                        {itemLabels.slice(0, 3).map((labelId) => (
                          <Badge
                            key={labelId}
                            variant="outline"
                            className="border-slate-200 bg-slate-50 text-slate-600"
                            style={getProspectLabelStyle(labelId)}
                          >
                            #{getProspectLabelName(labelId)}
                          </Badge>
                        ))}
                      </div>

                      <div className="leadMobileMetaGrid">
                        <div>
                          <span>Waktu</span>
                          <strong>{new Date(item.timestamp).toLocaleDateString('id-ID', { day: 'numeric', month: 'short' })}</strong>
                          <small>{new Date(item.timestamp).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}</small>
                        </div>
                        <div>
                          <span>Sumber</span>
                          <strong>{platformLabel}</strong>
                          <small>{subChannelLabel}</small>
                        </div>
                        <div>
                          <span>CS</span>
                          <strong>{item.csId ? getCSName(item.csId) : '-'}</strong>
                          <small>{item.advertiserId ? users.find((user) => user.id === item.advertiserId)?.name || '-' : '-'}</small>
                        </div>
                        <div>
                          <span>Mobil</span>
                          <strong>{getVehicleName(item.vehicleId)}</strong>
                        </div>
                      </div>

                      {item.notes && (
                        <p className="leadMobileNote" title={normalizeLeadNotes(item.notes)}>
                          {getLeadNotesPreview(item.notes, 92)}
                        </p>
                      )}

                      {booking && (
                        <div className="leadMobileBooking" title={getBookingSummary(item.id) || undefined}>
                          <strong>Booking {getBookingStatusLabel(booking)}</strong>
                          <span>{getBookingSummary(item.id) || '-'}</span>
                        </div>
                      )}

                      {!isAdvertiserView && (
                        <div className="leadMobileCardActions" onClick={(event) => event.stopPropagation()}>
                          <div className="leadMobileFollowUps" aria-label="Template follow up">
                            {visibleFollowUpTemplates.length > 0 ? visibleFollowUpTemplates.map((template) => {
                              const usageCount = getTemplateUsageCount(item, template.id);
                              const latestHistory = getLatestTemplateHistory(item, template.id);
                              const isUsed = usageCount > 0;
                              const tooltipText = isUsed
                                ? `${template.title} sudah dipakai ${usageCount}x${latestHistory ? ` - ${formatTemplateSentAt(latestHistory.sentAt)}` : ''}`
                                : `${template.title} belum dipakai`;

                              return (
                                <Tooltip key={template.id}>
                                  <TooltipTrigger asChild>
                                    <button
                                      type="button"
                                      className={`leadFollowUpButton ${isUsed ? 'isUsed' : ''}`}
                                      disabled={!canSendLeadTemplate}
                                      onClick={() => {
                                        if (!canSendLeadTemplate) return;
                                        handleWhatsappClick(item, template);
                                      }}
                                      aria-label={tooltipText}
                                    >
                                      {isUsed ? <CheckCircle2 className="h-4 w-4" /> : <MessageCircle className="h-4 w-4" />}
                                    </button>
                                  </TooltipTrigger>
                                  <TooltipContent side="top" className="leadFollowUpTooltip">
                                    <div>
                                      <strong>{template.title}</strong>
                                      <span>{isUsed ? `Dipakai ${usageCount}x` : 'Belum dipakai'}</span>
                                      {latestHistory && <small>{formatTemplateSentAt(latestHistory.sentAt)} - {getTemplateSenderName(latestHistory.sentBy)}</small>}
                                    </div>
                                  </TooltipContent>
                                </Tooltip>
                              );
                            }) : (
                              <span className="leadFollowUpEmpty">-</span>
                            )}
                            {hiddenFollowUpTemplateCount > 0 && (
                              <button
                                type="button"
                                className="leadFollowUpMore"
                                disabled={!canSendLeadTemplate}
                                onClick={() => {
                                  if (!canSendLeadTemplate) return;
                                  setSelectedWaLead(item);
                                }}
                                aria-label={`Lihat ${hiddenFollowUpTemplateCount} template lain`}
                              >
                                +{hiddenFollowUpTemplateCount}
                              </button>
                            )}
                          </div>

                          <div className="leadMobileQuickActions">
                            <Button
                              type="button"
                              size="icon"
                              variant="outline"
                              className="leadMobileQuickButton"
                              onClick={() => setSelectedWaLead(item)}
                              aria-label="Buka template WhatsApp"
                            >
                              <Phone className="h-4 w-4" />
                            </Button>
                            {socialUrl && (
                              <Button
                                type="button"
                                size="icon"
                                variant="outline"
                                className="leadMobileQuickButton"
                                onClick={() => handleLeadSocialOpen(item)}
                                aria-label={getLeadSocialPrimaryActionLabel(item)}
                              >
                                <ExternalLink className="h-4 w-4" />
                              </Button>
                            )}
                            {socialHandle && (
                              <Button
                                type="button"
                                size="icon"
                                variant="outline"
                                className="leadMobileQuickButton"
                                onClick={() => void handleLeadSocialCopy(item)}
                                aria-label="Salin kontak sosial"
                              >
                                <Copy className="h-4 w-4" />
                              </Button>
                            )}
                          </div>
                        </div>
                      )}
                    </article>
                  );
                })
              )}
            </div>

            <div className="leadPaginationBar">
              <span>
                Menampilkan {paginatedLeads.length ? (currentPage - 1) * itemsPerPage + 1 : 0}-
                {Math.min(currentPage * itemsPerPage, filteredData.length)} dari {filteredData.length} data
              </span>
              <div className="leadPaginationActions">
                <div className="leadPerPageControl">
                  <span>Tampilkan</span>
                  <Select
                    value={String(itemsPerPage)}
                    onValueChange={(value) => {
                      setItemsPerPage(Number(value));
                      setCurrentPage(1);
                    }}
                  >
                    <SelectTrigger className="leadPerPageSelect">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="z-[250]">
                      {LEAD_PAGE_SIZE_OPTIONS.map((option) => (
                        <SelectItem key={option} value={String(option)}>
                          {option} / Halaman
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  disabled={currentPage === 1}
                  onClick={() => setCurrentPage((prev) => Math.max(1, prev - 1))}
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <strong>{totalPages === 0 ? 0 : currentPage} / {totalPages || 0}</strong>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  disabled={currentPage === totalPages || totalPages === 0}
                  onClick={() => setCurrentPage((prev) => Math.min(totalPages, prev + 1))}
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </OperationalTableCard>
        ) : (
            /* KANBAN VIEW */
            leadTableLoading ? (
              <div className="leadKanbanBoard" aria-label="Memuat board prospek">
                {Array.from({ length: 5 }).map((_, index) => (
                  <section key={`lead-kanban-skeleton-${index}`} className="leadKanbanColumn">
                    <div className="leadKanbanColumnHeader">
                      <Skeleton className="h-6 w-28 rounded-md" />
                    </div>
                    <div className="leadKanbanList">
                      <Skeleton className="h-28 w-full rounded-lg" />
                      <Skeleton className="h-24 w-full rounded-lg" />
                    </div>
                  </section>
                ))}
              </div>
            ) : kanbanView
        )}
      </div>

      <Dialog
        open={isBulkEditOpen}
        onOpenChange={(open) => {
          setIsBulkEditOpen(open);
          if (!open) {
            setBulkField('');
            setBulkValue('');
          }
        }}
      >
        <MasterDataFormDialogContent size="default" className="leadBulkDialog">
          <MasterDataFormHeader
            icon={Edit}
            title={`Edit Massal (${selectedEditableLeads.length} Prospek)`}
            description="Pilih satu kolom untuk diperbarui ke prospek yang sedang dipilih."
          />
          <form
            className="masterDataForm"
            onSubmit={(event) => {
              event.preventDefault();
              void handleBulkUpdate();
            }}
          >
            <MasterDataDialogBody compact>
              <MasterDataFormGrid>
                <MasterDataFormField span="full">
                  <MasterDataFieldLabel required>Pilih Kolom</MasterDataFieldLabel>
                  <Select value={bulkField} onValueChange={(val) => { setBulkField(val); setBulkValue(''); }}>
                    <SelectTrigger>
                      <SelectValue placeholder="Pilih kolom yang akan diedit" />
                    </SelectTrigger>
                    <SelectContent className="z-[250]">
                      <SelectItem value="status">Status</SelectItem>
                      <SelectItem value="csId">CS / Staff</SelectItem>
                      <SelectItem value="advertiserId">Advertiser</SelectItem>
                      <SelectItem value="platformId">Sumber</SelectItem>
                      <SelectItem value="subChannelId">Sub Channel</SelectItem>
                      <SelectItem value="vehicleId">Kendaraan</SelectItem>
                    </SelectContent>
                  </Select>
                </MasterDataFormField>

                {bulkField && (
                  <MasterDataFormField span="full">
                    <MasterDataFieldLabel required>Nilai Baru</MasterDataFieldLabel>
                    {bulkField === 'status' ? (
                      <Select value={bulkValue} onValueChange={setBulkValue}>
                        <SelectTrigger><SelectValue placeholder="Pilih status" /></SelectTrigger>
                        <SelectContent className="z-[250]">
                          {bulkStatusOptions.map((status) => (
                            <SelectItem key={status} value={status}>
                              {status}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : bulkField === 'csId' ? (
                      <Select value={bulkValue} onValueChange={setBulkValue}>
                        <SelectTrigger><SelectValue placeholder="Pilih CS" /></SelectTrigger>
                        <SelectContent className="z-[250]">
                          {bulkCsOptions.map((user) => (
                            <SelectItem key={user.id} value={user.id}>{user.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : bulkField === 'advertiserId' ? (
                      <Select value={bulkValue} onValueChange={setBulkValue}>
                        <SelectTrigger><SelectValue placeholder="Pilih advertiser" /></SelectTrigger>
                        <SelectContent className="z-[250]">
                          {bulkAdvertiserOptions.map((user) => (
                            <SelectItem key={user.id} value={user.id}>{user.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : bulkField === 'platformId' ? (
                      <Select value={bulkValue} onValueChange={setBulkValue}>
                        <SelectTrigger><SelectValue placeholder="Pilih sumber" /></SelectTrigger>
                        <SelectContent className="z-[250]">
                          {bulkPlatformOptions.map((platform) => (
                            <SelectItem key={platform.id} value={platform.id}>{platform.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : bulkField === 'subChannelId' ? (
                      <Select value={bulkValue} onValueChange={setBulkValue}>
                        <SelectTrigger><SelectValue placeholder="Pilih sub channel" /></SelectTrigger>
                        <SelectContent className="z-[250]">
                          {bulkSubChannelOptions.map((subChannel) => (
                            <SelectItem key={subChannel.id} value={subChannel.id}>{subChannel.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : bulkField === 'vehicleId' ? (
                      <Select value={bulkValue} onValueChange={setBulkValue}>
                        <SelectTrigger><SelectValue placeholder="Pilih kendaraan" /></SelectTrigger>
                        <SelectContent className="z-[250]">
                          {activeVehicles.map((vehicle) => (
                            <SelectItem key={vehicle.id} value={vehicle.id}>{vehicle.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : null}
                  </MasterDataFormField>
                )}
              </MasterDataFormGrid>
            </MasterDataDialogBody>
            <MasterDataFormActions
              onCancel={() => {
                setIsBulkEditOpen(false);
                setBulkField('');
                setBulkValue('');
              }}
              saveLabel="Simpan Perubahan"
              submitDisabled={!bulkField || !bulkValue || selectedEditableLeads.length === 0}
            />
          </form>
        </MasterDataFormDialogContent>
      </Dialog>

      <Dialog
        open={!!labelTargetLead}
        onOpenChange={(open) => {
          if (!open) closeLeadLabelEditor();
        }}
      >
        <MasterDataFormDialogContent size="default" className="leadLabelEditorDialog">
          <MasterDataFormHeader
            icon={Tags}
            title="Atur Label Prospek"
            description={labelTargetLead ? `Pilih label untuk ${labelTargetLead.name}.` : 'Pilih label resmi untuk prospek.'}
          />
          <MasterDataDialogBody compact className="leadLabelEditorBody">
            {activeProspectLabels.length === 0 ? (
              <OperationalEmptyState
                icon={Tags}
                title="Belum ada master label aktif"
                description="Buat master label dulu agar prospek bisa ditandai dengan label yang konsisten."
                className="leadLabelEditorEmpty"
              />
            ) : (
              <>
                <div className="leadLabelEditorSummary">
                  <span>{labelEditorIds.length}/6</span>
                  <strong>label dipilih</strong>
                  <small>Maksimal 6 label per prospek.</small>
                </div>
                <div className="leadLabelEditorList">
                  {activeProspectLabels.map((label) => {
                    const checked = labelEditorIds.includes(label.id);
                    return (
                      <div
                        key={label.id}
                        role="button"
                        tabIndex={0}
                        className={`leadLabelChoice ${checked ? 'isSelected' : ''}`}
                        onClick={() => toggleLeadLabel(label.id)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault();
                            toggleLeadLabel(label.id);
                          }
                        }}
                      >
                        <Checkbox
                          className="leadLabelChoiceCheck"
                          checked={checked}
                          onClick={(event) => event.stopPropagation()}
                          onCheckedChange={() => toggleLeadLabel(label.id)}
                        />
                        <span className="leadLabelChoiceDot" style={{ backgroundColor: label.color }} />
                        <span className="leadLabelChoiceText">
                          <strong>#{label.name}</strong>
                          <small>
                            {label.description || (label.followUpEnabled ? 'Masuk rencana follow up' : 'Label segmentasi prospek')}
                          </small>
                        </span>
                        {label.followUpEnabled && (
                          <Badge variant="outline" className="leadLabelChoiceBadge">
                            Plan FU
                          </Badge>
                        )}
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </MasterDataDialogBody>
          <DialogFooter className="masterDataFormActions leadLabelEditorActions">
            <Button type="button" variant="outline" className="leadLabelEditorCancelButton" onClick={closeLeadLabelEditor}>
              <X className="h-4 w-4" />
              Batal
            </Button>
            {activeProspectLabels.length === 0 ? (
              <Button
                type="button"
                className="leadLabelEditorSaveButton"
                onClick={() => {
                  closeLeadLabelEditor();
                  setIsLabelManagerOpen(true);
                }}
              >
                <Settings2 className="h-4 w-4" />
                Kelola Label
              </Button>
            ) : (
              <Button type="button" className="leadLabelEditorSaveButton" onClick={() => void handleSaveLeadLabels()}>
                <Save className="h-4 w-4" />
                Simpan Label
              </Button>
            )}
          </DialogFooter>
        </MasterDataFormDialogContent>
      </Dialog>

      <Dialog
        open={isLabelManagerOpen}
        onOpenChange={(open) => {
          setIsLabelManagerOpen(open);
          if (!open) resetLabelDraft();
        }}
      >
        <MasterDataFormDialogContent size="wide" className="leadFormDialog">
          <MasterDataFormHeader
            icon={Tags}
            title="Master Label Prospek"
            description="Buat label resmi untuk segmentasi dan rencana follow up prospek."
          />
          <MasterDataDialogBody compact className="prospectLabelDialogBody">
            <section className="prospectLabelComposer">
              <div className="prospectLabelComposerHeader">
                <div>
                  <span>{editingLabel ? 'Edit master label' : 'Label baru'}</span>
                  <h3>Atur label resmi untuk prospek</h3>
                </div>
                <span
                  className="prospectLabelPreview"
                  style={{
                    borderColor: `${labelDraft.color || '#2563EB'}55`,
                    color: labelDraft.color || '#2563EB',
                    backgroundColor: `${labelDraft.color || '#2563EB'}12`,
                  }}
                >
                  #{labelDraft.name.trim() || 'Preview Label'}
                </span>
              </div>

              <div className="prospectLabelFormGrid">
                <div className="space-y-2 prospectLabelNameField">
                <MasterDataFieldLabel required>Nama Label</MasterDataFieldLabel>
                <Input
                  className="uiInput bg-white"
                  value={labelDraft.name}
                  onChange={(event) => setLabelDraft((prev) => ({ ...prev, name: event.target.value }))}
                  placeholder="Contoh: Hot Lead, Butuh Promo, FU Intensif"
                />
              </div>
              <div className="space-y-2">
                <MasterDataFieldLabel>Warna</MasterDataFieldLabel>
                <div className="prospectLabelColorInput">
                  <input
                    type="color"
                    value={labelDraft.color}
                    onChange={(event) => setLabelDraft((prev) => ({ ...prev, color: event.target.value }))}
                    className="h-8 w-10 cursor-pointer rounded-md border-0 bg-transparent p-0"
                    aria-label="Warna label"
                  />
                  <Input
                    className="h-8 border-0 bg-transparent p-0 font-mono text-sm shadow-none focus-visible:ring-0"
                    value={labelDraft.color}
                    onChange={(event) => setLabelDraft((prev) => ({ ...prev, color: event.target.value || '#2563EB' }))}
                  />
                </div>
              </div>
              <div className="space-y-2">
                <MasterDataFieldLabel>Status</MasterDataFieldLabel>
                <Select
                  value={labelDraft.status}
                  onValueChange={(value) => setLabelDraft((prev) => ({ ...prev, status: value as ProspectLabel['status'] }))}
                >
                  <SelectTrigger className="uiInput bg-white">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">Aktif</SelectItem>
                    <SelectItem value="inactive">Nonaktif</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2 prospectLabelDescriptionField">
                <MasterDataFieldLabel>Deskripsi</MasterDataFieldLabel>
                <Textarea
                  className="min-h-20 bg-white"
                  value={labelDraft.description}
                  onChange={(event) => setLabelDraft((prev) => ({ ...prev, description: event.target.value }))}
                  placeholder="Catatan internal kapan label ini dipakai."
                />
              </div>
                <label className="prospectLabelFollowSwitch">
                  <span>
                    <strong>Ikut Plan FU</strong>
                    <small>Label ini masuk jadwal follow up 1-6.</small>
                  </span>
                  <Switch
                    checked={labelDraft.followUpEnabled}
                    onCheckedChange={(checked) => setLabelDraft((prev) => ({ ...prev, followUpEnabled: checked }))}
                  />
                </label>
              </div>

              <div className="prospectLabelComposerActions">
                <Button type="button" onClick={() => void handleSaveProspectLabel()}>
                  {editingLabel ? 'Simpan Label' : 'Tambah Label'}
                </Button>
                {editingLabel && (
                  <Button type="button" variant="outline" onClick={resetLabelDraft}>
                    Batal Edit
                  </Button>
                )}
              </div>
            </section>

            <section className="prospectLabelListPanel">
              <div className="prospectLabelListHeader">
                <div>
                  <span>Daftar Label</span>
                  <strong>{sortedProspectLabels.length} label</strong>
                </div>
                <p>Label aktif muncul di filter dan form prospek.</p>
              </div>
              {sortedProspectLabels.length === 0 ? (
                <OperationalEmptyState
                  icon={Tags}
                  title="Belum ada label prospek"
                  description="Tambahkan label resmi agar CS bisa menandai prospek tanpa input bebas."
                  className="prospectLabelEmpty"
                />
              ) : (
                <div className="prospectLabelList">
                  {sortedProspectLabels.map((label) => {
                    const usageCount = prospectLabelUsageCount.get(label.id) || 0;
                    return (
                      <div key={label.id} className="prospectLabelListItem">
                        <div className="prospectLabelListMain">
                          <span className="prospectLabelDot" style={{ backgroundColor: label.color }} />
                          <div className="min-w-0">
                            <div className="prospectLabelTitleRow">
                              <strong style={{ color: label.color }}>#{label.name}</strong>
                              <Badge variant="outline" className={label.status === 'active' ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-slate-200 bg-slate-50 text-slate-500'}>
                                {label.status === 'active' ? 'Aktif' : 'Nonaktif'}
                              </Badge>
                              {label.followUpEnabled && (
                                <Badge variant="outline" className="border-blue-200 bg-blue-50 text-blue-700">
                                  Plan FU
                                </Badge>
                              )}
                              <Badge variant="outline" className="border-slate-200 bg-slate-50 text-slate-600">
                                {usageCount} prospek
                              </Badge>
                            </div>
                            <p>{label.description || 'Belum ada deskripsi penggunaan label.'}</p>
                          </div>
                        </div>
                        <div className="prospectLabelListActions">
                          <Button type="button" variant="outline" size="sm" onClick={() => openEditProspectLabel(label)}>
                            Edit
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => void handleDeleteProspectLabel(label)}
                          >
                            {usageCount > 0 ? 'Nonaktifkan' : 'Hapus'}
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          </MasterDataDialogBody>
        </MasterDataFormDialogContent>
      </Dialog>

      <Dialog open={isAddOpen} onOpenChange={handleAddSheetOpenChange}>
        <MasterDataFormDialogContent size="wide" className="leadFormDialog">
          <MasterDataFormHeader
            icon={UserIcon}
            title={editingItem ? 'Edit Prospek' : 'Tambah Prospek Baru'}
            description={`Isi data untuk ${editingItem ? 'memperbarui' : 'menambahkan'} prospek.`}
          />
          <LeadForm
            key={editingItem ? `edit-${editingItem.id}` : `new-${leadFormInstanceKey}`}
            item={editingItem}
            platforms={activePlatforms}
            vehicles={activeVehicles}
            csUsers={csUsers}
            advertiserUsers={advertiserUsers}
            currentUser={currentUser}
            onSubmit={handleSubmit}
            onCancel={() => setIsAddOpen(false)}
          />
        </MasterDataFormDialogContent>
      </Dialog>

      <Dialog open={!!bookingLead} onOpenChange={(open) => !open && setBookingLead(null)}>
        <MasterDataFormDialogContent size="wide" className="leadFormDialog">
          <MasterDataFormHeader
            icon={CalendarClock}
            title={selectedLeadBooking ? 'Edit Booking Prospek' : 'Booking Jadwal Prospek'}
            description="Simpan booking awal dari prospek tanpa melengkapi data pesanan penuh."
          />
          {bookingLead && (
            <ProspectBookingForm
              lead={bookingLead}
              booking={selectedLeadBooking}
              editableCustomerFields
              onSubmit={handleBookingSubmit}
              onCancelBooking={(booking) => void handleCancelLeadBooking(bookingLead, booking)}
              onCancel={() => setBookingLead(null)}
            />
          )}
        </MasterDataFormDialogContent>
      </Dialog>

      <Dialog open={!!detailLead} onOpenChange={(open) => !open && setDetailLead(null)}>
        <MasterDataFormDialogContent size="wide" className="leadDetailDialog" preventOutsideClose={false}>
          <MasterDataFormHeader
            icon={UserIcon}
            title="Detail Prospek"
            description="Ringkasan data prospek, sumber, status, dan booking."
          />
          {detailLead && (() => {
            const detailBooking = getLeadBooking(detailLead.id);
            const activeDetailBooking = getActiveLeadBooking(detailLead.id);
            const detailSocialHandle = getLeadSocialHandle(detailLead);
            const detailSocialUrl = getLeadSocialUrl(detailLead);
            const detailAdvertiserName = detailLead.advertiserId
              ? users.find((user) => user.id === detailLead.advertiserId)?.name || '-'
              : '-';
            const followUpCount = detailLead.templateHistory?.length || 0;
            const sortedFollowUpHistory = [...(detailLead.templateHistory || [])]
              .sort((left, right) => new Date(right.sentAt).getTime() - new Date(left.sentAt).getTime());
            const latestFollowUp = sortedFollowUpHistory[0];
            const detailCsName = detailLead.csId ? getCSName(detailLead.csId) : '-';
            const detailSourceLabel = isAutoWhatsAppLead(detailLead)
              ? 'WhatsApp'
              : detailLead.platformId ? getPlatformName(detailLead.platformId) : '-';
            const detailSubChannelLabel = isAutoWhatsAppLead(detailLead) && !detailLead.subChannelId
              ? 'Auto API'
              : getSubChannelName(detailLead.subChannelId);
            const detailVehicleName = getVehicleName(detailLead.vehicleId || detailBooking?.vehicleId);
            const detailServiceName = getServiceName(detailLead.serviceId || detailBooking?.serviceId);
            const detailCanManageBooking = canManageLeadBooking(detailLead);
            const detailCanForwardOrder = canForwardLeadToOrder(detailLead);
            const detailLabels = detailLead.labels || [];
            const detailFollowUpPlan = getLeadFollowUpPlan(detailLead);
            const bookingSchedule = detailBooking
              ? [formatBookingDate(detailBooking), detailBooking.scheduleTime].filter((value) => value && value !== '-').join(' - ') || '-'
              : '-';
            const bookingLocation = detailBooking
              ? [getBranchName(detailBooking.branchId), getAreaName(detailBooking.areaId)].filter((value) => value && value !== '-').join(' - ') || '-'
              : '-';
            const trackingRows = ([
              ['Asal Data', detailLead.origin],
              ['Form Embed', detailLead.embedFormName || detailLead.embedFormSlug],
              ['Landing Page', detailLead.landingPageUrl],
              ['UTM Source', detailLead.utmSource],
              ['UTM Medium', detailLead.utmMedium],
              ['UTM Campaign', detailLead.utmCampaign],
              ['UTM Term', detailLead.utmTerm],
              ['UTM Content', detailLead.utmContent],
            ] as Array<[string, string | undefined]>).filter(([, value]) => Boolean(value));
            const initials = detailLead.name
              .split(/\s+/)
              .filter(Boolean)
              .map((part) => part[0])
              .join('')
              .slice(0, 2)
              .toUpperCase() || '?';

            return (
              <MasterDataDialogBody ref={leadDetailBodyRef} compact className="leadDetailBody">
                <FoundationDetailShell className="leadProspectDetail">
                  <FoundationDetailHero
                    avatar={initials}
                    eyebrow="Prospek CRM"
                    title={detailLead.name || 'Tanpa nama'}
                    subtitle={isAdvertiserView ? 'Kontak disembunyikan' : detailLead.phone || '-'}
                    badges={
                      <>
                        <Badge variant="outline" className={`leadStatusBadge ${getStatusBadgeVariant(detailLead.status)}`}>
                          {detailLead.status}
                        </Badge>
                        <Badge variant="outline" className={getFollowUpPlanBadgeClass(detailLead)}>
                          {getFollowUpPlanLabel(detailLead)}
                        </Badge>
                        <AutoWhatsAppLeadBadge lead={detailLead} />
                      </>
                    }
                    actions={
                      <>
                        {canSendLeadTemplate && (
                          <Button type="button" variant="outline" onClick={() => {
                            setDetailLead(null);
                            setSelectedWaLead(detailLead);
                          }}>
                            <Phone className="h-4 w-4" />
                            Template WA
                          </Button>
                        )}
                        {canSendLeadTemplate && (
                          <Button type="button" variant="outline" onClick={() => handleWhatsappClick(detailLead)}>
                            <WhatsappIcon className="h-4 w-4" />
                            Chat
                          </Button>
                        )}
                        {detailSocialUrl && (
                          <Button type="button" variant="outline" onClick={() => handleLeadSocialOpen(detailLead)}>
                            <ExternalLink className="h-4 w-4" />
                            {getLeadSocialPrimaryActionLabel(detailLead)}
                          </Button>
                        )}
                      </>
                    }
                  />

                  <FoundationDetailMetricGrid>
                    <FoundationDetailMetric
                      icon={CheckCircle2}
                      label="Status"
                      value={detailLead.status}
                      description={new Date(detailLead.timestamp).toLocaleDateString('id-ID', { dateStyle: 'medium' })}
                    />
                    <FoundationDetailMetric
                      icon={MessageCircle}
                      label="Follow Up"
                      value={detailFollowUpPlan.nextStep ? `FU ${detailFollowUpPlan.nextStep}` : `${followUpCount}x`}
                      description={detailFollowUpPlan.dueDate ? formatProspectFollowUpDueDate(detailFollowUpPlan.dueDate) : latestFollowUp ? formatTemplateSentAt(latestFollowUp.sentAt) : 'Belum ada aktivitas'}
                    />
                    <FoundationDetailMetric
                      icon={CalendarClock}
                      label="Booking"
                      value={detailBooking ? getBookingStatusLabel(detailBooking) : '-'}
                      description={detailBooking ? getBookingSummary(detailLead.id) || 'Jadwal belum lengkap' : 'Belum ada booking'}
                    />
                  </FoundationDetailMetricGrid>

                  <FoundationDetailSection title="Data Prospek" description="Kontak, sumber, dan assignment prospek.">
                    <FoundationDetailFieldGrid>
                      <FoundationDetailField label="Waktu Masuk" value={new Date(detailLead.timestamp).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' })} />
                      <FoundationDetailField label="CS / Staff" value={detailCsName} />
                      <FoundationDetailField label="Advertiser" value={detailAdvertiserName} />
                      <FoundationDetailField label="Sumber" value={detailSourceLabel} />
                      <FoundationDetailField label="Sub Channel" value={detailSubChannelLabel} />
                      <FoundationDetailField label="Mobil" value={detailVehicleName} />
                      <FoundationDetailField label="Layanan" value={detailServiceName} />
                      <FoundationDetailField label="Kontak Terakhir" value={detailLead.lastContact || '-'} />
                      <FoundationDetailField label="Sosial" value={detailSocialHandle || '-'} />
                      <FoundationDetailField label="Nomor" value={isAdvertiserView ? 'Kontak disembunyikan' : detailLead.phone || '-'} />
                      <FoundationDetailField label="Label" span="full">
                        {detailLabels.length > 0 ? (
                          <span className="flex flex-wrap gap-1.5">
                            {detailLabels.map((labelId) => (
                              <Badge
                                key={labelId}
                                variant="outline"
                                className="border-slate-200 bg-slate-50 text-slate-600"
                                style={getProspectLabelStyle(labelId)}
                              >
                                #{getProspectLabelName(labelId)}
                              </Badge>
                            ))}
                          </span>
                        ) : (
                          <span className="foundationDetailTextBlock">-</span>
                        )}
                      </FoundationDetailField>
                      <FoundationDetailField label="Catatan" span="full">
                        <span className="foundationDetailTextBlock">{normalizeLeadNotes(detailLead.notes) || '-'}</span>
                      </FoundationDetailField>
                    </FoundationDetailFieldGrid>
                  </FoundationDetailSection>

                  <FoundationDetailSection
                    title="Booking Prospek"
                    description={detailBooking ? 'Jadwal dan konteks booking terbaru.' : 'Belum ada booking untuk prospek ini.'}
                    actions={detailCanManageBooking ? (
                      <>
                        <Button type="button" variant="outline" onClick={() => {
                          setDetailLead(null);
                          openBookingForm(detailLead);
                        }}>
                          <CalendarClock className="h-4 w-4" />
                          {detailBooking ? 'Edit Booking' : 'Booking Jadwal'}
                        </Button>
                        {activeDetailBooking && (
                          <Button type="button" variant="outline" onClick={() => void handleCancelLeadBooking(detailLead, activeDetailBooking)}>
                            <Ban className="h-4 w-4" />
                            Batalkan
                          </Button>
                        )}
                        {detailCanForwardOrder && (
                          <Button type="button" onClick={() => {
                            setDetailLead(null);
                            setForwardLead(detailLead);
                          }}>
                            <ArrowRightCircle className="h-4 w-4" />
                            Proses Order
                          </Button>
                        )}
                      </>
                    ) : undefined}
                  >
                    {detailBooking ? (
                      <FoundationDetailFieldGrid>
                        <FoundationDetailField label="Status" value={getBookingStatusLabel(detailBooking)} />
                        <FoundationDetailField label="Jadwal" value={bookingSchedule} />
                        <FoundationDetailField label="Lokasi" value={bookingLocation} />
                        <FoundationDetailField label="Teknisi" value={detailBooking.technicianId ? getCSName(detailBooking.technicianId) : '-'} />
                        <FoundationDetailField label="Alamat" span="full">
                          <span className="foundationDetailTextBlock">{detailBooking.address || '-'}</span>
                        </FoundationDetailField>
                        <FoundationDetailField label="Catatan Booking" span="full">
                          <span className="foundationDetailTextBlock">{detailBooking.notes || '-'}</span>
                        </FoundationDetailField>
                      </FoundationDetailFieldGrid>
                    ) : (
                      <div className="leadDetailEmptyPanel">
                        <CalendarClock className="h-4 w-4" />
                        <span>Booking belum dibuat.</span>
                      </div>
                    )}
                  </FoundationDetailSection>

                  {trackingRows.length > 0 && (
                    <FoundationDetailSection title="Tracking" description="Konteks asal prospek dari form atau campaign.">
                      <FoundationDetailFieldGrid>
                        {trackingRows.map(([label, value]) => (
                          <FoundationDetailField key={`${label}-${value}`} label={label} value={value} />
                        ))}
                      </FoundationDetailFieldGrid>
                    </FoundationDetailSection>
                  )}

                  <FoundationDetailSection
                    title="Plan Follow Up"
                    description={leadTemplates.length > 0 ? 'Urutan template dan jadwal follow up prospek.' : 'Belum ada template Leads aktif.'}
                    badge={
                      <Badge variant="outline" className={getFollowUpPlanBadgeClass(detailLead)}>
                        {detailFollowUpPlan.completedCount}/{detailFollowUpPlan.totalSteps || leadTemplates.length} selesai
                      </Badge>
                    }
                  >
                    {leadTemplates.length > 0 ? (
                      <div className="leadDetailTimeline">
                        {leadTemplates.map((template, templateIndex) => {
                          const latestHistory = getLatestTemplateHistory(detailLead, template.id);
                          const isUsed = Boolean(latestHistory);
                          const isNext = detailFollowUpPlan.nextTemplate?.id === template.id;

                          return (
                            <div key={template.id} className="leadDetailTimelineItem">
                              <span className="leadDetailTimelineIcon">
                                {isUsed ? <CheckCircle2 className="h-4 w-4" /> : <MessageCircle className="h-4 w-4" />}
                              </span>
                              <div>
                                <strong>
                                  FU {template.followUpStep || templateIndex + 1}: {template.title}
                                </strong>
                                <span>
                                  {isUsed
                                    ? `${formatTemplateSentAt(latestHistory.sentAt)} - ${getTemplateSenderName(latestHistory.sentBy)}`
                                    : isNext && detailFollowUpPlan.dueDate
                                      ? `Jadwal: ${formatProspectFollowUpDueDate(detailFollowUpPlan.dueDate)}`
                                      : `Jeda H+${template.followUpDelayDays ?? 0}`}
                                </span>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <div className="leadDetailEmptyPanel">
                        <MessageCircle className="h-4 w-4" />
                        <span>Template follow up Leads belum aktif.</span>
                      </div>
                    )}
                  </FoundationDetailSection>

                  <FoundationDetailSection
                    title="Riwayat Follow Up"
                    description="Aktivitas template WhatsApp yang pernah dikirim."
                    badge={
                      <Badge variant="outline" className="leadFollowUpHistoryCount">
                        {followUpCount} aktivitas
                      </Badge>
                    }
                  >
                    {followUpCount > 0 ? (
                      <div className="leadDetailTimeline">
                        {sortedFollowUpHistory.map((history, historyIndex) => (
                          <div key={`${history.templateId}-${history.sentAt}-${historyIndex}`} className="leadDetailTimelineItem">
                            <span className="leadDetailTimelineIcon">
                              <CheckCircle2 className="h-4 w-4" />
                            </span>
                            <div>
                              <strong>{history.templateName}</strong>
                              <span>{formatTemplateSentAt(history.sentAt)} - {getTemplateSenderName(history.sentBy)}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="leadDetailEmptyPanel">
                        <MessageCircle className="h-4 w-4" />
                        <span>Belum ada template follow up yang dipakai.</span>
                      </div>
                    )}
                  </FoundationDetailSection>
                </FoundationDetailShell>
              </MasterDataDialogBody>
            );
          })()}
          <DialogFooter className="masterDataFormActions">
            <Button type="button" variant="outline" onClick={() => setDetailLead(null)}>
              Tutup
            </Button>
            {!isAdvertiserView && detailLead && canEditLead(detailLead) && (
              <Button
                type="button"
                icon={<Edit className="h-4 w-4" />}
                onClick={() => {
                  const lead = detailLead;
                  setDetailLead(null);
                  openEditLeadForm(lead);
                }}
              >
                Edit Prospek
              </Button>
            )}
          </DialogFooter>
        </MasterDataFormDialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <AlertDialog open={!!deleteId} onOpenChange={(open) => !open && setDeleteId(null)}>
        <AlertDialogContent className="max-w-md bg-white dark:bg-slate-800 dark:border-slate-700">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 dark:text-slate-200">
              <Trash2 className="h-5 w-5 text-red-600" />
              Hapus prospek?
            </AlertDialogTitle>
            <AlertDialogDescription className="space-y-2 dark:text-slate-400">
              <span className="block">
                {deleteLeadTarget ? (
                  <>
                    Prospek <span className="font-semibold text-slate-900 dark:text-slate-100">{deleteLeadTarget.name}</span>
                    {!isAdvertiserView && deleteLeadTarget.phone ? (
                      <> dengan nomor <span className="font-semibold text-slate-900 dark:text-slate-100">{deleteLeadTarget.phone}</span></>
                    ) : null}
                    {' '}akan dihapus permanen.
                  </>
                ) : (
                  'Prospek ini akan dihapus permanen.'
                )}
              </span>
              <span className="block">Tindakan ini tidak dapat dibatalkan.</span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="dark:bg-slate-700 dark:text-slate-200 dark:border-slate-600">Batal</AlertDialogCancel>
            <AlertDialogAction variant="danger" className="bg-red-600 hover:bg-red-700 text-white" onClick={() => void confirmDelete()}>
              Ya, hapus
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Mass Delete Confirmation */}
      <AlertDialog open={isMassDeleteOpen} onOpenChange={setIsMassDeleteOpen}>
        <AlertDialogContent className="max-w-md bg-white dark:bg-slate-800 dark:border-slate-700">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 dark:text-slate-200">
              <Trash2 className="h-5 w-5 text-red-600" />
              Hapus {selectedDeletableLeads.length} prospek?
            </AlertDialogTitle>
            <AlertDialogDescription className="dark:text-slate-400">
              Prospek yang bisa dihapus akan dihapus permanen. Tindakan ini tidak dapat dibatalkan.
              {selectedIds.size > selectedDeletableLeads.length ? ` ${selectedIds.size - selectedDeletableLeads.length} prospek terkunci akan dilewati.` : ''}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="dark:bg-slate-700 dark:text-slate-200 dark:border-slate-600">Batal</AlertDialogCancel>
            <AlertDialogAction variant="danger" className="bg-red-600 hover:bg-red-700 text-white" onClick={() => void confirmMassDelete()}>
              Ya, hapus
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Forward to Order Modal */}
      {forwardLead && canForwardLeadToOrder(forwardLead) && (
         <OrderForm 
            isOpen={!!forwardLead}
            onClose={() => setForwardLead(null)}
            prefillData={forwardOrderPrefill || undefined}
            onSuccess={(order) => handleOrderSuccess(order)}
         />
      )}
      {/* WA Template Selection Dialog */}
      <Dialog open={!!selectedWaLead} onOpenChange={(open) => !open && setSelectedWaLead(null)}>
        <MasterDataFormDialogContent size="default" className="leadTemplateDialog">
            <MasterDataFormHeader
              icon={Phone}
              title="Pilih Template Pesan"
              description={<>Kirim pesan WhatsApp ke <strong>{selectedWaLead?.name}</strong>.</>}
            />
            <MasterDataDialogBody compact className="leadTemplateBody">
                <Button 
                    variant="outline" 
                    className="leadTemplateBlankButton"
                    onClick={() => {
                        if (selectedWaLead) {
                            handleWhatsappClick(selectedWaLead);
                            setSelectedWaLead(null);
                        }
                    }}
                >
                    <div className="leadTemplateOptionInner">
                        <span className="leadTemplateIcon isWhatsapp">
                          <Phone className="h-4 w-4" />
                        </span>
                        <span>
                          <strong>Chat Tanpa Template</strong>
                          <small>Buka chat WhatsApp kosong</small>
                        </span>
                    </div>
                </Button>
                
                <div className="leadTemplateDivider">
                   <span>Template Tersedia</span>
                </div>
                
                {leadTemplates.length > 0 ? leadTemplates.map(template => (
                    <Button
                        key={template.id}
                        variant="ghost"
                        className={`leadTemplateItem ${selectedWaLead && isTemplateUsed(selectedWaLead, template.id) ? 'isUsed' : ''}`}
                        onClick={() => {
                             if (selectedWaLead) {
                                 handleWhatsappClick(selectedWaLead, template);
                                 setSelectedWaLead(null);
                             }
                        }}
                    >
                         <div className="leadTemplateOptionInner">
                             <span className="leadTemplateIcon">
                               <MessageCircle className="h-4 w-4" />
                             </span>
                             <span className="leadTemplateCopy">
                                 <span className="leadTemplateNameRow">
                                    <strong>{template.title}</strong>
                                    {selectedWaLead && isTemplateUsed(selectedWaLead, template.id) && (
                                        <Badge variant="secondary" className="leadTemplateUsedBadge">
                                            Dikirim {selectedWaLead.templateHistory?.filter(h => h.templateId === template.id).length}x
                                        </Badge>
                                    )}
                                 </span>
                                 <small>{template.message}</small>
                             </span>
                         </div>
                    </Button>
                )) : (
                    <div className="leadTemplateEmpty">
                        <MessageCircle className="h-5 w-5" />
                        <span>Belum ada template tersedia</span>
                    </div>
                )}
            </MasterDataDialogBody>
        </MasterDataFormDialogContent>
      </Dialog>
    </OperationalPageShell>
  );
};
