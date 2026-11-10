import React from 'react';
import {
  AlertTriangle,
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  Eye,
  Loader2,
  Mail,
  MessageCircle,
  MoreVertical,
  Pencil,
  Phone,
  Plus,
  RefreshCcw,
  Save,
  Search,
  Smartphone,
  StickyNote,
  Trash2,
  Users,
  MapPin,
} from 'lucide-react';
import { toast } from 'sonner';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/app/components/ui/alert-dialog';
import { Badge } from '@/app/components/ui/badge';
import { Button } from '@/app/components/ui/button';
import {
  createDataTableColumns,
  DataTable,
  TableActionMenu,
  TableActionMenuItem,
} from '@/app/components/ui/data-table';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/app/components/ui/dialog';
import { Input } from '@/app/components/ui/input';
import { Label } from '@/app/components/ui/label';
import {
  OperationalFilterPanel,
  OperationalKpiCard,
  OperationalKpiGrid,
  OperationalPageHeader,
  OperationalPageShell,
  OperationalTableCard,
} from '@/app/components/ui/operational-page';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/app/components/ui/select';
import { Skeleton } from '@/app/components/ui/skeleton';
import { Textarea } from '@/app/components/ui/textarea';
import { MasterDataTableTitle } from '@/app/components/ui/master-data-table-title';
import {
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/app/components/ui/table';
import { cn } from '@/app/components/ui/utils';
import {
  fetchWhatsAppContacts,
  type WhatsAppAccount,
  type WhatsAppContact,
  type WhatsAppProvider,
} from '@/app/services/whatsappModuleService';
import {
  archiveCrmContact,
  createManualCrmContact,
  fetchCrmContactsPage,
  isSavedCrmContact,
  updateCrmContact,
  type CrmContact,
} from '@/app/services/crmContactsService';
import { useMasterData } from '@/app/pages/master-data/context';
import {
  formatDateTime,
  formatNumber,
  formatPhoneNumber,
  getProviderLabel,
  WhatsAppContactAvatar,
} from './components/whatsappModuleShared';
import { useWhatsAppOverview } from './useWhatsAppOverview';
import { FilterRow } from '@/app/components/ui/control-layout';

const ALL_CS_FILTER = 'all';
const UNASSIGNED_CS_FILTER = '__unassigned';
const CONTACTS_FAST_LOAD_TIMEOUT_MS = 15_000;
const WHATSAPP_CONTACTS_BACKGROUND_TIMEOUT_MS = 14_000;
const CRM_CONTACTS_PAGE_SIZE = 1000;
const CRM_CONTACTS_MAX_BACKGROUND_ROWS = 10_000;
const CONTACT_PAGE_SIZE_OPTIONS = [50, 100, 300, 500];
const CONTACT_UNASSIGNED_CS_VALUE = '__contact_unassigned';
const CONTACT_TABLE_MIN_WIDTH = 1760;
const ALL_WORK_STATUS_FILTER = 'all';
const NO_WORK_STATUS_FILTER = '__no_work_status';
const ALL_FOLLOW_UP_FILTER = 'all';
const FOLLOW_UP_DUE_FILTER = 'due';
const FOLLOW_UP_TODAY_FILTER = 'today';
const FOLLOW_UP_OVERDUE_FILTER = 'overdue';
const FOLLOW_UP_SCHEDULED_FILTER = 'scheduled';
const FOLLOW_UP_UNSET_FILTER = 'unset';
const FOLLOW_UP_STATUS_OPTIONS = [
  { id: 'none', label: 'Belum diatur' },
  { id: 'follow_up', label: 'Follow up' },
  { id: 'waiting_response', label: 'Menunggu respon' },
  { id: 'done', label: 'Selesai' },
];

type CsFilterValue = typeof ALL_CS_FILTER | typeof UNASSIGNED_CS_FILTER | string;
type WorkStatusFilterValue = typeof ALL_WORK_STATUS_FILTER | typeof NO_WORK_STATUS_FILTER | string;
type FollowUpFilterValue =
  | typeof ALL_FOLLOW_UP_FILTER
  | typeof FOLLOW_UP_DUE_FILTER
  | typeof FOLLOW_UP_TODAY_FILTER
  | typeof FOLLOW_UP_OVERDUE_FILTER
  | typeof FOLLOW_UP_SCHEDULED_FILTER
  | typeof FOLLOW_UP_UNSET_FILTER;
type ManagedContact = WhatsAppContact & {
  crmContactId?: string;
  crmContactType?: CrmContact['contactType'];
  crmMetadata?: CrmContact['metadata'];
  crmNotes?: string | null;
  crmSourceModule?: string | null;
  crmStatus?: CrmContact['status'];
};
type ContactRow = ManagedContact & { duplicateCount: number; duplicateContacts: ManagedContact[] };
type ContactTab = 'all' | 'customer' | 'loyal' | 'unmapped';
type AccountOwner = {
  id: string | null;
  displayName: string;
  whatsappNumber: string | null;
  assignmentStatus: string | null;
};
type ContactOrderSummary = {
  count: number;
  lastAt: string | null;
  lastAddress: string | null;
  lastStatus: string | null;
  totalValue: number;
};
type ContactLeadSummary = {
  id: string;
  status: string;
  updatedAt: string;
};
type ContactEditForm = {
  displayName: string;
  phoneRaw?: string;
  email: string;
  csProfileId: string;
  notes: string;
  followUpStatus: string;
  lastContactedAt: string;
  nextFollowUpAt: string;
};
type CrmSyncProgress = {
  active: boolean;
  loaded: number;
  source: 'idle' | 'crm' | 'fallback';
};

const PROVIDER_FILTERS: Array<{ id: 'all' | WhatsAppProvider; label: string }> = [
  { id: 'all', label: 'Semua provider' },
  { id: 'kirimdev', label: 'Kirimdev' },
  { id: 'meta', label: 'Meta langsung' },
];

const AVATAR_COLORS = [
  'bg-amber-100 text-amber-700',
  'bg-violet-100 text-violet-700',
  'bg-sky-100 text-sky-700',
  'bg-emerald-100 text-emerald-700',
  'bg-rose-100 text-rose-700',
  'bg-cyan-100 text-cyan-700',
];

function normalizePhoneKey(value: string | null | undefined) {
  return (value || '').replace(/\D/g, '');
}

function normalizeComparablePhoneNumber(value: string | null | undefined) {
  const normalized = normalizePhoneKey(value);
  if (!normalized) return '';
  if (normalized.startsWith('0')) return `62${normalized.slice(1)}`;
  if (normalized.startsWith('8')) return `62${normalized}`;
  return normalized;
}

function getContactGroupKey(contact: WhatsAppContact) {
  const phoneKey = getContactMergeKey(contact.phoneNumber);
  if (phoneKey) return `phone:${phoneKey}`;
  const fallbackKey = normalizePhoneKey(contact.id) || contact.id;
  return `${contact.channelId}:${fallbackKey}`;
}

function getContactMergeKey(phone?: string | null) {
  return normalizeComparablePhoneNumber(phone) || normalizePhoneKey(phone);
}

function getWhatsAppChatUrl(phone?: string | null) {
  const phoneKey = normalizeComparablePhoneNumber(phone);
  return phoneKey ? `https://wa.me/${phoneKey}` : null;
}

function openWhatsAppChat(phone?: string | null) {
  const url = getWhatsAppChatUrl(phone);
  if (!url) {
    toast.error('Nomor WhatsApp belum tersedia.');
    return;
  }
  window.open(url, '_blank', 'noopener,noreferrer');
}

function getMetadataString(metadata: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = metadata[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}

function getContactMetadataString(contact: Pick<ManagedContact, 'crmMetadata'>, keys: string[]) {
  return getMetadataString(contact.crmMetadata || {}, keys);
}

function isOrderBackedFallbackContact(contact: ManagedContact) {
  return contact.channelId === 'orders' || contact.crmMetadata?.orderFallback === true;
}

function mapCrmContactToWhatsAppContact(contact: CrmContact): ManagedContact {
  const phone = contact.phoneRaw || contact.phoneNormalized;
  const csProfileId = getMetadataString(contact.metadata, ['csId', 'assignedCsId']);
  return {
    id: `crm:${contact.id}`,
    provider: 'kirimdev',
    channelId: 'crm',
    phoneNumberId: null,
    phoneNumber: phone,
    name: contact.displayName || contact.whatsappName || phone || 'Kontak CRM',
    email: contact.email,
    avatarUrl: null,
    profilePictureUrl: null,
    accountLabel: 'CRM',
    accountPhoneNumber: null,
    csProfileId,
    csDisplayName: null,
    csWhatsappNumber: null,
    csAssignmentStatus: null,
    createdAt: contact.createdAt,
    updatedAt: contact.updatedAt,
    crmContactId: contact.id,
    crmContactType: contact.contactType,
    crmMetadata: contact.metadata,
    crmNotes: contact.notes,
    crmSourceModule: contact.sourceModule,
    crmStatus: contact.status,
  };
}

function mergeWhatsAppAndCrmContacts(whatsappContacts: WhatsAppContact[], crmContacts: CrmContact[]): ManagedContact[] {
  const savedCrmContacts = crmContacts.filter(isSavedCrmContact);
  const savedPhoneKeys = new Set(
    savedCrmContacts
      .map((contact) => getContactMergeKey(contact.phoneRaw || contact.phoneNormalized))
      .filter(Boolean),
  );

  return [
    ...savedCrmContacts.map(mapCrmContactToWhatsAppContact),
    ...whatsappContacts.filter((contact) => savedPhoneKeys.has(getContactMergeKey(contact.phoneNumber))),
  ];
}

function buildOrderBackedContacts(orders: any[], userNameById: Map<string, string>): ManagedContact[] {
  const contactByPhone = new Map<string, ManagedContact>();

  orders.forEach((order) => {
    if (order.status === 'cancelled') return;
    const phoneKey = getOrderPhoneKey(order);
    if (!phoneKey) return;

    const orderDate = getOrderInteractionDate(order) || order.created_at || '';
    const csProfileId = order.csId || null;
    const csDisplayName = csProfileId ? userNameById.get(csProfileId) || null : null;
    const contact: ManagedContact = {
      id: `order-contact:${phoneKey}`,
      provider: 'kirimdev',
      channelId: 'orders',
      phoneNumberId: null,
      phoneNumber: order.customerPhone || phoneKey,
      name: order.customerName || order.customerPhone || 'Kontak Pesanan',
      email: order.email || order.customerEmail || null,
      avatarUrl: null,
      profilePictureUrl: null,
      accountLabel: 'Pesanan',
      accountPhoneNumber: null,
      csProfileId,
      csDisplayName,
      csWhatsappNumber: null,
      csAssignmentStatus: null,
      createdAt: order.created_at || orderDate,
      updatedAt: orderDate || order.created_at,
      crmContactType: 'customer',
      crmMetadata: {
        assignedCsId: csProfileId,
        assignedCsName: csDisplayName,
        orderFallback: true,
        orderId: order.id,
        savedToContactsSource: 'pesanan:fallback',
      },
      crmNotes: null,
      crmSourceModule: 'pesanan',
      crmStatus: 'active',
    };

    const current = contactByPhone.get(phoneKey);
    contactByPhone.set(phoneKey, current ? mergeContactRecords(current, contact) : contact);
  });

  return Array.from(contactByPhone.values()).sort((left, right) =>
    (right.updatedAt || '').localeCompare(left.updatedAt || ''),
  );
}

function getUsefulContactName(contact: WhatsAppContact) {
  const name = contact.name?.trim();
  if (name && name !== '.' && name !== '-' && !/^\d+$/.test(name)) return name;
  return null;
}

function getEarlierDate(left: string | null | undefined, right: string | null | undefined) {
  if (!left) return right || null;
  if (!right) return left;
  return left.localeCompare(right) <= 0 ? left : right;
}

function getLaterDate(left: string | null | undefined, right: string | null | undefined) {
  if (!left) return right || '';
  if (!right) return left;
  return left.localeCompare(right) >= 0 ? left : right;
}

function mergeContactRecords(current: ManagedContact, incoming: ManagedContact): ManagedContact {
  const primary = current.channelId === 'crm' && incoming.channelId !== 'crm' ? incoming : current;
  const secondary = primary === current ? incoming : current;
  const name = getUsefulContactName(current) || getUsefulContactName(incoming) || primary.name || secondary.name;

  return {
    ...primary,
    name,
    email: current.email || incoming.email || null,
    avatarUrl: primary.avatarUrl || secondary.avatarUrl || null,
    profilePictureUrl: primary.profilePictureUrl || secondary.profilePictureUrl || null,
    accountLabel: primary.accountLabel || secondary.accountLabel || null,
    accountPhoneNumber: primary.accountPhoneNumber || secondary.accountPhoneNumber || null,
    csProfileId: current.csProfileId || incoming.csProfileId || null,
    csDisplayName: current.csDisplayName || incoming.csDisplayName || null,
    csWhatsappNumber: current.csWhatsappNumber || incoming.csWhatsappNumber || null,
    csAssignmentStatus: current.csAssignmentStatus || incoming.csAssignmentStatus || null,
    createdAt: getEarlierDate(current.createdAt, incoming.createdAt),
    updatedAt: getLaterDate(current.updatedAt, incoming.updatedAt),
    crmContactId: current.crmContactId || incoming.crmContactId,
    crmContactType: current.crmContactType || incoming.crmContactType,
    crmMetadata: current.crmMetadata || incoming.crmMetadata,
    crmNotes: current.crmNotes ?? incoming.crmNotes ?? null,
    crmSourceModule: current.crmSourceModule || incoming.crmSourceModule,
    crmStatus: current.crmStatus || incoming.crmStatus,
  };
}

function getContactName(contact: WhatsAppContact) {
  const name = getUsefulContactName(contact);
  if (name) return name;
  return formatPhoneNumber(contact.phoneNumber) || 'Kontak WhatsApp';
}

function getContactCsLabel(contact: WhatsAppContact & Pick<ManagedContact, 'crmMetadata'>) {
  return (
    contact.csDisplayName?.trim() ||
    getContactMetadataString(contact, ['assignedCsName', 'csName', 'csDisplayName']) ||
    'Belum ada CS'
  );
}

function getContactAccountLabel(contact: WhatsAppContact) {
  return (
    contact.accountLabel?.trim() ||
    contact.accountPhoneNumber?.trim() ||
    contact.phoneNumberId?.trim() ||
    contact.channelId
  );
}

function getAccountChannelId(account: WhatsAppAccount) {
  return account.id || `whatsapp:${account.phoneNumberId}`;
}

function getAccountLabel(account: WhatsAppAccount) {
  const label = account.label
    ?.replace(/\s*\u00e2\u20ac\u00a2\s*/g, ' - ')
    .replace(/\s*â€¢\s*/g, ' - ')
    .trim();
  return label || account.displayPhoneNumber || account.phoneNumberId || 'WhatsApp account';
}

function getAccountComparablePhoneNumber(account: WhatsAppAccount) {
  return (
    normalizeComparablePhoneNumber(account.csWhatsappNumber) ||
    normalizeComparablePhoneNumber(account.displayPhoneNumber) ||
    normalizeComparablePhoneNumber(account.label) ||
    normalizeComparablePhoneNumber(account.phoneNumberId)
  );
}

function getUserDisplayName(user: any) {
  return user.csDisplayName?.trim() || user.name?.trim() || user.email?.trim() || 'CS';
}

function isActiveCsUser(user: any) {
  const role = String(user?.role || '').trim().toLowerCase();
  return (role === 'cs' || role === 'customer service') && user?.status !== 'inactive';
}

function buildUserOwnerByPhoneNumber(users: any[]) {
  const ownerMap = new Map<string, AccountOwner & { priority: number }>();

  users.forEach((user) => {
    const basePriority = (user.status === 'active' ? 20 : 0) + (user.role === 'CS' ? 10 : 0);
    const displayName = getUserDisplayName(user);
    const candidates = [
      {
        key: normalizeComparablePhoneNumber(user.csWhatsappNumber),
        whatsappNumber: user.csWhatsappNumber || '',
        priority: 100 + basePriority,
      },
      {
        key: normalizeComparablePhoneNumber(user.phone),
        whatsappNumber: user.phone || '',
        priority: 10 + basePriority,
      },
    ];

    candidates.forEach((candidate) => {
      if (!candidate.key) return;
      const current = ownerMap.get(candidate.key);
      if (current && current.priority >= candidate.priority) return;
      ownerMap.set(candidate.key, {
        id: user.id || null,
        displayName,
        whatsappNumber: candidate.whatsappNumber || null,
        assignmentStatus: user.csAssignmentStatus || null,
        priority: candidate.priority,
      });
    });
  });

  return ownerMap;
}

function resolveAccountOwner(
  account: WhatsAppAccount,
  ownerByPhoneNumber: Map<string, AccountOwner & { priority: number }>,
): AccountOwner | null {
  if (account.csProfileId || account.csDisplayName?.trim()) {
    return {
      id: account.csProfileId || null,
      displayName: account.csDisplayName?.trim() || 'CS',
      whatsappNumber: account.csWhatsappNumber || account.displayPhoneNumber || null,
      assignmentStatus: account.csAssignmentStatus || null,
    };
  }

  const accountPhoneNumber = getAccountComparablePhoneNumber(account);
  return accountPhoneNumber ? ownerByPhoneNumber.get(accountPhoneNumber) || null : null;
}

function isWhatsAppAccountApiConnected(account: WhatsAppAccount) {
  return account.status !== 'not_configured';
}

function buildConnectedCsOptionMap(accounts: WhatsAppAccount[], users: any[]) {
  const ownerByPhoneNumber = buildUserOwnerByPhoneNumber(users);
  const optionMap = new Map<string, { id: string; label: string; count: number }>();

  users.forEach((user) => {
    if (!isActiveCsUser(user) || !user.id) return;
    optionMap.set(user.id, {
      id: user.id,
      label: getUserDisplayName(user),
      count: 0,
    });
  });

  accounts.forEach((account) => {
    if (!isWhatsAppAccountApiConnected(account)) return;
    const owner = resolveAccountOwner(account, ownerByPhoneNumber);
    if (!owner?.id) return;
    optionMap.set(owner.id, {
      id: owner.id,
      label: owner.displayName,
      count: 0,
    });
  });

  return optionMap;
}

function enrichContactsWithAccountOwners(
  contacts: ContactRow[],
  accounts: WhatsAppAccount[],
  users: any[],
) {
  const ownerByPhoneNumber = buildUserOwnerByPhoneNumber(users);
  const accountByChannel = new Map(accounts.map((account) => [getAccountChannelId(account), account]));
  const ownerByChannel = new Map<string, AccountOwner>();

  accounts.forEach((account) => {
    const owner = resolveAccountOwner(account, ownerByPhoneNumber);
    if (owner) ownerByChannel.set(getAccountChannelId(account), owner);
  });

  return contacts.map((contact) => {
    const account = accountByChannel.get(contact.channelId);
    const owner = ownerByChannel.get(contact.channelId);
    if (!account && !owner) return contact;

    return {
      ...contact,
      accountLabel: contact.accountLabel || (account ? getAccountLabel(account) : null),
      accountPhoneNumber:
        contact.accountPhoneNumber || account?.displayPhoneNumber || account?.phoneNumberId || null,
      csProfileId: contact.csProfileId || owner?.id || null,
      csDisplayName: contact.csDisplayName || owner?.displayName || null,
      csWhatsappNumber: contact.csWhatsappNumber || owner?.whatsappNumber || null,
      csAssignmentStatus: contact.csAssignmentStatus || owner?.assignmentStatus || null,
    };
  });
}

function getAvatarClassName(contact: WhatsAppContact) {
  const key = getContactGroupKey(contact);
  const index = key.split('').reduce((sum, char) => sum + char.charCodeAt(0), 0) % AVATAR_COLORS.length;
  return AVATAR_COLORS[index];
}

function getContactAvatarUrl(contact: WhatsAppContact) {
  return contact.avatarUrl || contact.profilePictureUrl || null;
}

function buildContactRows(contacts: ManagedContact[]): ContactRow[] {
  const grouped = new Map<string, { contact: ManagedContact; records: ManagedContact[] }>();

  contacts.forEach((contact) => {
    const key = getContactGroupKey(contact);
    const current = grouped.get(key);
    if (!current) {
      grouped.set(key, { contact, records: [contact] });
      return;
    }

    grouped.set(key, {
      contact: mergeContactRecords(current.contact, contact),
      records: [...current.records, contact],
    });
  });

  return Array.from(grouped.values())
    .map(({ contact, records }) => {
      const realRecords = records.filter((record) => !isOrderBackedFallbackContact(record));
      const duplicateContacts = (realRecords.length > 0 ? realRecords : records).sort((left, right) =>
        (right.updatedAt || '').localeCompare(left.updatedAt || ''),
      );
      return {
        ...contact,
        duplicateCount: duplicateContacts.length,
        duplicateContacts,
      };
    })
    .sort((left, right) => (right.updatedAt || '').localeCompare(left.updatedAt || ''));
}

function formatDateOnly(value: string | null | undefined) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return new Intl.DateTimeFormat('id-ID', {
    day: '2-digit',
    month: 'numeric',
    year: 'numeric',
  }).format(date);
}

function formatRelativeDate(value: string | null | undefined) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';

  const diffMs = Date.now() - date.getTime();
  if (diffMs < 60_000) return 'baru saja';
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 60) return `${minutes} menit lalu`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} jam lalu`;
  const days = Math.floor(hours / 24);
  if (days < 14) return `${days} hari lalu`;
  return formatDateOnly(value);
}

function formatDateWithRelative(value: string | null | undefined) {
  if (!value) return '-';
  const absolute = formatDateOnly(value);
  const relative = formatRelativeDate(value);
  return absolute === relative ? absolute : `${absolute} - ${relative}`;
}

function toDateInputValue(value: string | null | undefined) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value.slice(0, 10);
  return date.toISOString().slice(0, 10);
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat('id-ID', {
    currency: 'IDR',
    maximumFractionDigits: 0,
    style: 'currency',
  }).format(value);
}

function getOrderStatusLabel(status: string | null | undefined) {
  const normalized = String(status || '').trim().toLowerCase();
  if (normalized === 'completed' || normalized === 'done' || normalized === 'finished') return 'Selesai';
  if (normalized === 'cancelled' || normalized === 'canceled') return 'Batal';
  if (normalized === 'in_progress' || normalized === 'process') return 'Dikerjakan';
  if (normalized === 'pending') return 'Pending';
  return status || '-';
}

function getNormalizedOrderStatus(status: string | null | undefined) {
  const normalized = String(status || '').trim().toLowerCase();
  if (normalized === 'completed' || normalized === 'done' || normalized === 'finished') return 'done';
  if (normalized === 'cancelled' || normalized === 'canceled') return 'cancelled';
  if (normalized === 'in_progress' || normalized === 'process' || normalized === 'processing') return 'processing';
  if (normalized === 'pending' || normalized === 'waiting' || normalized === 'reschedule') return normalized;
  return normalized || '';
}

function getOrderStatusToneClassName(status: string | null | undefined) {
  const normalized = getNormalizedOrderStatus(status);
  if (normalized === 'done') {
    return {
      dot: 'bg-emerald-500',
      text: 'text-emerald-700 dark:text-emerald-300',
    };
  }
  if (normalized === 'cancelled') {
    return {
      dot: 'bg-rose-500',
      text: 'text-rose-700 dark:text-rose-300',
    };
  }
  if (normalized === 'in_progress' || normalized === 'process' || normalized === 'processing') {
    return {
      dot: 'bg-blue-500',
      text: 'text-blue-700 dark:text-blue-300',
    };
  }
  if (normalized === 'pending') {
    return {
      dot: 'bg-amber-500',
      text: 'text-amber-700 dark:text-amber-300',
    };
  }
  return {
    dot: 'bg-slate-400',
    text: 'text-slate-500 dark:text-slate-400',
  };
}

function OrderStatusIndicator({
  status,
  className,
}: {
  status: string | null | undefined;
  className?: string;
}) {
  const tone = getOrderStatusToneClassName(status);
  return (
    <span className={cn('inline-flex items-center gap-1.5 text-[11px] font-semibold', tone.text, className)}>
      <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', tone.dot)} />
      {getOrderStatusLabel(status)}
    </span>
  );
}

function getContactPhoneKey(contact: Pick<WhatsAppContact, 'phoneNumber'>) {
  return getContactMergeKey(contact.phoneNumber);
}

function getOrderPhoneKey(order: any) {
  return getContactMergeKey(order.customerPhone);
}

function getLeadPhoneKey(lead: any) {
  return getContactMergeKey(lead.phone);
}

function getOrderInteractionDate(order: any) {
  return order.serviceDate || order.created_at || order.leadDate || null;
}

function buildOrderSummaryByPhone(orders: any[]) {
  const summaryByPhone = new Map<string, ContactOrderSummary>();

  orders.forEach((order) => {
    if (order.status === 'cancelled') return;
    const phoneKey = getOrderPhoneKey(order);
    if (!phoneKey) return;
    const current = summaryByPhone.get(phoneKey) || {
      count: 0,
      lastAddress: null,
      lastAt: null,
      lastStatus: null,
      totalValue: 0,
    };
    const interactionAt = getOrderInteractionDate(order);
    const nextLastAt = getLaterDate(current.lastAt, interactionAt);
    summaryByPhone.set(phoneKey, {
      count: current.count + 1,
      lastAddress: nextLastAt === interactionAt ? order.address || null : current.lastAddress,
      lastAt: nextLastAt || current.lastAt,
      lastStatus: nextLastAt === interactionAt ? order.status : current.lastStatus,
      totalValue: current.totalValue + Number(order.income || order.price || 0),
    });
  });

  return summaryByPhone;
}

function getOrderSortTimestamp(order: any) {
  const value = getOrderInteractionDate(order);
  const time = Date.parse(value || '');
  return Number.isFinite(time) ? time : 0;
}

function getContactOrders(orders: any[], phoneKey: string) {
  if (!phoneKey) return [];
  return orders
    .filter((order) => getOrderPhoneKey(order) === phoneKey)
    .sort((left, right) => getOrderSortTimestamp(right) - getOrderSortTimestamp(left));
}

function getContactAddressHistory(orders: any[], phoneKey: string) {
  const addressMap = new Map<string, { address: string; count: number; lastAt: string | null; mapsUrl?: string | null }>();

  getContactOrders(orders, phoneKey).forEach((order) => {
    const address = String(order.address || '').trim();
    if (!address) return;
    const normalizedAddress = address.toLowerCase();
    const current = addressMap.get(normalizedAddress);
    const orderDate = getOrderInteractionDate(order);
    if (!current) {
      addressMap.set(normalizedAddress, {
        address,
        count: 1,
        lastAt: orderDate,
        mapsUrl: order.mapsUrl || null,
      });
      return;
    }

    const nextLastAt = getLaterDate(current.lastAt, orderDate);
    addressMap.set(normalizedAddress, {
      address: current.address,
      count: current.count + 1,
      lastAt: nextLastAt || current.lastAt,
      mapsUrl: nextLastAt === orderDate ? order.mapsUrl || current.mapsUrl || null : current.mapsUrl || null,
    });
  });

  return Array.from(addressMap.values()).sort((left, right) => (right.lastAt || '').localeCompare(left.lastAt || ''));
}

function getOrderValue(order: any) {
  return Number(order.income || order.price || 0);
}

function getOrderServiceLabel(order: any, serviceNameById: Map<string, string>) {
  return (
    serviceNameById.get(order.serviceId) ||
    order.serviceCategory ||
    order.serviceId ||
    'Pesanan'
  );
}

function buildLeadSummaryByPhone(leads: any[]) {
  const summaryByPhone = new Map<string, ContactLeadSummary>();

  leads.forEach((lead) => {
    const phoneKey = getLeadPhoneKey(lead);
    if (!phoneKey) return;
    const updatedAt = lead.timestamp || '';
    const current = summaryByPhone.get(phoneKey);
    if (current && current.updatedAt.localeCompare(updatedAt) >= 0) return;
    summaryByPhone.set(phoneKey, {
      id: lead.id,
      status: lead.status || 'Prospek',
      updatedAt,
    });
  });

  return summaryByPhone;
}

function getContactLifecycle(
  contact: ContactRow,
  orderSummary?: ContactOrderSummary,
  leadSummary?: ContactLeadSummary,
) {
  if ((orderSummary?.count || 0) >= 2) return 'Loyal';
  if ((orderSummary?.count || 0) > 0 || contact.crmContactType === 'customer') return 'Customer';
  if (leadSummary && leadSummary.status !== 'Closing') return 'Prospek';
  if (contact.crmContactType === 'prospect') return 'Prospek';
  return 'CRM';
}

function getLifecycleBadgeClassName(lifecycle: string) {
  if (lifecycle === 'Loyal') return 'border-violet-200 bg-violet-50 text-violet-700';
  if (lifecycle === 'Customer') return 'border-emerald-200 bg-emerald-50 text-emerald-700';
  if (lifecycle === 'Prospek') return 'border-amber-200 bg-amber-50 text-amber-700';
  return 'border-slate-200 bg-slate-50 text-slate-600';
}

function getCrmSourceLabel(contact: ManagedContact) {
  if (contact.crmSourceModule === 'pesanan') return 'Pesanan';
  if (contact.crmSourceModule === 'prospek') return 'Prospek';
  if (contact.crmSourceModule === 'live_chat') return 'Live Chat';
  if (contact.crmSourceModule) return contact.crmSourceModule;
  return getProviderLabel(contact.provider);
}

function getFollowUpStatusLabel(status: string | null | undefined) {
  const normalized = String(status || 'none').trim();
  return FOLLOW_UP_STATUS_OPTIONS.find((option) => option.id === normalized)?.label || normalized;
}

function getFollowUpStatusClassName(status: string | null | undefined) {
  const normalized = String(status || 'none').trim();
  if (normalized === 'done') return 'border-emerald-200 bg-emerald-50 text-emerald-700';
  if (normalized === 'waiting_response') return 'border-blue-200 bg-blue-50 text-blue-700';
  if (normalized === 'follow_up') return 'border-amber-200 bg-amber-50 text-amber-700';
  return 'border-slate-200 bg-slate-50 text-slate-600';
}

function getTodayDateKey() {
  const today = new Date();
  const month = String(today.getMonth() + 1).padStart(2, '0');
  const day = String(today.getDate()).padStart(2, '0');
  return `${today.getFullYear()}-${month}-${day}`;
}

function getContactFollowUpBucket(contact: ManagedContact) {
  const status = getContactMetadataString(contact, ['followUpStatus']) || 'none';
  const nextFollowUpAt = toDateInputValue(getContactMetadataString(contact, ['nextFollowUpAt']));
  const todayKey = getTodayDateKey();

  if (nextFollowUpAt && nextFollowUpAt < todayKey) return FOLLOW_UP_OVERDUE_FILTER;
  if (nextFollowUpAt === todayKey) return FOLLOW_UP_TODAY_FILTER;
  if (nextFollowUpAt && nextFollowUpAt > todayKey) return FOLLOW_UP_SCHEDULED_FILTER;
  if (status === 'follow_up' || status === 'waiting_response') return FOLLOW_UP_DUE_FILTER;
  return FOLLOW_UP_UNSET_FILTER;
}

function isFollowUpDue(contact: ManagedContact) {
  const bucket = getContactFollowUpBucket(contact);
  return (
    bucket === FOLLOW_UP_DUE_FILTER ||
    bucket === FOLLOW_UP_TODAY_FILTER ||
    bucket === FOLLOW_UP_OVERDUE_FILTER
  );
}

function matchesFollowUpFilter(contact: ManagedContact, filter: FollowUpFilterValue) {
  if (filter === ALL_FOLLOW_UP_FILTER) return true;
  if (filter === FOLLOW_UP_DUE_FILTER) return isFollowUpDue(contact);
  return getContactFollowUpBucket(contact) === filter;
}

function CsOwnerBadge({ contact }: { contact: ManagedContact }) {
  const mapped = Boolean(contact.csProfileId);
  return (
    <span
      className={cn(
        'inline-flex h-7 max-w-[180px] items-center rounded-full border px-3 text-xs font-semibold',
        mapped
          ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-300'
          : 'border-slate-200 bg-slate-50 text-slate-500 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-400',
      )}
    >
      <span className="truncate">{getContactCsLabel(contact)}</span>
    </span>
  );
}

function FilterCount({ value }: { value: number }) {
  return (
    <span className="ml-1 rounded-full bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-800">
      {formatNumber(value)}
    </span>
  );
}

async function withContactLoadTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string) {
  let timeoutId: number | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timeoutId = window.setTimeout(() => {
          reject(new Error(`${label} melewati batas waktu.`));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId) window.clearTimeout(timeoutId);
  }
}

function fetchActiveCustomerCrmContactsPage(offset = 0, limit = CRM_CONTACTS_PAGE_SIZE) {
  return fetchCrmContactsPage({
    status: 'active',
    contactType: 'customer',
    limit,
    offset,
  }).catch((crmError) => {
    console.warn('CRM contacts fetch failed', crmError);
    return { contacts: [], available: false, count: null, reachedEnd: true };
  });
}

export function WhatsAppContactsPage() {
  const { users, orders, leads, services, currentUser, currentRole } = useMasterData();
  const {
    data: overviewData,
    refreshing: overviewRefreshing,
    reload: reloadOverview,
  } = useWhatsAppOverview({
    includePerformance: false,
    includeContacts: false,
    includeMessageCounts: false,
    includeConversations: false,
  });
  const [contacts, setContacts] = React.useState<ManagedContact[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [refreshing, setRefreshing] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [search, setSearch] = React.useState('');
  const [providerFilter, setProviderFilter] = React.useState<'all' | WhatsAppProvider>('all');
  const [csFilter, setCsFilter] = React.useState<CsFilterValue>(ALL_CS_FILTER);
  const [workStatusFilter, setWorkStatusFilter] =
    React.useState<WorkStatusFilterValue>(ALL_WORK_STATUS_FILTER);
  const [followUpFilter, setFollowUpFilter] = React.useState<FollowUpFilterValue>(ALL_FOLLOW_UP_FILTER);
  const [tabFilter, setTabFilter] = React.useState<ContactTab>('all');
  const [currentPage, setCurrentPage] = React.useState(1);
  const [itemsPerPage, setItemsPerPage] = React.useState(100);
  const [selectedContactKey, setSelectedContactKey] = React.useState<string | null>(null);
  const [selectedContactMode, setSelectedContactMode] = React.useState<'view' | 'edit'>('view');
  const [expandedOrderId, setExpandedOrderId] = React.useState<string | null>(null);
  const [deleteContactTarget, setDeleteContactTarget] = React.useState<ContactRow | null>(null);
  const [editingContact, setEditingContact] = React.useState(false);
  const [savingContact, setSavingContact] = React.useState(false);
  const [creatingContact, setCreatingContact] = React.useState(false);
  const [savingNewContact, setSavingNewContact] = React.useState(false);
  const [crmSyncProgress, setCrmSyncProgress] = React.useState<CrmSyncProgress>({
    active: false,
    loaded: 0,
    source: 'idle',
  });
  const loadRunRef = React.useRef(0);
  const [contactForm, setContactForm] = React.useState<ContactEditForm>({
    displayName: '',
    email: '',
    csProfileId: CONTACT_UNASSIGNED_CS_VALUE,
    notes: '',
    followUpStatus: 'none',
    lastContactedAt: '',
    nextFollowUpAt: '',
  });
  const [newContactForm, setNewContactForm] = React.useState<ContactEditForm>({
    displayName: '',
    phoneRaw: '',
    email: '',
    csProfileId: CONTACT_UNASSIGNED_CS_VALUE,
    notes: '',
    followUpStatus: 'none',
    lastContactedAt: '',
    nextFollowUpAt: '',
  });

  const load = React.useCallback(async (options?: { silent?: boolean }) => {
    const runId = loadRunRef.current + 1;
    loadRunRef.current = runId;
    const isCurrentRun = () => loadRunRef.current === runId;

    if (options?.silent) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }

    setError(null);
    setCrmSyncProgress({ active: true, loaded: 0, source: 'crm' });

    const applyCrmContacts = (crmContacts: CrmContact[], active = true) => {
      if (!isCurrentRun()) return;
      setContacts(mergeWhatsAppAndCrmContacts([], crmContacts));
      setCrmSyncProgress({
        active,
        loaded: crmContacts.length,
        source: crmContacts.length > 0 ? 'crm' : 'fallback',
      });
    };

    const finishLoad = () => {
      if (!isCurrentRun()) return;
      setLoading(false);
      setRefreshing(false);
      setCrmSyncProgress((current) => ({ ...current, active: false }));
    };

    const enrichWithWhatsAppContacts = async (crmContacts: CrmContact[]) => {
      try {
        const payload = await withContactLoadTimeout(
          fetchWhatsAppContacts(),
          WHATSAPP_CONTACTS_BACKGROUND_TIMEOUT_MS,
          'Sinkron kontak WhatsApp',
        );
        if (!isCurrentRun()) return;
        setContacts(mergeWhatsAppAndCrmContacts(payload.contacts, crmContacts));
      } catch (err: any) {
        console.warn('WhatsApp contact enrichment skipped', err);
      }
    };

    const loadRemainingCrmContacts = async (initialContacts: CrmContact[], firstPageReachedEnd: boolean) => {
      let allCrmContacts = initialContacts;
      let offset = CRM_CONTACTS_PAGE_SIZE;

      try {
        while (!firstPageReachedEnd && offset < CRM_CONTACTS_MAX_BACKGROUND_ROWS) {
          const page = await withContactLoadTimeout(
            fetchActiveCustomerCrmContactsPage(
              offset,
              Math.min(CRM_CONTACTS_PAGE_SIZE, CRM_CONTACTS_MAX_BACKGROUND_ROWS - offset),
            ),
            CONTACTS_FAST_LOAD_TIMEOUT_MS,
            'Sinkron halaman CRM',
          );
          if (!isCurrentRun()) return;
          if (!page.available) {
            setError('Sebagian data CRM belum bisa dimuat. Kontak pesanan tetap ditampilkan.');
            break;
          }
          if (page.contacts.length === 0) break;

          allCrmContacts = [...allCrmContacts, ...page.contacts];
          applyCrmContacts(allCrmContacts, true);
          if (page.reachedEnd) break;
          offset += CRM_CONTACTS_PAGE_SIZE;
        }

        await enrichWithWhatsAppContacts(allCrmContacts);
      } catch (err: any) {
        if (isCurrentRun()) {
          setError(err?.message || 'Sebagian data CRM belum bisa dimuat. Kontak pesanan tetap ditampilkan.');
        }
      } finally {
        finishLoad();
      }
    };

    const firstPageRequest = fetchActiveCustomerCrmContactsPage(0, CRM_CONTACTS_PAGE_SIZE);

    try {
      const firstPage = await withContactLoadTimeout(
        firstPageRequest,
        CONTACTS_FAST_LOAD_TIMEOUT_MS,
        'Database kontak',
      );

      if (!firstPage.available) {
        throw new Error('Database kontak belum tersedia.');
      }

      applyCrmContacts(firstPage.contacts, true);
      setError(null);
      if (!options?.silent) setLoading(false);
      void loadRemainingCrmContacts(firstPage.contacts, firstPage.reachedEnd);
    } catch (err: any) {
      if (!isCurrentRun()) return;
      setError(err?.message || 'Gagal memuat database kontak.');
      setLoading(false);
      setRefreshing(false);
      setCrmSyncProgress({ active: false, loaded: 0, source: 'fallback' });

      void firstPageRequest.then((lateFirstPage) => {
        if (!isCurrentRun()) return;
        if (!lateFirstPage.available || lateFirstPage.contacts.length === 0) {
          setCrmSyncProgress({ active: false, loaded: 0, source: 'fallback' });
          return;
        }

        applyCrmContacts(lateFirstPage.contacts, true);
        setError(null);
        setRefreshing(true);
        void loadRemainingCrmContacts(lateFirstPage.contacts, lateFirstPage.reachedEnd);
      }).catch((lateError) => {
        if (!isCurrentRun()) return;
        console.warn('CRM contacts late fetch failed', lateError);
        setCrmSyncProgress({ active: false, loaded: 0, source: 'fallback' });
      });
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  const accounts = React.useMemo(() => overviewData?.accounts || [], [overviewData?.accounts]);
  const orderSummaryByPhone = React.useMemo(() => buildOrderSummaryByPhone(orders || []), [orders]);
  const leadSummaryByPhone = React.useMemo(() => buildLeadSummaryByPhone(leads || []), [leads]);
  const serviceNameById = React.useMemo(
    () => new Map((services || []).map((service: any) => [service.id, service.name])),
    [services],
  );
  const userNameById = React.useMemo(
    () => new Map((users || []).map((user: any) => [user.id, getUserDisplayName(user)])),
    [users],
  );
  const orderBackedContacts = React.useMemo(
    () => buildOrderBackedContacts(orders || [], userNameById),
    [orders, userNameById],
  );
  const contactSourceContacts = React.useMemo(
    () => [...orderBackedContacts, ...contacts],
    [contacts, orderBackedContacts],
  );
  const isUsingOrderFallback = contacts.length === 0 && orderBackedContacts.length > 0;
  const contactRows = React.useMemo(
    () => enrichContactsWithAccountOwners(buildContactRows(contactSourceContacts), accounts, users),
    [accounts, contactSourceContacts, users],
  );
  const showTableSkeleton = loading && contactRows.length === 0;
  const isCsScopedUser =
    (currentRole === 'CS' || currentUser?.role === 'CS') && Boolean(currentUser?.id);
  const visibleContactRows = React.useMemo(() => {
    if (!isCsScopedUser || !currentUser?.id) return contactRows;
    return contactRows.filter((contact) => contact.csProfileId === currentUser.id);
  }, [contactRows, currentUser?.id, isCsScopedUser]);
  const isRefreshing = refreshing || overviewRefreshing || crmSyncProgress.active;
  const syncLabel = crmSyncProgress.active
    ? crmSyncProgress.source === 'fallback'
      ? 'Menunggu CRM'
      : crmSyncProgress.loaded > 0
        ? `Sinkron CRM ${formatNumber(crmSyncProgress.loaded)}`
        : 'Sinkron CRM'
    : 'Sinkron';

  const refreshAll = React.useCallback(async () => {
    await Promise.all([load({ silent: true }), reloadOverview({ silent: true })]);
  }, [load, reloadOverview]);

  const customerCount = React.useMemo(
    () =>
      visibleContactRows.filter((contact) => {
        const phoneKey = getContactPhoneKey(contact);
        const lifecycle = getContactLifecycle(
          contact,
          phoneKey ? orderSummaryByPhone.get(phoneKey) : undefined,
          phoneKey ? leadSummaryByPhone.get(phoneKey) : undefined,
        );
        return lifecycle === 'Customer' || lifecycle === 'Loyal';
      }).length,
    [leadSummaryByPhone, orderSummaryByPhone, visibleContactRows],
  );
  const loyalCount = React.useMemo(
    () =>
      visibleContactRows.filter((contact) => {
        const phoneKey = getContactPhoneKey(contact);
        const lifecycle = getContactLifecycle(
          contact,
          phoneKey ? orderSummaryByPhone.get(phoneKey) : undefined,
          phoneKey ? leadSummaryByPhone.get(phoneKey) : undefined,
        );
        return lifecycle === 'Loyal';
      }).length,
    [leadSummaryByPhone, orderSummaryByPhone, visibleContactRows],
  );
  const unmappedCount = React.useMemo(
    () => visibleContactRows.filter((contact) => !contact.csProfileId).length,
    [visibleContactRows],
  );
  const duplicateCount = React.useMemo(
    () =>
      visibleContactRows.reduce(
        (total, contact) => total + Math.max(contact.duplicateCount - 1, 0),
        0,
      ),
    [visibleContactRows],
  );
  const workStatusOptions = React.useMemo(() => {
    const counts = new Map<string, number>();
    let withoutStatus = 0;

    visibleContactRows.forEach((contact) => {
      const phoneKey = getContactPhoneKey(contact);
      const orderSummary = phoneKey ? orderSummaryByPhone.get(phoneKey) : undefined;
      const normalizedStatus = getNormalizedOrderStatus(orderSummary?.lastStatus);
      if (!normalizedStatus) {
        withoutStatus += 1;
        return;
      }
      counts.set(normalizedStatus, (counts.get(normalizedStatus) || 0) + 1);
    });

    const orderedStatuses = ['pending', 'processing', 'waiting', 'reschedule', 'done', 'cancelled'];
    const options = orderedStatuses
      .filter((status) => counts.has(status))
      .map((status) => ({
        id: status,
        label: getOrderStatusLabel(status),
        count: counts.get(status) || 0,
      }));

    return [
      { id: ALL_WORK_STATUS_FILTER, label: 'Semua status', count: visibleContactRows.length },
      ...options,
      { id: NO_WORK_STATUS_FILTER, label: 'Tanpa pesanan', count: withoutStatus },
    ];
  }, [orderSummaryByPhone, visibleContactRows]);

  const followUpOptions = React.useMemo(() => {
    const counts = new Map<FollowUpFilterValue, number>();
    visibleContactRows.forEach((contact) => {
      const bucket = getContactFollowUpBucket(contact);
      counts.set(bucket, (counts.get(bucket) || 0) + 1);
      if (isFollowUpDue(contact)) {
        counts.set(FOLLOW_UP_DUE_FILTER, (counts.get(FOLLOW_UP_DUE_FILTER) || 0) + 1);
      }
    });

    return [
      { id: ALL_FOLLOW_UP_FILTER, label: 'Semua follow up', count: visibleContactRows.length },
      { id: FOLLOW_UP_DUE_FILTER, label: 'Perlu follow up', count: counts.get(FOLLOW_UP_DUE_FILTER) || 0 },
      { id: FOLLOW_UP_TODAY_FILTER, label: 'Hari ini', count: counts.get(FOLLOW_UP_TODAY_FILTER) || 0 },
      { id: FOLLOW_UP_OVERDUE_FILTER, label: 'Terlambat', count: counts.get(FOLLOW_UP_OVERDUE_FILTER) || 0 },
      { id: FOLLOW_UP_SCHEDULED_FILTER, label: 'Terjadwal', count: counts.get(FOLLOW_UP_SCHEDULED_FILTER) || 0 },
      { id: FOLLOW_UP_UNSET_FILTER, label: 'Belum diatur', count: counts.get(FOLLOW_UP_UNSET_FILTER) || 0 },
    ];
  }, [visibleContactRows]);

  const csOptions = React.useMemo(() => {
    const optionMap = buildConnectedCsOptionMap(accounts, users);

    contactRows.forEach((contact) => {
      if (!contact.csProfileId) return;
      const current = optionMap.get(contact.csProfileId);
      optionMap.set(contact.csProfileId, {
        id: contact.csProfileId,
        label: current?.label || contact.csDisplayName?.trim() || 'CS',
        count: (current?.count || 0) + 1,
      });
    });

    return Array.from(optionMap.values()).sort((left, right) =>
      left.label.localeCompare(right.label),
    );
  }, [accounts, contactRows, users]);

  const filteredContacts = React.useMemo(() => {
    const query = search.trim().toLowerCase();
    return visibleContactRows.filter((contact) => {
      const phoneKey = getContactPhoneKey(contact);
      const orderSummary = phoneKey ? orderSummaryByPhone.get(phoneKey) : undefined;
      const leadSummary = phoneKey ? leadSummaryByPhone.get(phoneKey) : undefined;
      const lifecycle = getContactLifecycle(contact, orderSummary, leadSummary);
      if (providerFilter !== 'all' && contact.provider !== providerFilter) return false;
      if (workStatusFilter === NO_WORK_STATUS_FILTER && orderSummary?.lastStatus) return false;
      if (
        workStatusFilter !== ALL_WORK_STATUS_FILTER &&
        workStatusFilter !== NO_WORK_STATUS_FILTER &&
        getNormalizedOrderStatus(orderSummary?.lastStatus) !== workStatusFilter
      ) {
        return false;
      }
      if (!isCsScopedUser) {
        if (csFilter === UNASSIGNED_CS_FILTER && contact.csProfileId) return false;
        if (
          csFilter !== ALL_CS_FILTER &&
          csFilter !== UNASSIGNED_CS_FILTER &&
          contact.csProfileId !== csFilter
        ) {
          return false;
        }
      }
      if (tabFilter === 'customer' && lifecycle !== 'Customer' && lifecycle !== 'Loyal') return false;
      if (tabFilter === 'loyal' && lifecycle !== 'Loyal') return false;
      if (tabFilter === 'unmapped' && contact.csProfileId) return false;
      if (!matchesFollowUpFilter(contact, followUpFilter)) return false;
      if (!query) return true;

      const haystack = [
        contact.name,
        contact.phoneNumber,
        contact.email,
        contact.crmNotes,
        contact.provider,
        lifecycle,
        orderSummary?.lastAddress,
        orderSummary?.count ? `${orderSummary.count} order` : null,
        leadSummary?.status,
        getFollowUpStatusLabel(getContactMetadataString(contact, ['followUpStatus'])),
        getProviderLabel(contact.provider),
        getContactCsLabel(contact),
        getContactAccountLabel(contact),
        getCrmSourceLabel(contact),
        contact.phoneNumberId,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return haystack.includes(query);
    });
  }, [
    csFilter,
    followUpFilter,
    isCsScopedUser,
    leadSummaryByPhone,
    orderSummaryByPhone,
    providerFilter,
    search,
    tabFilter,
    visibleContactRows,
    workStatusFilter,
  ]);

  React.useEffect(() => {
    setCurrentPage(1);
  }, [csFilter, followUpFilter, providerFilter, search, tabFilter, workStatusFilter]);

  const totalPages = React.useMemo(
    () => Math.ceil(filteredContacts.length / itemsPerPage),
    [filteredContacts.length, itemsPerPage],
  );

  React.useEffect(() => {
    if (totalPages > 0) {
      setCurrentPage((page) => Math.min(page, totalPages));
    }
  }, [totalPages]);

  const safeCurrentPage = totalPages === 0 ? 0 : Math.min(currentPage, totalPages);
  const pageStartIndex =
    safeCurrentPage === 0 || filteredContacts.length === 0 ? 0 : (safeCurrentPage - 1) * itemsPerPage;
  const pageEndIndex = safeCurrentPage === 0 ? 0 : Math.min(pageStartIndex + itemsPerPage, filteredContacts.length);
  const paginatedContacts = React.useMemo(
    () => filteredContacts.slice(pageStartIndex, pageEndIndex),
    [filteredContacts, pageEndIndex, pageStartIndex],
  );
  const selectedContact = React.useMemo(
    () => contactRows.find((contact) => getContactGroupKey(contact) === selectedContactKey) || null,
    [contactRows, selectedContactKey],
  );
  const selectedContactPhoneKey = selectedContact ? getContactPhoneKey(selectedContact) : '';
  const selectedOrderSummary = selectedContactPhoneKey ? orderSummaryByPhone.get(selectedContactPhoneKey) : undefined;
  const selectedLeadSummary = selectedContactPhoneKey ? leadSummaryByPhone.get(selectedContactPhoneKey) : undefined;
  const selectedContactOrders = React.useMemo(
    () => getContactOrders(orders || [], selectedContactPhoneKey),
    [orders, selectedContactPhoneKey],
  );
  const selectedAddressHistory = React.useMemo(
    () => getContactAddressHistory(orders || [], selectedContactPhoneKey),
    [orders, selectedContactPhoneKey],
  );
  const selectedLifecycle = selectedContact
    ? getContactLifecycle(selectedContact, selectedOrderSummary, selectedLeadSummary)
    : 'CRM';

  const upsertContactInState = React.useCallback((contact: CrmContact) => {
    const updatedContact = mapCrmContactToWhatsAppContact(contact);
    setContacts((currentContacts) => {
      const nextContacts = currentContacts.filter((currentContact) => {
        const sameCrmId = currentContact.crmContactId === contact.id || currentContact.id === `crm:${contact.id}`;
        const samePhone = getContactMergeKey(currentContact.phoneNumber) === getContactMergeKey(updatedContact.phoneNumber);
        return !sameCrmId && !(currentContact.channelId === 'crm' && samePhone);
      });
      return [updatedContact, ...nextContacts];
    });
    setSelectedContactMode('view');
    setSelectedContactKey(getContactGroupKey(updatedContact));
  }, []);

  const removeContactFromState = React.useCallback((contact: ContactRow) => {
    const phoneKey = getContactPhoneKey(contact);
    setContacts((currentContacts) =>
      currentContacts.filter((currentContact) => {
        const sameCrmId = contact.crmContactId
          ? currentContact.crmContactId === contact.crmContactId || currentContact.id === `crm:${contact.crmContactId}`
          : false;
        const samePhone = phoneKey && getContactMergeKey(currentContact.phoneNumber) === phoneKey;
        return !sameCrmId && !samePhone;
      }),
    );
  }, []);

  const resetSelectedContactForm = React.useCallback(() => {
    if (!selectedContact) return;
    setContactForm({
      displayName: getContactName(selectedContact),
      phoneRaw: selectedContact.phoneNumber || '',
      email: selectedContact.email || '',
      csProfileId: selectedContact.csProfileId || CONTACT_UNASSIGNED_CS_VALUE,
      notes: selectedContact.crmNotes || '',
      followUpStatus: getContactMetadataString(selectedContact, ['followUpStatus']) || 'none',
      lastContactedAt: toDateInputValue(getContactMetadataString(selectedContact, ['lastContactedAt'])),
      nextFollowUpAt: toDateInputValue(getContactMetadataString(selectedContact, ['nextFollowUpAt'])),
    });
  }, [selectedContact]);

  React.useEffect(() => {
    resetSelectedContactForm();
  }, [resetSelectedContactForm]);

  React.useEffect(() => {
    setEditingContact(selectedContactMode === 'edit');
    setExpandedOrderId(null);
  }, [selectedContactKey, selectedContactMode]);

  const handleSaveContact = React.useCallback(async () => {
    if (!selectedContact) {
      toast.error('Kontak belum dipilih.');
      return;
    }
    if (!contactForm.displayName.trim()) {
      toast.error('Nama kontak wajib diisi.');
      return;
    }
    const phoneRaw = contactForm.phoneRaw?.trim() || '';
    if (!getContactMergeKey(phoneRaw)) {
      toast.error('Nomor kontak wajib diisi.');
      return;
    }

    const assignedCsId =
      contactForm.csProfileId === CONTACT_UNASSIGNED_CS_VALUE ? null : contactForm.csProfileId;
    const assignedCs = assignedCsId ? users.find((user) => user.id === assignedCsId) : null;
    const metadata = {
      ...(selectedContact.crmMetadata || {}),
      assignedCsId,
      assignedCsName: assignedCs ? getUserDisplayName(assignedCs) : null,
      csId: assignedCsId,
      followUpStatus: contactForm.followUpStatus || 'none',
      lastContactedAt: contactForm.lastContactedAt || null,
      nextFollowUpAt: contactForm.nextFollowUpAt || null,
    };

    setSavingContact(true);
    try {
      const payload = {
        displayName: contactForm.displayName,
        phoneRaw,
        email: contactForm.email,
        notes: contactForm.notes,
        metadata,
      };
      const result = selectedContact.crmContactId
        ? await updateCrmContact(selectedContact.crmContactId, payload)
        : await createManualCrmContact(payload);

      if (!result.contact) {
        toast.error('Kontak CRM belum tersedia.');
        return;
      }

      upsertContactInState(result.contact);
      setEditingContact(false);
      toast.success(selectedContact.crmContactId ? 'Kontak diperbarui.' : 'Kontak disimpan ke CRM.');
    } catch (err: any) {
      toast.error(err?.message || 'Gagal memperbarui kontak.');
    } finally {
      setSavingContact(false);
    }
  }, [contactForm, selectedContact, upsertContactInState, users]);

  const handleCreateContact = React.useCallback(async () => {
    const displayName = newContactForm.displayName.trim();
    const phoneRaw = newContactForm.phoneRaw?.trim() || '';
    if (!displayName) {
      toast.error('Nama kontak wajib diisi.');
      return;
    }
    if (!getContactMergeKey(phoneRaw)) {
      toast.error('Nomor kontak wajib diisi.');
      return;
    }

    const assignedCsId =
      newContactForm.csProfileId === CONTACT_UNASSIGNED_CS_VALUE ? null : newContactForm.csProfileId;
    const assignedCs = assignedCsId ? users.find((user) => user.id === assignedCsId) : null;

    setSavingNewContact(true);
    try {
      const result = await createManualCrmContact({
        displayName,
        phoneRaw,
        email: newContactForm.email,
        notes: newContactForm.notes,
        metadata: {
          assignedCsId,
          assignedCsName: assignedCs ? getUserDisplayName(assignedCs) : null,
          csId: assignedCsId,
          followUpStatus: newContactForm.followUpStatus || 'none',
          lastContactedAt: newContactForm.lastContactedAt || null,
          nextFollowUpAt: newContactForm.nextFollowUpAt || null,
        },
      });

      if (!result.contact) {
        toast.error('Kontak CRM belum tersedia.');
        return;
      }

      upsertContactInState(result.contact);
      setCreatingContact(false);
      setNewContactForm({
        displayName: '',
        phoneRaw: '',
        email: '',
        csProfileId: CONTACT_UNASSIGNED_CS_VALUE,
        notes: '',
        followUpStatus: 'none',
        lastContactedAt: '',
        nextFollowUpAt: '',
      });
      toast.success('Kontak ditambahkan.');
    } catch (err: any) {
      toast.error(err?.message || 'Gagal menambahkan kontak.');
    } finally {
      setSavingNewContact(false);
    }
  }, [newContactForm, upsertContactInState, users]);

  const handleArchiveContact = React.useCallback(async (targetContact?: ContactRow | null) => {
    const contactToArchive = targetContact || deleteContactTarget;
    if (!contactToArchive?.crmContactId) {
      toast.error('Kontak CRM belum punya ID yang bisa dihapus.');
      return;
    }

    setSavingContact(true);
    try {
      await archiveCrmContact(contactToArchive.crmContactId);
      removeContactFromState(contactToArchive);
      if (selectedContactKey === getContactGroupKey(contactToArchive)) {
        setSelectedContactKey(null);
      }
      setDeleteContactTarget(null);
      toast.success('Kontak dihapus dari database kontak.');
    } catch (err: any) {
      toast.error(err?.message || 'Gagal menghapus kontak.');
    } finally {
      setSavingContact(false);
    }
  }, [deleteContactTarget, removeContactFromState, selectedContactKey]);

  const handleUseDuplicateAsPrimary = React.useCallback((candidate: ManagedContact) => {
    setContactForm((current) => ({
      ...current,
      displayName: getContactName(candidate),
      phoneRaw: candidate.phoneNumber || current.phoneRaw,
      email: candidate.email || current.email,
      csProfileId: candidate.csProfileId || current.csProfileId || CONTACT_UNASSIGNED_CS_VALUE,
      notes: candidate.crmNotes ?? current.notes,
      followUpStatus: getContactMetadataString(candidate, ['followUpStatus']) || current.followUpStatus,
      lastContactedAt:
        toDateInputValue(getContactMetadataString(candidate, ['lastContactedAt'])) || current.lastContactedAt,
      nextFollowUpAt:
        toDateInputValue(getContactMetadataString(candidate, ['nextFollowUpAt'])) || current.nextFollowUpAt,
    }));
    setSelectedContactMode('edit');
    setEditingContact(true);
    toast.info('Data kandidat masuk ke form edit. Klik Simpan untuk menerapkan.');
  }, []);

  const hasActiveFilters =
    search.trim().length > 0 ||
    providerFilter !== 'all' ||
    (!isCsScopedUser && csFilter !== ALL_CS_FILTER) ||
    workStatusFilter !== ALL_WORK_STATUS_FILTER ||
    followUpFilter !== ALL_FOLLOW_UP_FILTER ||
    tabFilter !== 'all';

  const resetFilters = () => {
    setSearch('');
    setProviderFilter('all');
    setCsFilter(ALL_CS_FILTER);
    setWorkStatusFilter(ALL_WORK_STATUS_FILTER);
    setFollowUpFilter(ALL_FOLLOW_UP_FILTER);
    setTabFilter('all');
  };

  const contactTabs: Array<{ id: ContactTab; label: string; count: number }> = [
    { id: 'all', label: 'Semua', count: visibleContactRows.length },
    { id: 'customer', label: 'Customer', count: customerCount },
    { id: 'loyal', label: 'Loyal', count: loyalCount },
    { id: 'unmapped', label: 'Belum CS', count: unmappedCount },
  ];
  const csSelectValue = isCsScopedUser ? currentUser?.id || ALL_CS_FILTER : csFilter;
  const currentCsLabel = currentUser ? getUserDisplayName(currentUser) : 'CS';

  return (
    <OperationalPageShell className="contactsPage">
      <div className="contactsPageStack flex flex-col space-y-4">
        <OperationalPageHeader
          eyebrow="Prospek & Channel"
          icon={Users}
          title="Database Kontak"
          subtitle="Kontak CRM dari pesanan dan input manual, dengan riwayat pemakaian jasa yang digabung per nomor."
          onRefresh={() => void refreshAll()}
          isRefreshing={loading || isRefreshing}
          actions={
            <div className="contactsHeaderActions flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="outline"
                className="contactsHeaderButton h-10 rounded-xl border-slate-200 bg-white px-4 text-slate-700 shadow-sm dark:border-slate-800 dark:bg-slate-950 dark:text-slate-200"
                onClick={() => setCreatingContact(true)}
              >
                <Plus className="mr-2 h-4 w-4" />
                <span>Tambah Kontak</span>
              </Button>
            </div>
          }
        />

        <OperationalKpiGrid className="contactsKpiGrid">
          <OperationalKpiCard label="Total" value={formatNumber(visibleContactRows.length)} icon={Users} />
          <OperationalKpiCard label="Customer" value={formatNumber(customerCount)} icon={Check} tone="emerald" />
          <OperationalKpiCard label="Loyal" value={formatNumber(loyalCount)} icon={Check} tone="blue" />
          <OperationalKpiCard label="Belum CS" value={formatNumber(unmappedCount)} icon={AlertTriangle} tone="amber" />
        </OperationalKpiGrid>

        {error ? (
          <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <div>
              <div className="font-semibold">
                {isUsingOrderFallback
                  ? 'Database CRM lambat dimuat, kontak pesanan ditampilkan sementara.'
                  : 'Database kontak belum berhasil dimuat.'}
              </div>
              <div className="mt-1">
                {isUsingOrderFallback
                  ? `${error} Data akan diperbarui otomatis saat database CRM selesai merespons.`
                  : error}
              </div>
            </div>
          </div>
        ) : null}

        <OperationalFilterPanel className="contactsFilterPanel">
          <div className="contactsFilterStack flex flex-col gap-4">
            <div className="contactsTabScroller flex w-full flex-wrap gap-2 rounded-xl border border-slate-200 bg-slate-50/80 p-2 dark:border-slate-800 dark:bg-slate-950/40">
              {contactTabs.map((tab) => {
                const active = tabFilter === tab.id;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setTabFilter(tab.id)}
                    className={cn(
                      'contactsFilterTab inline-flex h-10 min-w-[120px] items-center justify-center gap-2 rounded-lg px-3 text-sm font-semibold transition-all',
                      active
                        ? 'border border-blue-200 bg-white text-blue-700 shadow-sm'
                        : 'text-slate-500 hover:bg-white/80 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-900 dark:hover:text-slate-100',
                    )}
                  >
                    {tab.label}
                    <FilterCount value={tab.count} />
                  </button>
                );
              })}
            </div>

            <FilterRow className="contactsFilterGrid grid gap-3">
              <div className="contactsSearchField relative">
                <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <Input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Cari nama, nomor, email, akun, atau CS..."
                  className="contactsFilterControl h-11 rounded-xl border-slate-200 bg-white pl-11 text-sm shadow-sm dark:border-slate-800 dark:bg-slate-950"
                />
              </div>

              <Select
                value={providerFilter}
                onValueChange={(value) => setProviderFilter(value as 'all' | WhatsAppProvider)}
              >
                <SelectTrigger className="contactsFilterControl h-11 rounded-xl border-slate-200 bg-white px-4 text-sm font-semibold shadow-sm dark:border-slate-800 dark:bg-slate-950">
                  <SelectValue placeholder="Provider" />
                </SelectTrigger>
                <SelectContent>
                  {PROVIDER_FILTERS.map((filter) => (
                    <SelectItem key={filter.id} value={filter.id}>
                      {filter.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select value={csSelectValue} onValueChange={setCsFilter} disabled={isCsScopedUser}>
                <SelectTrigger className="contactsFilterControl h-11 rounded-xl border-slate-200 bg-white px-4 text-sm font-semibold shadow-sm dark:border-slate-800 dark:bg-slate-950">
                  <SelectValue placeholder="Filter CS" />
                </SelectTrigger>
                <SelectContent>
                  {isCsScopedUser ? (
                    <SelectItem value={currentUser?.id || ALL_CS_FILTER}>
                      {currentCsLabel} ({formatNumber(visibleContactRows.length)})
                    </SelectItem>
                  ) : (
                    <>
                      <SelectItem value={ALL_CS_FILTER}>Semua CS</SelectItem>
                      {csOptions.map((option) => (
                        <SelectItem key={option.id} value={option.id}>
                          {option.label} ({formatNumber(option.count)})
                        </SelectItem>
                      ))}
                      <SelectItem value={UNASSIGNED_CS_FILTER}>
                        Belum CS ({formatNumber(unmappedCount)})
                      </SelectItem>
                    </>
                  )}
                </SelectContent>
              </Select>

              <Select
                value={workStatusFilter}
                onValueChange={(value) => setWorkStatusFilter(value as WorkStatusFilterValue)}
              >
                <SelectTrigger className="contactsFilterControl h-11 rounded-xl border-slate-200 bg-white px-4 text-sm font-semibold shadow-sm dark:border-slate-800 dark:bg-slate-950">
                  <SelectValue placeholder="Status pengerjaan" />
                </SelectTrigger>
                <SelectContent>
                  {workStatusOptions.map((option) => (
                    <SelectItem key={option.id} value={option.id}>
                      {option.label} ({formatNumber(option.count)})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select
                value={followUpFilter}
                onValueChange={(value) => setFollowUpFilter(value as FollowUpFilterValue)}
              >
                <SelectTrigger className="contactsFilterControl h-11 rounded-xl border-slate-200 bg-white px-4 text-sm font-semibold shadow-sm dark:border-slate-800 dark:bg-slate-950">
                  <SelectValue placeholder="Follow up" />
                </SelectTrigger>
                <SelectContent>
                  {followUpOptions.map((option) => (
                    <SelectItem key={option.id} value={option.id}>
                      {option.label} ({formatNumber(option.count)})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Button
                type="button"
                variant="outline"
                className="contactsResetButton h-11 rounded-xl border-slate-200 bg-white px-4 text-sm font-semibold shadow-sm dark:border-slate-800 dark:bg-slate-950"
                disabled={!hasActiveFilters}
                onClick={resetFilters}
              >
                Reset
              </Button>
            </FilterRow>
          </div>
        </OperationalFilterPanel>

        <OperationalTableCard className="contactsTableCard">
          <div className="contactsTableHeader flex flex-wrap items-center justify-between gap-3 px-6 py-5">
            <MasterDataTableTitle
              title="Database Kontak"
              count={formatNumber(filteredContacts.length)}
              icon={Users}
              variant="active"
            />
            {isRefreshing ? (
              <span className="inline-flex h-8 items-center gap-2 rounded-full border border-blue-100 bg-blue-50 px-3 text-xs font-semibold text-blue-700 dark:border-blue-900/60 dark:bg-blue-950/30 dark:text-blue-200">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                {syncLabel}
              </span>
            ) : duplicateCount > 0 ? (
              <span className="inline-flex h-8 items-center rounded-full border border-emerald-100 bg-emerald-50 px-3 text-xs font-semibold text-emerald-700 dark:border-emerald-900/60 dark:text-emerald-200">
                {formatNumber(duplicateCount)} duplikat digabung
              </span>
            ) : null}
          </div>

        <DataTable
          className="contactDataTable"
          dragScroll
          minWidth={CONTACT_TABLE_MIN_WIDTH}
          columns={createDataTableColumns([
            { align: 'center', minWidth: 64, width: '64px' },
            { minWidth: 330, width: '330px' },
            { minWidth: 520, width: '520px' },
            { align: 'center', minWidth: 140, width: '140px' },
            { align: 'center', minWidth: 180, width: '180px' },
            { minWidth: 200, width: '200px' },
            { minWidth: 220, width: '220px' },
            { align: 'center', minWidth: 88, width: '88px' },
          ])}
          primaryLines={2}
          secondaryLines={2}
          rowMinHeight={88}
        >
          <table>
            <TableHeader>
              <TableRow>
                <TableHead>No</TableHead>
                <TableHead>Kontak</TableHead>
                <TableHead>Alamat</TableHead>
                <TableHead>Lifecycle</TableHead>
                <TableHead>CS</TableHead>
                <TableHead>Pakai Jasa</TableHead>
                <TableHead>Pengerjaan</TableHead>
                <TableHead>Aksi</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {showTableSkeleton ? (
                Array.from({ length: 7 }).map((_, index) => (
                  <TableRow key={index}>
                    <TableCell><Skeleton className="mx-auto h-4 w-4" /></TableCell>
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <Skeleton className="h-10 w-10 rounded-full" />
                        <div className="space-y-2">
                          <Skeleton className="h-4 w-36" />
                          <Skeleton className="h-3 w-32" />
                          <Skeleton className="h-3 w-28" />
                        </div>
                      </div>
                    </TableCell>
                    <TableCell><Skeleton className="h-4 w-40" /></TableCell>
                    <TableCell><Skeleton className="mx-auto h-7 w-24 rounded-full" /></TableCell>
                    <TableCell><Skeleton className="mx-auto h-7 w-28 rounded-full" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-32" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-24" /></TableCell>
                    <TableCell><Skeleton className="mx-auto h-8 w-8 rounded-full" /></TableCell>
                  </TableRow>
                ))
              ) : filteredContacts.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="h-72 text-center">
                    <div className="mx-auto flex max-w-sm flex-col items-center justify-center gap-3 text-slate-500">
                      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-slate-400">
                        <Users className="h-5 w-5" />
                      </div>
                      <div className="font-semibold text-slate-900 dark:text-slate-100">
                        Belum ada kontak yang sesuai.
                      </div>
                      <p className="text-sm leading-6">
                        Kontak akan muncul otomatis saat customer dibuatkan pesanan.
                      </p>
                    </div>
                  </TableCell>
                </TableRow>
              ) : (
                paginatedContacts.map((contact, index) => {
                  const createdAt = contact.createdAt || contact.updatedAt;
                  const phoneKey = getContactPhoneKey(contact);
                  const orderSummary = phoneKey ? orderSummaryByPhone.get(phoneKey) : undefined;
                  const leadSummary = phoneKey ? leadSummaryByPhone.get(phoneKey) : undefined;
                  const lifecycle = getContactLifecycle(contact, orderSummary, leadSummary);
                  const lastServiceAt = orderSummary?.lastAt || createdAt;
                  const contactDetailKey = getContactGroupKey(contact);
                  return (
                    <TableRow
                      key={contactDetailKey}
                      role="button"
                      tabIndex={0}
                      className="cursor-pointer transition-colors hover:bg-slate-50/90 focus-visible:bg-slate-50 focus-visible:outline-none dark:hover:bg-slate-900/70 dark:focus-visible:bg-slate-900/70"
                      onClick={() => {
                        setSelectedContactMode('view');
                        setSelectedContactKey(contactDetailKey);
                      }}
                      onKeyDown={(event) => {
                        if (event.key !== 'Enter' && event.key !== ' ') return;
                        event.preventDefault();
                        setSelectedContactMode('view');
                        setSelectedContactKey(contactDetailKey);
                      }}
                    >
                      <TableCell>{pageStartIndex + index + 1}</TableCell>
                      <TableCell>
                        <div className="flex min-w-0 items-center gap-3">
                          <WhatsAppContactAvatar
                            src={getContactAvatarUrl(contact)}
                            name={getContactName(contact)}
                            phone={contact.phoneNumber}
                            className={cn(
                              'flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full text-xs font-semibold',
                              getAvatarClassName(contact),
                            )}
                          />
                          <div className="min-w-0">
                            <div className="flex min-w-0 items-center gap-2">
                              <span className="truncate text-sm font-semibold text-slate-950 dark:text-slate-100">
                                {getContactName(contact)}
                              </span>
                              {contact.duplicateCount > 1 ? (
                                <Badge variant="outline" className="h-5 shrink-0 rounded-full px-1.5 text-[10px]">
                                  x{formatNumber(contact.duplicateCount)}
                                </Badge>
                              ) : null}
                            </div>
                            {contact.email?.trim() ? (
                              <div className="mt-1 truncate text-xs font-medium text-slate-500 dark:text-slate-400">
                                {contact.email.trim()}
                              </div>
                            ) : null}
                            <div className="mt-1 flex min-w-0 items-center gap-1.5 text-xs font-medium text-slate-500">
                              <Phone className="h-3.5 w-3.5 shrink-0" />
                              <span className="truncate">{formatPhoneNumber(contact.phoneNumber)}</span>
                              <button
                                type="button"
                                className="inline-flex h-5 w-5 shrink-0 items-center justify-center border-0 bg-transparent p-0 text-emerald-600 shadow-none outline-none ring-0 hover:text-emerald-700 focus-visible:text-emerald-700"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  openWhatsAppChat(contact.phoneNumber);
                                }}
                                aria-label={`Chat WhatsApp ${getContactName(contact)}`}
                                title="Chat WhatsApp"
                              >
                                <MessageCircle className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div
                          className="line-clamp-2 max-w-[500px] text-sm font-medium leading-5 text-slate-600 dark:text-slate-300"
                          title={orderSummary?.lastAddress || undefined}
                        >
                          {orderSummary?.lastAddress || '-'}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center justify-center gap-1.5">
                          <Badge
                            variant="outline"
                            className={cn('rounded-full font-semibold', getLifecycleBadgeClassName(lifecycle))}
                          >
                            {lifecycle}
                          </Badge>
                          {leadSummary && lifecycle === 'Prospek' ? (
                            <Badge variant="outline" className="rounded-full border-slate-200 bg-white text-slate-600">
                              {leadSummary.status}
                            </Badge>
                          ) : null}
                        </div>
                      </TableCell>
                      <TableCell>
                        <CsOwnerBadge contact={contact} />
                      </TableCell>
                      <TableCell>
                        <div className="min-w-0">
                          <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                            {orderSummary?.count
                              ? `${formatNumber(orderSummary.count)}x pakai jasa`
                              : leadSummary
                                ? `Prospek ${leadSummary.status}`
                                : 'Belum order'}
                          </div>
                          <div className="mt-1 flex min-w-0 items-center gap-1.5 text-xs font-medium text-slate-500">
                            {orderSummary?.count ? (
                              <>
                                <Check className="h-3.5 w-3.5 shrink-0" />
                                <span className="truncate">{formatCurrency(orderSummary.totalValue)}</span>
                              </>
                            ) : (
                              <>
                                <Smartphone className="h-3.5 w-3.5 shrink-0" />
                                <span className="truncate">{getCrmSourceLabel(contact)}</span>
                              </>
                            )}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                          {formatRelativeDate(lastServiceAt)}
                        </div>
                        <div className="mt-1 text-xs font-medium text-slate-500" title={formatDateTime(lastServiceAt)}>
                          {formatDateOnly(lastServiceAt)}
                        </div>
                        {orderSummary?.lastStatus ? (
                          <OrderStatusIndicator status={orderSummary.lastStatus} className="mt-1" />
                        ) : null}
                      </TableCell>
                      <TableCell>
                        <div
                          className="flex items-center justify-center"
                          onClick={(event) => event.stopPropagation()}
                          onKeyDown={(event) => event.stopPropagation()}
                        >
                          <TableActionMenu
                            contentClassName="w-40"
                            trigger={
                              <button
                                type="button"
                                className="inline-flex h-9 w-9 items-center justify-center border-0 bg-transparent p-0 text-slate-500 shadow-none outline-none ring-0 hover:text-blue-700 focus-visible:text-blue-700"
                                aria-label={`Aksi ${getContactName(contact)}`}
                                title="Aksi"
                              >
                                <MoreVertical className="h-5 w-5" />
                              </button>
                            }
                          >
                            <TableActionMenuItem
                              icon={Eye}
                              onClick={() => {
                                setSelectedContactMode('view');
                                setSelectedContactKey(contactDetailKey);
                              }}
                            >
                              Detail
                            </TableActionMenuItem>
                            <TableActionMenuItem
                              icon={Pencil}
                              onClick={() => {
                                setSelectedContactMode('edit');
                                setSelectedContactKey(contactDetailKey);
                              }}
                            >
                              Edit
                            </TableActionMenuItem>
                            <TableActionMenuItem
                              danger
                              icon={Trash2}
                              onClick={() => setDeleteContactTarget(contact)}
                            >
                              Hapus
                            </TableActionMenuItem>
                          </TableActionMenu>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </table>
        </DataTable>
          <div className="flex flex-col gap-3 border-t border-slate-200 p-4 dark:border-slate-800 sm:flex-row sm:items-center sm:justify-between">
            <div className="text-sm font-medium text-slate-500 dark:text-slate-400">
              Menampilkan {filteredContacts.length === 0 ? 0 : pageStartIndex + 1}-{pageEndIndex} dari {filteredContacts.length} kontak
            </div>

            <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-end sm:gap-x-4">
              <div className="flex items-center gap-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 border-0 !bg-transparent text-slate-500 !shadow-none hover:!bg-transparent hover:text-slate-900 focus-visible:ring-0 focus-visible:ring-offset-0 disabled:!bg-transparent disabled:text-slate-300 dark:text-slate-400 dark:hover:!bg-transparent dark:hover:text-slate-100"
                  disabled={safeCurrentPage <= 1}
                  onClick={() => setCurrentPage((page) => Math.max(1, page - 1))}
                  aria-label="Halaman sebelumnya"
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <div className="flex min-w-[64px] items-center justify-center text-sm font-semibold text-slate-700 dark:text-slate-200">
                  {safeCurrentPage}
                  <span className="mx-1 text-slate-400">/</span>
                  <span className="text-slate-500">{totalPages}</span>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 border-0 !bg-transparent text-slate-500 !shadow-none hover:!bg-transparent hover:text-slate-900 focus-visible:ring-0 focus-visible:ring-offset-0 disabled:!bg-transparent disabled:text-slate-300 dark:text-slate-400 dark:hover:!bg-transparent dark:hover:text-slate-100"
                  disabled={safeCurrentPage >= totalPages || totalPages === 0}
                  onClick={() => setCurrentPage((page) => Math.min(totalPages, page + 1))}
                  aria-label="Halaman berikutnya"
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>

              <div className="flex shrink-0 items-center gap-2">
                <span className="shrink-0 whitespace-nowrap text-xs font-semibold text-slate-500 dark:text-slate-400">
                  Tampilkan
                </span>
                <Select
                  value={String(itemsPerPage)}
                  onValueChange={(value) => {
                    setItemsPerPage(Number(value));
                    setCurrentPage(1);
                  }}
                >
                  <SelectTrigger className="h-8 w-[150px] shrink-0 rounded-md border-blue-200 bg-white text-xs text-slate-700 shadow-sm hover:border-blue-300 focus:ring-blue-200 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="z-[200]">
                    {CONTACT_PAGE_SIZE_OPTIONS.map((option) => (
                      <SelectItem key={option} value={String(option)}>
                        {option} / Halaman
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
        </OperationalTableCard>

        <Dialog open={creatingContact} onOpenChange={setCreatingContact}>
          <DialogContent className="max-w-2xl rounded-2xl border-slate-200 p-0 shadow-2xl dark:border-slate-800">
            <DialogHeader className="border-b border-slate-100 px-6 py-5 dark:border-slate-800">
              <DialogTitle className="flex items-center gap-2 text-lg font-bold text-slate-950 dark:text-slate-100">
                <Plus className="h-5 w-5 text-blue-600" />
                Tambah Kontak
              </DialogTitle>
              <DialogDescription>Kontak manual akan digabung dengan riwayat pesanan jika nomornya cocok.</DialogDescription>
            </DialogHeader>

            <div className="space-y-5 p-6">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="new-contact-name">Nama</Label>
                  <Input
                    id="new-contact-name"
                    value={newContactForm.displayName}
                    onChange={(event) =>
                      setNewContactForm((current) => ({ ...current, displayName: event.target.value }))
                    }
                    className="h-10 rounded-xl border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-950"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="new-contact-phone">Nomor</Label>
                  <div className="relative">
                    <Phone className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                    <Input
                      id="new-contact-phone"
                      value={newContactForm.phoneRaw || ''}
                      onChange={(event) =>
                        setNewContactForm((current) => ({ ...current, phoneRaw: event.target.value }))
                      }
                      placeholder="08..."
                      className="h-10 rounded-xl border-slate-200 bg-white pl-9 dark:border-slate-800 dark:bg-slate-950"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="new-contact-email">Email</Label>
                  <div className="relative">
                    <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                    <Input
                      id="new-contact-email"
                      value={newContactForm.email}
                      onChange={(event) =>
                        setNewContactForm((current) => ({ ...current, email: event.target.value }))
                      }
                      placeholder="-"
                      className="h-10 rounded-xl border-slate-200 bg-white pl-9 dark:border-slate-800 dark:bg-slate-950"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label>CS Owner</Label>
                  <Select
                    value={newContactForm.csProfileId}
                    onValueChange={(value) =>
                      setNewContactForm((current) => ({ ...current, csProfileId: value }))
                    }
                  >
                    <SelectTrigger className="h-10 rounded-xl border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-950">
                      <SelectValue placeholder="Pilih CS" />
                    </SelectTrigger>
                    <SelectContent className="z-[220]">
                      <SelectItem value={CONTACT_UNASSIGNED_CS_VALUE}>Belum ada CS</SelectItem>
                      {csOptions.map((option) => (
                        <SelectItem key={option.id} value={option.id}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="new-contact-notes" className="flex items-center gap-2">
                  <StickyNote className="h-4 w-4 text-slate-400" />
                  Catatan
                </Label>
                <Textarea
                  id="new-contact-notes"
                  value={newContactForm.notes}
                  onChange={(event) =>
                    setNewContactForm((current) => ({ ...current, notes: event.target.value }))
                  }
                  placeholder="Catatan preferensi customer, follow up, atau konteks penting."
                  className="min-h-28 resize-y rounded-xl border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-950"
                />
              </div>
            </div>

            <DialogFooter className="border-t border-slate-100 px-6 py-4 dark:border-slate-800">
              <Button
                type="button"
                variant="outline"
                className="h-10 rounded-xl"
                onClick={() => setCreatingContact(false)}
              >
                Batal
              </Button>
              <Button
                type="button"
                className="h-10 rounded-xl bg-blue-600 px-4 text-white hover:bg-blue-700"
                disabled={savingNewContact}
                onClick={() => void handleCreateContact()}
              >
                {savingNewContact ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                Simpan
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog
          open={Boolean(selectedContact)}
          onOpenChange={(open) => {
            if (open) return;
            setSelectedContactKey(null);
            setSelectedContactMode('view');
          }}
        >
          <DialogContent className="flex max-h-[90vh] max-w-4xl flex-col gap-0 overflow-hidden rounded-2xl border-slate-200 p-0 shadow-2xl dark:border-slate-800">
            <DialogHeader className="shrink-0 border-b border-slate-100 px-6 py-4 dark:border-slate-800">
              <DialogTitle className="flex items-center gap-2 text-lg font-bold text-slate-950 dark:text-slate-100">
                <Users className="h-5 w-5 text-blue-600" />
                Detail Kontak
              </DialogTitle>
              <DialogDescription>
                {selectedContact ? formatPhoneNumber(selectedContact.phoneNumber) : 'Kontak customer'}
              </DialogDescription>
            </DialogHeader>

            {selectedContact ? (
              <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
                <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-slate-50/70 p-3 dark:border-slate-800 dark:bg-slate-950/40 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex min-w-0 items-center gap-3">
                    <WhatsAppContactAvatar
                      src={getContactAvatarUrl(selectedContact)}
                      name={getContactName(selectedContact)}
                      phone={selectedContact.phoneNumber}
                      className={cn(
                        'flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-full text-sm font-bold',
                        getAvatarClassName(selectedContact),
                      )}
                    />
                    <div className="min-w-0">
                      <div className="truncate text-base font-bold text-slate-950 dark:text-slate-100">
                        {getContactName(selectedContact)}
                      </div>
                      {selectedContact.email?.trim() ? (
                        <div className="mt-1 truncate text-xs font-medium text-slate-500">
                          {selectedContact.email.trim()}
                        </div>
                      ) : null}
                      <div className="mt-1 flex min-w-0 items-center gap-1.5 text-xs font-medium text-slate-500">
                        <span className="truncate">{formatPhoneNumber(selectedContact.phoneNumber)}</span>
                        <button
                          type="button"
                          className="inline-flex h-5 w-5 shrink-0 items-center justify-center border-0 bg-transparent p-0 text-emerald-600 shadow-none outline-none ring-0 hover:text-emerald-700 focus-visible:text-emerald-700"
                          onClick={() => openWhatsAppChat(selectedContact.phoneNumber)}
                          aria-label={`Chat WhatsApp ${getContactName(selectedContact)}`}
                          title="Chat WhatsApp"
                        >
                          <MessageCircle className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-2 sm:justify-end">
                    <Badge
                      variant="outline"
                      className={cn('rounded-full font-semibold', getLifecycleBadgeClassName(selectedLifecycle))}
                    >
                      {selectedLifecycle}
                    </Badge>
                    <CsOwnerBadge contact={selectedContact} />
                  </div>
                </div>

                <div className="mt-3 grid gap-3 sm:grid-cols-3">
                  <div className="rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
                    <div className="flex items-center gap-2 text-xs font-semibold text-slate-500">
                      <Check className="h-3.5 w-3.5" />
                      Pakai Jasa
                    </div>
                    <div className="mt-2 text-sm font-bold text-slate-950 dark:text-slate-100">
                      {selectedOrderSummary?.count ? `${formatNumber(selectedOrderSummary.count)}x` : 'Belum order'}
                    </div>
                    <div className="mt-1 text-xs font-medium text-slate-500">
                      {selectedOrderSummary?.totalValue ? formatCurrency(selectedOrderSummary.totalValue) : '-'}
                    </div>
                  </div>

                  <div className="rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
                    <div className="text-xs font-semibold text-slate-500">Total Nilai</div>
                    <div className="mt-2 text-sm font-bold text-slate-950 dark:text-slate-100">
                      {selectedOrderSummary?.totalValue ? formatCurrency(selectedOrderSummary.totalValue) : '-'}
                    </div>
                    <div className="mt-1 text-xs font-medium text-slate-500">
                      {selectedLifecycle}
                    </div>
                  </div>

                  <div className="rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
                    <div className="flex items-center gap-2 text-xs font-semibold text-slate-500">
                      <CalendarDays className="h-3.5 w-3.5" />
                      Pengerjaan Terakhir
                    </div>
                    <div className="mt-2 text-sm font-bold text-slate-950 dark:text-slate-100">
                      {formatRelativeDate(selectedOrderSummary?.lastAt || selectedContact.updatedAt)}
                    </div>
                    <div className="mt-1 text-xs font-medium text-slate-500">
                      {formatDateOnly(selectedOrderSummary?.lastAt || selectedContact.updatedAt)}
                    </div>
                    {selectedOrderSummary?.lastStatus ? (
                      <OrderStatusIndicator status={selectedOrderSummary.lastStatus} className="mt-1" />
                    ) : null}
                  </div>
                </div>

                <div className="mt-4 space-y-4">
                    {editingContact ? (
                      <>
                        <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
                          <div className="mb-4 text-sm font-bold text-slate-950 dark:text-slate-100">Data Kontak</div>
                          <div className="grid gap-4 sm:grid-cols-2">
                            <div className="space-y-2">
                              <Label htmlFor="contact-display-name">Nama</Label>
                              <Input
                                id="contact-display-name"
                                value={contactForm.displayName}
                                onChange={(event) =>
                                  setContactForm((current) => ({ ...current, displayName: event.target.value }))
                                }
                                className="h-10 rounded-xl border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-950"
                              />
                            </div>

                          <div className="space-y-2">
                            <Label htmlFor="contact-email">Email</Label>
                            <div className="relative">
                              <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                              <Input
                                id="contact-email"
                                value={contactForm.email}
                                onChange={(event) =>
                                  setContactForm((current) => ({ ...current, email: event.target.value }))
                                }
                                placeholder="-"
                                className="h-10 rounded-xl border-slate-200 bg-white pl-9 dark:border-slate-800 dark:bg-slate-950"
                              />
                            </div>
                          </div>

                          <div className="space-y-2">
                            <Label>Nomor</Label>
                            <div className="relative">
                              <Phone className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                              <Input
                                value={contactForm.phoneRaw || ''}
                                onChange={(event) =>
                                  setContactForm((current) => ({ ...current, phoneRaw: event.target.value }))
                                }
                                className="h-10 rounded-xl border-slate-200 bg-white pl-9 dark:border-slate-800 dark:bg-slate-950"
                              />
                            </div>
                          </div>

                          <div className="space-y-2">
                            <Label>CS Owner</Label>
                            <Select
                              value={contactForm.csProfileId}
                              onValueChange={(value) =>
                                setContactForm((current) => ({ ...current, csProfileId: value }))
                              }
                            >
                              <SelectTrigger className="h-10 rounded-xl border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-950">
                                <SelectValue placeholder="Pilih CS" />
                              </SelectTrigger>
                              <SelectContent className="z-[220]">
                                <SelectItem value={CONTACT_UNASSIGNED_CS_VALUE}>Belum ada CS</SelectItem>
                                {csOptions.map((option) => (
                                  <SelectItem key={option.id} value={option.id}>
                                    {option.label}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                        </div>
                      </div>

                      <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
                        <Label htmlFor="contact-notes" className="flex items-center gap-2">
                          <StickyNote className="h-4 w-4 text-slate-400" />
                          Catatan
                        </Label>
                        <Textarea
                          id="contact-notes"
                          value={contactForm.notes}
                          onChange={(event) =>
                            setContactForm((current) => ({ ...current, notes: event.target.value }))
                          }
                          placeholder="Catatan preferensi customer, follow up, atau konteks penting."
                          className="min-h-28 resize-y rounded-xl border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-950"
                        />
                      </div>
                    </>
                  ) : (
                    <div className="space-y-4">
                      <div className="rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
                        <div className="border-b border-slate-100 px-4 py-3 text-sm font-bold text-slate-950 dark:border-slate-800 dark:text-slate-100">
                          Data Kontak
                        </div>
                        <div className="divide-y divide-slate-100 dark:divide-slate-800">
                          <div className="grid gap-1 px-3 py-2.5 sm:grid-cols-[120px_minmax(0,1fr)]">
                            <div className="text-xs font-semibold uppercase tracking-normal text-slate-400">Nama</div>
                            <div className="break-words text-sm font-semibold text-slate-950 dark:text-slate-100">
                              {getContactName(selectedContact)}
                            </div>
                          </div>

                          <div className="grid gap-1 px-3 py-2.5 sm:grid-cols-[120px_minmax(0,1fr)]">
                            <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-normal text-slate-400">
                              <Mail className="h-3.5 w-3.5" />
                              Email
                            </div>
                            <div className="break-words text-sm font-semibold text-slate-950 dark:text-slate-100">
                              {selectedContact.email?.trim() || '-'}
                            </div>
                          </div>

                          <div className="grid gap-1 px-3 py-2.5 sm:grid-cols-[120px_minmax(0,1fr)]">
                            <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-normal text-slate-400">
                              <Phone className="h-3.5 w-3.5" />
                              Nomor
                            </div>
                            <div className="break-words text-sm font-semibold text-slate-950 dark:text-slate-100">
                              {formatPhoneNumber(selectedContact.phoneNumber)}
                            </div>
                          </div>

                          <div className="grid gap-2 px-3 py-2.5 sm:grid-cols-[120px_minmax(0,1fr)]">
                            <div className="text-xs font-semibold uppercase tracking-normal text-slate-400">CS Owner</div>
                            <div>
                              <CsOwnerBadge contact={selectedContact} />
                            </div>
                          </div>
                        </div>
                      </div>

                      <div className="rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
                        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-normal text-slate-400">
                          <StickyNote className="h-3.5 w-3.5" />
                          Catatan
                        </div>
                        <div className="mt-2 whitespace-pre-wrap break-words text-sm font-medium leading-6 text-slate-700 dark:text-slate-300">
                          {selectedContact.crmNotes?.trim() || 'Belum ada catatan.'}
                        </div>
                      </div>
                    </div>
                  )}

                  <div className="rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
                    <div className="border-b border-slate-100 px-4 py-3 text-sm font-bold text-slate-950 dark:border-slate-800 dark:text-slate-100">
                      Follow Up CRM
                    </div>
                    {editingContact ? (
                      <div className="grid gap-4 p-4 sm:grid-cols-3">
                        <div className="space-y-2">
                          <Label>Status Follow Up</Label>
                          <Select
                            value={contactForm.followUpStatus || 'none'}
                            onValueChange={(value) =>
                              setContactForm((current) => ({ ...current, followUpStatus: value }))
                            }
                          >
                            <SelectTrigger className="h-10 rounded-xl border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-950">
                              <SelectValue placeholder="Pilih status" />
                            </SelectTrigger>
                            <SelectContent className="z-[220]">
                              {FOLLOW_UP_STATUS_OPTIONS.map((option) => (
                                <SelectItem key={option.id} value={option.id}>
                                  {option.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>

                        <div className="space-y-2">
                          <Label htmlFor="contact-last-contacted-at">Terakhir Dihubungi</Label>
                          <Input
                            id="contact-last-contacted-at"
                            type="date"
                            value={contactForm.lastContactedAt}
                            onChange={(event) =>
                              setContactForm((current) => ({ ...current, lastContactedAt: event.target.value }))
                            }
                            className="h-10 rounded-xl border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-950"
                          />
                        </div>

                        <div className="space-y-2">
                          <Label htmlFor="contact-next-follow-up-at">Follow Up Berikutnya</Label>
                          <Input
                            id="contact-next-follow-up-at"
                            type="date"
                            value={contactForm.nextFollowUpAt}
                            onChange={(event) =>
                              setContactForm((current) => ({ ...current, nextFollowUpAt: event.target.value }))
                            }
                            className="h-10 rounded-xl border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-950"
                          />
                        </div>
                      </div>
                    ) : (
                      <div className="grid gap-3 p-4 sm:grid-cols-3">
                        <div>
                          <div className="text-[11px] font-semibold uppercase tracking-normal text-slate-400">
                            Status
                          </div>
                          <Badge
                            variant="outline"
                            className={cn(
                              'mt-2 rounded-full font-semibold',
                              getFollowUpStatusClassName(getContactMetadataString(selectedContact, ['followUpStatus'])),
                            )}
                          >
                            {getFollowUpStatusLabel(getContactMetadataString(selectedContact, ['followUpStatus']))}
                          </Badge>
                        </div>

                        <div>
                          <div className="text-[11px] font-semibold uppercase tracking-normal text-slate-400">
                            Terakhir Dihubungi
                          </div>
                          <div className="mt-2 text-sm font-semibold text-slate-950 dark:text-slate-100">
                            {formatDateOnly(getContactMetadataString(selectedContact, ['lastContactedAt']))}
                          </div>
                        </div>

                        <div>
                          <div className="text-[11px] font-semibold uppercase tracking-normal text-slate-400">
                            Follow Up Berikutnya
                          </div>
                          <div className="mt-2 text-sm font-semibold text-slate-950 dark:text-slate-100">
                            {formatDateOnly(getContactMetadataString(selectedContact, ['nextFollowUpAt']))}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>

                  {selectedContact.duplicateContacts.length > 1 ? (
                    <div className="rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
                      <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-3 dark:border-slate-800">
                        <div className="text-sm font-bold text-slate-950 dark:text-slate-100">Data Tergabung</div>
                        <Badge variant="outline" className="rounded-full border-slate-200 bg-slate-50 text-slate-600">
                          {formatNumber(selectedContact.duplicateContacts.length)}
                        </Badge>
                      </div>

                      <div className="divide-y divide-slate-100 dark:divide-slate-800">
                        {selectedContact.duplicateContacts.map((candidate, index) => {
                          const candidateCsLabel = candidate.csProfileId
                            ? userNameById.get(candidate.csProfileId) || getContactCsLabel(candidate)
                            : getContactCsLabel(candidate);
                          return (
                            <div
                              key={`${candidate.id}-${candidate.channelId}-${index}`}
                              className="grid gap-3 px-4 py-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]"
                            >
                              <div className="min-w-0">
                                <div className="flex flex-wrap items-center gap-2">
                                  <span className="break-words text-sm font-bold text-slate-950 dark:text-slate-100">
                                    {getContactName(candidate)}
                                  </span>
                                  <Badge variant="outline" className="rounded-full border-slate-200 bg-slate-50 text-[10px] text-slate-600">
                                    {getCrmSourceLabel(candidate)}
                                  </Badge>
                                </div>
                                <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs font-medium text-slate-500">
                                  <span>{formatPhoneNumber(candidate.phoneNumber)}</span>
                                  <span>{candidate.email?.trim() || '-'}</span>
                                </div>
                              </div>

                              <div className="min-w-0 text-xs font-medium text-slate-500">
                                <div className="text-[11px] font-semibold uppercase tracking-normal text-slate-400">
                                  CS / Akun
                                </div>
                                <div className="mt-1 truncate text-sm font-semibold text-slate-700 dark:text-slate-300">
                                  {candidateCsLabel}
                                </div>
                                <div className="mt-0.5 truncate">{getContactAccountLabel(candidate)}</div>
                              </div>

                              <Button
                                type="button"
                                variant="outline"
                                className="h-9 rounded-xl px-3 text-xs font-semibold lg:self-center"
                                onClick={() => handleUseDuplicateAsPrimary(candidate)}
                              >
                                Pakai data ini
                              </Button>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ) : null}

                  <div className="rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
                    <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-3 dark:border-slate-800">
                      <div className="text-sm font-bold text-slate-950 dark:text-slate-100">Riwayat Alamat</div>
                      <Badge variant="outline" className="rounded-full border-slate-200 bg-slate-50 text-slate-600">
                        {formatNumber(selectedAddressHistory.length)}
                      </Badge>
                    </div>

                    {selectedAddressHistory.length === 0 ? (
                      <div className="px-4 py-6 text-sm font-medium text-slate-500">
                        Belum ada alamat tersimpan dari pesanan.
                      </div>
                    ) : (
                      <div className="divide-y divide-slate-100 dark:divide-slate-800">
                        {selectedAddressHistory.map((addressItem, index) => (
                          <div
                            key={`${addressItem.address}-${index}`}
                            className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-start sm:justify-between"
                          >
                            <div className="flex min-w-0 gap-2">
                              <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
                              <div className="min-w-0">
                                <div className="whitespace-pre-wrap break-words text-sm font-semibold leading-6 text-slate-950 dark:text-slate-100">
                                  {addressItem.address}
                                </div>
                                <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs font-medium text-slate-500">
                                  <span>{formatNumber(addressItem.count)}x pesanan</span>
                                  <span>Terakhir {formatDateWithRelative(addressItem.lastAt)}</span>
                                </div>
                              </div>
                            </div>

                            {addressItem.mapsUrl ? (
                              <a
                                href={addressItem.mapsUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="shrink-0 text-xs font-semibold text-blue-700 hover:text-blue-800"
                              >
                                Buka Maps
                              </a>
                            ) : null}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
                    <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-3 dark:border-slate-800">
                      <div>
                        <div className="text-sm font-bold text-slate-950 dark:text-slate-100">Riwayat Pesanan</div>
                      </div>
                      <Badge variant="outline" className="rounded-full border-slate-200 bg-slate-50 text-slate-600">
                        {formatNumber(selectedContactOrders.length)}
                      </Badge>
                    </div>

                    {selectedContactOrders.length === 0 ? (
                      <div className="px-4 py-8 text-center text-sm font-medium text-slate-500">
                        Belum ada pesanan untuk nomor ini.
                      </div>
                    ) : (
                      <div className="max-h-[420px] divide-y divide-slate-100 overflow-y-auto dark:divide-slate-800">
                        {selectedContactOrders.map((order) => {
                          const orderDate = getOrderInteractionDate(order);
                          const isExpanded = expandedOrderId === order.id;
                          return (
                            <div
                              key={order.id}
                              className="px-4 py-3 transition-colors hover:bg-slate-50/80 dark:hover:bg-slate-950/40"
                            >
                              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                                <div className="min-w-0">
                                  <div className="flex min-w-0 items-center gap-2">
                                    <span className="break-words text-sm font-bold text-slate-950 dark:text-slate-100">
                                      {getOrderServiceLabel(order, serviceNameById)}
                                    </span>
                                    <Badge variant="outline" className="h-5 shrink-0 rounded-full px-2 text-[10px]">
                                      {order.id}
                                    </Badge>
                                  </div>
                                  <div className="mt-1 text-xs font-medium text-slate-500">
                                    {formatDateWithRelative(orderDate)}
                                  </div>
                                </div>

                                <div className="flex shrink-0 flex-wrap items-center gap-3 sm:justify-end">
                                  <div className="text-sm font-semibold text-slate-700 dark:text-slate-300">
                                    {formatCurrency(getOrderValue(order))}
                                  </div>
                                  <OrderStatusIndicator status={order.status} />
                                  <button
                                    type="button"
                                    className="inline-flex h-8 w-8 items-center justify-center border-0 bg-transparent p-0 text-slate-500 shadow-none outline-none ring-0 hover:text-blue-700 focus-visible:text-blue-700"
                                    onClick={() => setExpandedOrderId(isExpanded ? null : order.id)}
                                    aria-expanded={isExpanded}
                                    aria-label={isExpanded ? `Tutup detail ${order.id}` : `Detail ${order.id}`}
                                  >
                                    <Eye className="h-4 w-4" />
                                  </button>
                                </div>
                              </div>

                              {isExpanded ? (
                                <div className="mt-3 rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-950/50">
                                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                                    <div>
                                      <div className="text-[11px] font-semibold uppercase tracking-normal text-slate-400">
                                        Jadwal
                                      </div>
                                      <div className="mt-1 text-sm font-semibold text-slate-900 dark:text-slate-100">
                                        {formatDateOnly(order.serviceDate || orderDate)}
                                      </div>
                                      <div className="mt-0.5 text-xs font-medium text-slate-500">
                                        {order.serviceTime || '-'}
                                      </div>
                                    </div>

                                    <div>
                                      <div className="text-[11px] font-semibold uppercase tracking-normal text-slate-400">
                                        Teknisi
                                      </div>
                                      <div className="mt-1 text-sm font-semibold text-slate-900 dark:text-slate-100">
                                        {userNameById.get(order.technicianId) || '-'}
                                      </div>
                                      <div className="mt-0.5 text-xs font-medium text-slate-500">
                                        CS: {userNameById.get(order.csId) || '-'}
                                      </div>
                                    </div>

                                    <div>
                                      <div className="text-[11px] font-semibold uppercase tracking-normal text-slate-400">
                                        Pembayaran
                                      </div>
                                      <div className="mt-1 text-sm font-semibold text-slate-900 dark:text-slate-100">
                                        {order.paymentStatus || '-'}
                                      </div>
                                      <div className="mt-0.5 text-xs font-medium text-slate-500">
                                        {order.paymentType || order.paymentMethodId || '-'}
                                      </div>
                                    </div>

                                    <div>
                                      <div className="text-[11px] font-semibold uppercase tracking-normal text-slate-400">
                                        Status
                                      </div>
                                      <OrderStatusIndicator status={order.status} className="mt-1" />
                                    </div>
                                  </div>

                                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                                    <div>
                                      <div className="text-[11px] font-semibold uppercase tracking-normal text-slate-400">
                                        Alamat
                                      </div>
                                      <div className="mt-1 whitespace-pre-wrap break-words text-sm font-medium leading-6 text-slate-700 dark:text-slate-300">
                                        {order.address || '-'}
                                      </div>
                                    </div>

                                    <div>
                                      <div className="text-[11px] font-semibold uppercase tracking-normal text-slate-400">
                                        Catatan Order
                                      </div>
                                      <div className="mt-1 whitespace-pre-wrap break-words text-sm font-medium leading-6 text-slate-700 dark:text-slate-300">
                                        {order.notes || '-'}
                                      </div>
                                    </div>
                                  </div>
                                </div>
                              ) : null}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ) : null}

            <DialogFooter className="shrink-0 border-t border-slate-100 px-6 py-4 dark:border-slate-800">
              {editingContact ? (
                <>
                  <Button
                    type="button"
                    variant="outline"
                    className="h-10 rounded-xl sm:mr-auto"
                    disabled={savingContact}
                    onClick={() => {
                      resetSelectedContactForm();
                      setEditingContact(false);
                    }}
                  >
                    Batal Edit
                  </Button>
                  <Button
                    type="button"
                    className="h-10 rounded-xl bg-blue-600 px-4 text-white hover:bg-blue-700"
                    disabled={savingContact || !selectedContact}
                    onClick={() => void handleSaveContact()}
                  >
                    {savingContact ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <Save className="mr-2 h-4 w-4" />
                    )}
                    Simpan
                  </Button>
                </>
              ) : (
                <>
                  <Button
                    type="button"
                    variant="outline"
                    className="h-10 rounded-xl border-rose-200 text-rose-600 hover:bg-rose-50 sm:mr-auto"
                    disabled={savingContact || !selectedContact}
                    onClick={() => setDeleteContactTarget(selectedContact)}
                  >
                    <Trash2 className="mr-2 h-4 w-4" />
                    Hapus Kontak
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    className="h-10 rounded-xl"
                    onClick={() => {
                      setSelectedContactKey(null);
                      setSelectedContactMode('view');
                    }}
                  >
                    Tutup
                  </Button>
                  <Button
                    type="button"
                    className="h-10 rounded-xl bg-blue-600 px-4 text-white hover:bg-blue-700"
                    disabled={!selectedContact}
                    onClick={() => setEditingContact(true)}
                  >
                    <Pencil className="mr-2 h-4 w-4" />
                    Edit
                  </Button>
                </>
              )}
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <AlertDialog
          open={Boolean(deleteContactTarget)}
          onOpenChange={(open) => {
            if (!open && !savingContact) setDeleteContactTarget(null);
          }}
        >
          <AlertDialogContent className="max-w-md rounded-2xl border-slate-200 bg-white shadow-2xl dark:border-slate-800 dark:bg-slate-900">
            <AlertDialogHeader>
              <AlertDialogTitle className="text-lg font-bold text-slate-950 dark:text-slate-100">
                Hapus Kontak?
              </AlertDialogTitle>
              <AlertDialogDescription className="text-sm font-medium leading-6 text-slate-500 dark:text-slate-400">
                Kontak {deleteContactTarget ? getContactName(deleteContactTarget) : 'ini'} akan dihapus dari database
                kontak. Riwayat pesanan tetap tersimpan.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={savingContact} className="h-10 rounded-xl">
                Batal
              </AlertDialogCancel>
              <AlertDialogAction variant="danger"
                disabled={savingContact || !deleteContactTarget}
                className="h-10 rounded-xl bg-rose-600 px-4 text-white hover:bg-rose-700"
                onClick={(event) => {
                  event.preventDefault();
                  void handleArchiveContact(deleteContactTarget);
                }}
              >
                {savingContact ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Trash2 className="mr-2 h-4 w-4" />}
                Hapus
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </OperationalPageShell>
  );
}
