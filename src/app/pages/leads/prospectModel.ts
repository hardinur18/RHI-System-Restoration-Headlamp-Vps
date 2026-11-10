import { format } from 'date-fns';
import type { Lead, LeadStatus, ProspectBooking, WATemplate } from '../master-data/data';

export const AUTO_WHATSAPP_LEAD_ORIGIN = 'auto_wa_api';
export const ALL_FILTER = 'all';
export const LEAD_PAGE_SIZE_OPTIONS = [50, 100, 300, 500] as const;
export const MANDATORY_PLATFORM_NAMES = ['repeat order', 'organik'];
export const EDITABLE_LEAD_STATUS_OPTIONS: LeadStatus[] = ['Pending', 'Follow Up', 'Booking', 'Cancel'];
export const PROSPECT_FOLLOW_UP_MAX_STEPS = 6;
export const DEFAULT_FOLLOW_UP_DELAY_DAYS = [0, 1, 3, 7, 14, 21] as const;
export type ProspectFollowUpFilter = 'all' | 'due_today' | 'overdue' | 'upcoming' | 'completed' | 'unscheduled';

const ACTIVE_FOLLOW_UP_STATUSES = new Set<LeadStatus>(['Pending', 'Follow Up']);

export const normalizeLeadLabels = (labels?: string[] | string | null) => {
  const rawLabels = Array.isArray(labels)
    ? labels
    : String(labels || '')
      .split(/[,\n]/g);

  const seen = new Set<string>();
  const normalized: string[] = [];

  rawLabels.forEach((label) => {
    const value = String(label || '').trim().replace(/\s+/g, ' ');
    if (!value) return;

    const key = value.toLowerCase();
    if (seen.has(key)) return;

    seen.add(key);
    normalized.push(value);
  });

  return normalized.slice(0, 12);
};

export const normalizeLeadLabelKey = (label?: string | null) =>
  String(label || '').trim().replace(/\s+/g, ' ').toLowerCase();

export const toLocalDateKey = (date: Date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

export const uniqueById = <T extends { id: string }>(items: T[]) =>
  Array.from(new Map(items.map((item) => [item.id, item])).values());

export const isAutoWhatsAppLead = (lead: Pick<Lead, 'origin' | 'lastContact' | 'notes'>) => (
  lead.origin === AUTO_WHATSAPP_LEAD_ORIGIN ||
  lead.lastContact === 'Auto WA API' ||
  Boolean(lead.notes?.toLowerCase().includes('auto wa api'))
);

const sortBookingsByLatestUpdate = (bookings: ProspectBooking[]) =>
  [...bookings].sort((left, right) => {
    const leftTime = new Date(left.updatedAt || left.createdAt || 0).getTime();
    const rightTime = new Date(right.updatedAt || right.createdAt || 0).getTime();
    return rightTime - leftTime;
  });

export const buildLatestBookingByLeadId = (bookings: ProspectBooking[]) => {
  const map = new Map<string, ProspectBooking>();
  sortBookingsByLatestUpdate(bookings).forEach((booking) => {
    if (!map.has(booking.leadId)) {
      map.set(booking.leadId, booking);
    }
  });
  return map;
};

export const buildActiveBookingByLeadId = (bookings: ProspectBooking[]) => {
  const map = new Map<string, ProspectBooking>();
  sortBookingsByLatestUpdate(bookings).forEach((booking) => {
    const isActive = booking.status !== 'cancelled' && !booking.orderId;
    if (isActive && !map.has(booking.leadId)) {
      map.set(booking.leadId, booking);
    }
  });
  return map;
};

export const getProspectBookingSummary = (booking?: ProspectBooking | null) => {
  if (!booking?.scheduleDate || !booking?.scheduleTime) return null;
  return `${format(new Date(booking.scheduleDate), 'dd MMM yyyy')} - ${booking.scheduleTime}`;
};

export const formatProspectBookingDate = (booking?: ProspectBooking | null) => {
  if (!booking?.scheduleDate) return '-';
  return format(new Date(booking.scheduleDate), 'dd MMM yyyy');
};

export const getProspectBookingStatusLabel = (booking?: ProspectBooking | null) => {
  switch (booking?.status) {
    case 'confirmed':
      return 'Confirmed';
    case 'reschedule':
      return 'Reschedule';
    case 'cancelled':
      return 'Cancelled';
    case 'tentative':
    default:
      return 'Tentative';
  }
};

export const getProspectStatusBadgeClass = (status: LeadStatus) => {
  switch (status) {
    case 'Pending': return 'bg-yellow-50 text-yellow-700 border-yellow-200';
    case 'Follow Up': return 'bg-blue-50 text-blue-700 border-blue-200';
    case 'Booking': return 'bg-violet-50 text-violet-700 border-violet-200';
    case 'Closing': return 'bg-emerald-50 text-emerald-700 border-emerald-200';
    case 'Cancel': return 'bg-red-50 text-red-700 border-red-200';
    default: return 'bg-slate-100 text-slate-700 border-slate-200';
  }
};

export const normalizeLeadNotes = (notes?: string) => notes?.replace(/\s+/g, ' ').trim() || '';

export const getLeadNotesPreview = (notes?: string, maxLength = 96) => {
  const normalizedNotes = normalizeLeadNotes(notes);
  if (!normalizedNotes) return '-';
  if (normalizedNotes.length <= maxLength) return normalizedNotes;
  return `${normalizedNotes.slice(0, maxLength).trimEnd()}...`;
};

const LEAD_TEMPLATE_TITLE_ORDER = [
  'salam pertama',
  'sapaan awal',
  'follow up penawaran',
  'upsell',
  'upsel',
];

const getLeadTemplateOrder = (template: WATemplate) => {
  if (typeof template.followUpStep === 'number' && Number.isFinite(template.followUpStep) && template.followUpStep > 0) {
    return template.followUpStep;
  }

  const title = template.title.trim().toLowerCase();
  const index = LEAD_TEMPLATE_TITLE_ORDER.findIndex((keyword) => title.includes(keyword));
  return index === -1 ? 90 : index;
};

export const sortLeadTemplatesForDisplay = (left: WATemplate, right: WATemplate) => {
  const leftOrder = getLeadTemplateOrder(left);
  const rightOrder = getLeadTemplateOrder(right);

  if (leftOrder !== rightOrder) return leftOrder - rightOrder;
  return left.title.localeCompare(right.title, 'id-ID', { sensitivity: 'base' });
};

export const buildLeadFollowUpTemplates = (templates: WATemplate[]) =>
  templates
    .filter((template) => template.category === 'Leads' && template.followUpIsActive !== false)
    .sort(sortLeadTemplatesForDisplay)
    .slice(0, PROSPECT_FOLLOW_UP_MAX_STEPS);

export const getNextLeadFollowUpStep = (templates: WATemplate[]) => {
  const usedSteps = new Set(
    templates
      .filter((template) => template.category === 'Leads' && template.followUpIsActive !== false)
      .map((template) => Number(template.followUpStep || 0))
      .filter((step) => step >= 1 && step <= PROSPECT_FOLLOW_UP_MAX_STEPS),
  );

  for (let step = 1; step <= PROSPECT_FOLLOW_UP_MAX_STEPS; step += 1) {
    if (!usedSteps.has(step)) return step;
  }

  return PROSPECT_FOLLOW_UP_MAX_STEPS;
};

const addDays = (date: Date, days: number) => {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
};

const startOfLocalDay = (date: Date) => {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  return next;
};

export const getTemplateUsageCount = (lead: Pick<Lead, 'templateHistory'>, templateId: string) => (
  lead.templateHistory?.filter((history) => history.templateId === templateId).length || 0
);

export const getLatestTemplateHistory = (lead: Pick<Lead, 'templateHistory'>, templateId: string) => (
  [...(lead.templateHistory || [])]
    .filter((history) => history.templateId === templateId)
    .sort((left, right) => new Date(right.sentAt).getTime() - new Date(left.sentAt).getTime())[0]
);

export const buildProspectFollowUpPlan = (
  lead: Lead,
  templates: WATemplate[],
  today = new Date(),
) => {
  const plannedTemplates = buildLeadFollowUpTemplates(templates);
  const completedCount = plannedTemplates.filter((template) => getTemplateUsageCount(lead, template.id) > 0).length;
  const nextIndex = plannedTemplates.findIndex((template) => getTemplateUsageCount(lead, template.id) === 0);
  const isActiveLead = ACTIVE_FOLLOW_UP_STATUSES.has(lead.status);
  const totalSteps = plannedTemplates.length;
  const todayStart = startOfLocalDay(today);
  const nextTemplate = plannedTemplates[nextIndex];

  if (!isActiveLead || !nextTemplate) {
    return {
      completedCount,
      totalSteps,
      nextStep: null as number | null,
      nextTemplate: null as WATemplate | null,
      dueDate: null as Date | null,
      dueDateKey: null as string | null,
      status: (totalSteps === 0 ? 'unscheduled' : 'completed') as ProspectFollowUpFilter,
      isDueToday: false,
      isOverdue: false,
      isUpcoming: false,
      isCompleted: totalSteps > 0 && nextIndex === -1,
    };
  }

  const delayDays = Math.max(0, Number(nextTemplate.followUpDelayDays ?? DEFAULT_FOLLOW_UP_DELAY_DAYS[nextIndex] ?? nextIndex) || 0);
  const previousTemplate = nextIndex > 0 ? plannedTemplates[nextIndex - 1] : null;
  const previousHistory = previousTemplate ? getLatestTemplateHistory(lead, previousTemplate.id) : null;
  const baseDate = previousHistory?.sentAt ? new Date(previousHistory.sentAt) : new Date(lead.timestamp);
  const dueDate = startOfLocalDay(addDays(baseDate, delayDays));
  const dueTime = dueDate.getTime();
  const todayTime = todayStart.getTime();
  const isOverdue = dueTime < todayTime;
  const isDueToday = dueTime === todayTime;
  const isUpcoming = dueTime > todayTime;

  return {
    completedCount,
    totalSteps,
    nextStep: nextIndex + 1,
    nextTemplate,
    dueDate,
    dueDateKey: toLocalDateKey(dueDate),
    status: (isOverdue ? 'overdue' : isDueToday ? 'due_today' : 'upcoming') as ProspectFollowUpFilter,
    isDueToday,
    isOverdue,
    isUpcoming,
    isCompleted: false,
  };
};

export const formatProspectFollowUpDueDate = (date?: Date | null) => {
  if (!date) return '-';
  return format(date, 'dd MMM yyyy');
};
