import React, { useMemo, useRef, useState } from 'react';
import {
  Check,
  Copy,
  Edit,
  MessageSquare,
  Plus,
  Search,
  Tags,
  Trash2,
} from 'lucide-react';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Dialog, DialogDescription, DialogHeader, DialogTitle } from '../components/ui/dialog';
import { Textarea } from '../components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '../components/ui/dropdown-menu';
import { AlertDialog } from '../components/ui/alert-dialog';
import { Tabs, TabsList, TabsTrigger } from '../components/ui/tabs';
import { TableActionMenu, TableActionMenuItem, TableActionMenuTrigger } from '../components/ui/data-table';
import {
  MasterDataConfirmContent,
  MasterDataFieldLabel,
  MasterDataFormActions,
  MasterDataFormDialogContent,
  MasterDataUnsavedChangesDialog,
  useMasterDataFormCloseGuard,
} from '../components/ui/master-data-ui';
import { useMasterData } from '@/app/pages/master-data/context';
import { logActivity } from '@/app/services/auditService';
import { usePermissions } from '@/app/hooks/usePermissions';
import { WATemplate } from '@/app/pages/master-data/data';
import { toast } from 'sonner';
import { copyToClipboard } from '@/lib/clipboard';
import {
  DEFAULT_FOLLOW_UP_DELAY_DAYS,
  PROSPECT_FOLLOW_UP_MAX_STEPS,
  getNextLeadFollowUpStep,
  sortLeadTemplatesForDisplay,
} from './leads/prospectModel';
import { FilterRow } from '@/app/components/ui/control-layout';

type TemplateCategory = NonNullable<WATemplate['category']>;
type TemplateFilter = TemplateCategory | 'all';

const CATEGORY_ORDER: TemplateCategory[] = ['Leads', 'Orders', 'Teknisi', 'General'];

const CATEGORY_META: Record<TemplateCategory, { label: string; shortLabel: string; tone: string }> = {
  Leads: { label: 'Prospek (Leads)', shortLabel: 'Prospek', tone: 'blue' },
  Orders: { label: 'Pesanan (Orders)', shortLabel: 'Pesanan', tone: 'violet' },
  Teknisi: { label: 'Teknisi', shortLabel: 'Teknisi', tone: 'amber' },
  General: { label: 'Umum', shortLabel: 'Umum', tone: 'slate' },
};

const AVAILABLE_VARIABLES = [
  { label: 'Nama Customer', value: '[Nama]' },
  { label: 'ID Order', value: '[Order ID]' },
  { label: 'Tipe Mobil', value: '[Mobil]' },
  { label: 'Alamat Lengkap', value: '[Alamat]' },
  { label: 'Tanggal Service', value: '[Tanggal]' },
  { label: 'Jam Service', value: '[Jam]' },
  { label: 'Jenis Layanan', value: '[Layanan]' },
  { label: 'Total Harga', value: '[Total]' },
];

const normalizeCategory = (category?: WATemplate['category']): TemplateCategory => category || 'General';

const sortTemplatesForDisplay = (left: WATemplate, right: WATemplate) => {
  const leftCategory = normalizeCategory(left.category);
  const rightCategory = normalizeCategory(right.category);

  if (leftCategory === 'Leads' && rightCategory === 'Leads') {
    return sortLeadTemplatesForDisplay(left, right);
  }

  const leftOrder = leftCategory === 'Leads' ? 0 : 100;
  const rightOrder = rightCategory === 'Leads' ? 0 : 100;

  if (leftOrder !== rightOrder) return leftOrder - rightOrder;
  return left.title.localeCompare(right.title, 'id-ID', { sensitivity: 'base' });
};

const createTemplateId = () => {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID().slice(0, 8).toUpperCase();
  }
  return Math.random().toString(36).substring(2, 8).toUpperCase();
};

export const WATemplatesPage = () => {
  const { waTemplates, addWATemplate, updateWATemplate, deleteWATemplate, currentUser } = useMasterData();
  const { hasPermission } = usePermissions();
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<TemplateFilter>('all');
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<Partial<WATemplate>>({});
  const [isFormDirty, setIsFormDirty] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const messageRef = useRef<HTMLTextAreaElement>(null);

  const filteredTemplates = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();

    return waTemplates.filter((template) => {
      const category = normalizeCategory(template.category);
      const matchesCategory = categoryFilter === 'all' || category === categoryFilter;
      const matchesSearch = !normalizedSearch
        || template.title.toLowerCase().includes(normalizedSearch)
        || template.message.toLowerCase().includes(normalizedSearch)
        || template.id.toLowerCase().includes(normalizedSearch);

      return matchesCategory && matchesSearch;
    }).sort(sortTemplatesForDisplay);
  }, [categoryFilter, search, waTemplates]);

  const groupedTemplates = useMemo(() => {
    return CATEGORY_ORDER.reduce<Record<TemplateCategory, WATemplate[]>>((groups, category) => {
      groups[category] = filteredTemplates.filter((template) => normalizeCategory(template.category) === category);
      return groups;
    }, {} as Record<TemplateCategory, WATemplate[]>);
  }, [filteredTemplates]);

  const categoryCounts = useMemo(() => {
    return CATEGORY_ORDER.reduce<Record<TemplateCategory, number>>((counts, category) => {
      counts[category] = waTemplates.filter((template) => normalizeCategory(template.category) === category).length;
      return counts;
    }, {} as Record<TemplateCategory, number>);
  }, [waTemplates]);

  const activeCategorySections = categoryFilter === 'all' ? CATEGORY_ORDER : [categoryFilter];
  const templateToDelete = deleteId ? waTemplates.find((template) => template.id === deleteId) : null;

  const closeFormDialog = React.useCallback(() => {
    setIsFormDirty(false);
    setIsDialogOpen(false);
  }, []);

  const formCloseGuard = useMasterDataFormCloseGuard({
    hasUnsavedChanges: isFormDirty,
    onClose: closeFormDialog,
  });

  const requestDialogOpenChange = (open: boolean) => {
    if (open) {
      setIsDialogOpen(true);
      return;
    }
    formCloseGuard.requestClose();
  };

  const updateForm = (patch: Partial<WATemplate>) => {
    setEditForm((previous) => ({ ...previous, ...patch }));
    setIsFormDirty(true);
  };

  const handleAddNew = () => {
    const category = categoryFilter === 'all' ? 'General' : categoryFilter;
    const nextLeadStep = getNextLeadFollowUpStep(waTemplates);
    const activeLeadStepCount = new Set(
      waTemplates
        .filter((template) => template.category === 'Leads' && template.followUpIsActive !== false)
        .map((template) => Number(template.followUpStep || 0))
        .filter((step) => step >= 1 && step <= PROSPECT_FOLLOW_UP_MAX_STEPS),
    ).size;
    const hasAvailableFollowUpStep = activeLeadStepCount < PROSPECT_FOLLOW_UP_MAX_STEPS;

    setEditingId(null);
    setEditForm({
      category,
      title: '',
      message: '',
      followUpStep: category === 'Leads' ? nextLeadStep : null,
      followUpDelayDays: category === 'Leads'
        ? DEFAULT_FOLLOW_UP_DELAY_DAYS[nextLeadStep - 1] ?? nextLeadStep
        : null,
      followUpIsActive: category === 'Leads' ? hasAvailableFollowUpStep : undefined,
    });
    setIsFormDirty(false);
    setIsDialogOpen(true);
  };

  const handleEdit = (template: WATemplate) => {
    setEditingId(template.id);
    setEditForm({ ...template, category: normalizeCategory(template.category) });
    setIsFormDirty(false);
    setIsDialogOpen(true);
  };

  const confirmDelete = async () => {
    if (!deleteId) return;

    const deletedTemplate = waTemplates.find((template) => template.id === deleteId);

    try {
      await deleteWATemplate(deleteId);

      if (currentUser && deletedTemplate) {
        logActivity(
          { id: currentUser.id, name: currentUser.name, role: currentUser.role },
          'DELETE',
          'Template WhatsApp',
          `Menghapus template WA: ${deletedTemplate.title}`,
          deleteId,
        );
      }

      setDeleteId(null);
    } catch {
      // Error toast is handled by the shared master data mutation helper.
    }
  };

  const handleSave = async (event?: React.FormEvent<HTMLFormElement>) => {
    event?.preventDefault();

    const title = editForm.title?.trim();
    const message = editForm.message?.trim();
    const category = normalizeCategory(editForm.category);
    const followUpStep = category === 'Leads'
      ? Number(editForm.followUpStep || 0) || null
      : null;
    const followUpDelayDays = category === 'Leads'
      ? Math.max(0, Number(editForm.followUpDelayDays ?? DEFAULT_FOLLOW_UP_DELAY_DAYS[(followUpStep || 1) - 1] ?? 0))
      : null;
    const followUpIsActive = category === 'Leads' ? editForm.followUpIsActive !== false : true;

    if (!title || !message) {
      toast.error('Judul dan isi pesan wajib diisi');
      return;
    }

    const categoryCount = waTemplates.filter((template) => normalizeCategory(template.category) === category).length;

    if (editingId) {
      const oldTemplate = waTemplates.find((template) => template.id === editingId);
      if (oldTemplate && normalizeCategory(oldTemplate.category) !== category && categoryCount >= 10) {
        toast.error(`Kategori ${CATEGORY_META[category].label} sudah mencapai batas maksimum 10 template.`);
        return;
      }
    } else if (categoryCount >= 10) {
      toast.error(`Kategori ${CATEGORY_META[category].label} sudah mencapai batas maksimum 10 template.`);
      return;
    }

    if (category === 'Leads' && followUpIsActive && followUpStep) {
      const duplicateStep = waTemplates.some((template) =>
        template.id !== editingId &&
        normalizeCategory(template.category) === 'Leads' &&
        template.followUpIsActive !== false &&
        Number(template.followUpStep || 0) === followUpStep,
      );

      if (duplicateStep) {
        toast.error(`FU ${followUpStep} sudah dipakai template lain. Nonaktifkan salah satu atau pilih step berbeda.`);
        return;
      }
    }

    setIsSubmitting(true);

    try {
      if (editingId) {
        const updatedTemplate: WATemplate = {
          id: editingId,
          title,
          message,
          category,
          usage_count: editForm.usage_count || 0,
          followUpStep,
          followUpDelayDays,
          followUpIsActive,
        };

        await updateWATemplate(updatedTemplate);

        if (currentUser) {
          logActivity(
            { id: currentUser.id, name: currentUser.name, role: currentUser.role },
            'UPDATE',
            'Template WhatsApp',
            `Memperbarui template WA: ${title}`,
            editingId,
          );
        }
      } else {
        const newTemplate: WATemplate = {
          id: createTemplateId(),
          title,
          message,
          category,
          usage_count: 0,
          followUpStep,
          followUpDelayDays,
          followUpIsActive,
        };

        await addWATemplate(newTemplate);

        if (currentUser) {
          logActivity(
            { id: currentUser.id, name: currentUser.name, role: currentUser.role },
            'CREATE',
            'Template WhatsApp',
            `Membuat template WA baru: ${title}`,
            newTemplate.id,
          );
        }
      }

      setIsFormDirty(false);
      setIsDialogOpen(false);
    } catch {
      // Error toast is handled by the shared master data mutation helper.
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleInsertVariable = (variable: string) => {
    const textarea = messageRef.current;
    const text = editForm.message || '';

    if (!textarea) {
      updateForm({ message: `${text}${variable}` });
      return;
    }

    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const newText = text.substring(0, start) + variable + text.substring(end);

    updateForm({ message: newText });

    window.setTimeout(() => {
      textarea.focus();
      textarea.setSelectionRange(start + variable.length, start + variable.length);
    }, 0);
  };

  const handleCopyToClipboard = (text: string) => {
    copyToClipboard(text, { successMessage: 'Pesan disalin ke clipboard' });
  };

  return (
    <main className="opsPageShell waTemplatePage pb-48 md:pb-32">
      <div className="waTemplateInner">
        <section className="topbar waTemplateTopbar">
          <div className="topbarTitle">
            <div className="eyebrowLine">
              <MessageSquare className="h-4 w-4" />
              Sistem & Akses
            </div>
            <h1>Template WhatsApp</h1>
            <p>
              Kelola pesan standar untuk respons cepat pelanggan, order, dan teknisi.
              <span className="waTemplateHeaderCount">
                <MessageSquare className="h-3.5 w-3.5" />
                {filteredTemplates.length} dari {waTemplates.length} template
              </span>
            </p>
          </div>

          <div className="topbarActions">
            {hasPermission('wa_template.create') ? (
              <Button type="button" onClick={handleAddNew} icon={<Plus className="h-4 w-4" />}>
                Buat Template Baru
              </Button>
            ) : null}
          </div>
        </section>

      <section className="controlPanel filterPanel waTemplateFilterPanel">
        <FilterRow className="waTemplateFilterGrid">
          <label className="searchBox waTemplateSearchBox">
            <Search className="h-4 w-4" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Cari judul, isi pesan, atau ID template..."
            />
          </label>

          <Select value={categoryFilter} onValueChange={(value) => setCategoryFilter(value as TemplateFilter)}>
            <SelectTrigger aria-label="Filter kategori template">
              <SelectValue placeholder="Semua Kategori" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Semua Kategori</SelectItem>
              {CATEGORY_ORDER.map((category) => (
                <SelectItem key={category} value={category}>
                  {CATEGORY_META[category].label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FilterRow>
      </section>

      <section className="waTemplateTabsShell">
        <Tabs value={categoryFilter} onValueChange={(value) => setCategoryFilter(value as TemplateFilter)}>
          <TabsList className="waTemplateTabs">
            <TabsTrigger value="all">
              <Tags className="h-4 w-4" />
              Semua
              <span>{waTemplates.length}</span>
            </TabsTrigger>
            {CATEGORY_ORDER.map((category) => (
              <TabsTrigger key={category} value={category}>
                {CATEGORY_META[category].shortLabel}
                <span>{categoryCounts[category]}</span>
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </section>

      <section className="waTemplateContent">
        {filteredTemplates.length === 0 ? (
          <div className="waTemplateEmptyState">
            <span>
              <MessageSquare className="h-7 w-7" />
            </span>
            <strong>Tidak ada template ditemukan</strong>
            <p>Coba ubah pencarian atau kategori, lalu buat template baru jika memang belum tersedia.</p>
          </div>
        ) : (
          activeCategorySections.map((category) => {
            const templates = groupedTemplates[category] || [];
            if (templates.length === 0) return null;

            return (
              <div key={category} className="waTemplateSection">
                <div className="waTemplateSectionHeader">
                  <div className={`waTemplateSectionIcon tone-${CATEGORY_META[category].tone}`}>
                    <MessageSquare className="h-4 w-4" />
                  </div>
                  <div>
                    <h2>{CATEGORY_META[category].label}</h2>
                    <p>{templates.length} template aktif dalam kategori ini</p>
                  </div>
                </div>

                <div className="waTemplateGrid">
                  {templates.map((template) => (
                    <article key={template.id} className="waTemplateCard">
                      <div className="waTemplateCardHeader">
                        <div className="waTemplateCardTitle">
                          <span className={`waTemplateCardIcon tone-${CATEGORY_META[normalizeCategory(template.category)].tone}`}>
                            <MessageSquare className="h-4 w-4" />
                          </span>
                          <div>
                            <h3>{template.title}</h3>
                            <p>ID: {template.id}</p>
                          </div>
                        </div>

                        <TableActionMenu trigger={<TableActionMenuTrigger aria-label={`Aksi ${template.title}`} />}>
                          <TableActionMenuItem icon={Copy} onClick={() => handleCopyToClipboard(template.message)}>
                            Salin Pesan
                          </TableActionMenuItem>
                          {hasPermission('wa_template.edit') ? (
                            <TableActionMenuItem icon={Edit} onClick={() => handleEdit(template)}>
                              Edit
                            </TableActionMenuItem>
                          ) : null}
                          {hasPermission('wa_template.delete') ? (
                            <TableActionMenuItem danger icon={Trash2} onClick={() => setDeleteId(template.id)}>
                              Hapus
                            </TableActionMenuItem>
                          ) : null}
                        </TableActionMenu>
                      </div>

                      <div className="waTemplateMessageBubble">
                        <p>{template.message}</p>
                      </div>

                      <div className="waTemplateCardFooter">
                        <span className="waTemplateCategoryPill">{CATEGORY_META[normalizeCategory(template.category)].shortLabel}</span>
                        {normalizeCategory(template.category) === 'Leads' ? (
                          <span className="waTemplateUsagePill">
                            FU {template.followUpStep || '-'} • H+{template.followUpDelayDays ?? 0}
                            {template.followUpIsActive === false ? ' • nonaktif' : ''}
                          </span>
                        ) : null}
                        <span className="waTemplateUsagePill">
                          <Check className="h-3.5 w-3.5" />
                          {template.usage_count || 0}x dipakai
                        </span>
                      </div>
                    </article>
                  ))}
                </div>
              </div>
            );
          })
        )}
      </section>

      <Dialog open={isDialogOpen} onOpenChange={requestDialogOpenChange}>
        <MasterDataFormDialogContent size="wide">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <MessageSquare className="h-5 w-5 text-blue-600" />
              {editingId ? 'Edit Template WhatsApp' : 'Buat Template WhatsApp'}
            </DialogTitle>
            <DialogDescription>
              Simpan template respons cepat untuk digunakan di prospek, pesanan, dan teknisi.
            </DialogDescription>
          </DialogHeader>

          <form className="masterDataForm" onSubmit={handleSave}>
            <div className="masterDataFormGrid">
              <div className="space-y-2">
                <MasterDataFieldLabel required>Judul Template</MasterDataFieldLabel>
                <Input
                  value={editForm.title || ''}
                  onChange={(event) => updateForm({ title: event.target.value })}
                  placeholder="Contoh: Follow Up Penawaran"
                />
              </div>

              <div className="space-y-2">
                <MasterDataFieldLabel required>Kategori</MasterDataFieldLabel>
                <Select
                  value={normalizeCategory(editForm.category)}
                  onValueChange={(value) => {
                    const category = value as TemplateCategory;
                    const nextLeadStep = getNextLeadFollowUpStep(waTemplates);
                    updateForm({
                      category,
                      followUpStep: category === 'Leads' ? (editForm.followUpStep || nextLeadStep) : null,
                      followUpDelayDays: category === 'Leads'
                        ? editForm.followUpDelayDays ?? DEFAULT_FOLLOW_UP_DELAY_DAYS[nextLeadStep - 1] ?? 0
                        : null,
                      followUpIsActive: category === 'Leads' ? editForm.followUpIsActive !== false : true,
                    });
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Pilih kategori" />
                  </SelectTrigger>
                  <SelectContent>
                    {CATEGORY_ORDER.map((category) => (
                      <SelectItem key={category} value={category}>
                        {CATEGORY_META[category].label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {normalizeCategory(editForm.category) === 'Leads' ? (
              <div className="masterDataFormGrid">
                <div className="space-y-2">
                  <MasterDataFieldLabel
                    info={{
                      title: 'Urutan follow up',
                      description: 'Step ini dipakai Prospek untuk menentukan template FU berikutnya.',
                    }}
                  >
                    FU ke-
                  </MasterDataFieldLabel>
                  <Select
                    value={String(editForm.followUpStep || 1)}
                    onValueChange={(value) => updateForm({ followUpStep: Number(value) })}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Pilih step FU" />
                    </SelectTrigger>
                    <SelectContent>
                      {Array.from({ length: PROSPECT_FOLLOW_UP_MAX_STEPS }, (_, index) => index + 1).map((step) => (
                        <SelectItem key={step} value={String(step)}>
                          FU {step}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <MasterDataFieldLabel>Jeda Hari</MasterDataFieldLabel>
                  <Input
                    type="number"
                    min={0}
                    value={editForm.followUpDelayDays ?? 0}
                    onChange={(event) => updateForm({ followUpDelayDays: Math.max(0, Number(event.target.value || 0)) })}
                    placeholder="Contoh: 3"
                  />
                </div>

                <div className="space-y-2">
                  <MasterDataFieldLabel>Status Plan FU</MasterDataFieldLabel>
                  <Select
                    value={editForm.followUpIsActive === false ? 'inactive' : 'active'}
                    onValueChange={(value) => updateForm({ followUpIsActive: value === 'active' })}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Status" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="active">Aktif</SelectItem>
                      <SelectItem value="inactive">Nonaktif</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            ) : null}

            <div className="space-y-2">
              <div className="waTemplateMessageLabelRow">
                <MasterDataFieldLabel
                  required
                  info={{
                    title: 'Variabel template',
                    description: 'Variabel seperti [Nama], [Mobil], dan [Order ID] akan diganti oleh data customer atau order saat template dipakai.',
                  }}
                >
                  Isi Pesan
                </MasterDataFieldLabel>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button type="button" variant="outline" size="sm" icon={<Plus className="h-3.5 w-3.5" />}>
                      Sisipkan Variabel
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="waTemplateVariableMenu">
                    {AVAILABLE_VARIABLES.map((variable) => (
                      <DropdownMenuItem key={variable.value} onClick={() => handleInsertVariable(variable.value)}>
                        <span>{variable.label}</span>
                        <code>{variable.value}</code>
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>

              <Textarea
                ref={messageRef}
                value={editForm.message || ''}
                onChange={(event) => updateForm({ message: event.target.value })}
                placeholder="Halo Kak [Nama], ..."
                className="waTemplateTextarea"
              />
            </div>

            <MasterDataFormActions
              onCancel={formCloseGuard.requestClose}
              isSubmitting={isSubmitting}
              saveLabel={isSubmitting ? 'Menyimpan...' : 'Simpan Template'}
              submitDisabled={isSubmitting}
            />
          </form>
        </MasterDataFormDialogContent>

        <MasterDataUnsavedChangesDialog
          open={formCloseGuard.isConfirmOpen}
          onCancel={formCloseGuard.cancelClose}
          onConfirm={formCloseGuard.confirmClose}
        />
      </Dialog>

      <AlertDialog open={!!deleteId} onOpenChange={(open) => {
        if (!open) setDeleteId(null);
      }}>
        <MasterDataConfirmContent title="Hapus template ini?" onConfirm={confirmDelete} actionLabel="Hapus Template">
          Template <strong>{templateToDelete?.title || '-'}</strong> akan dihapus dan tidak bisa dikembalikan.
        </MasterDataConfirmContent>
      </AlertDialog>
      </div>
    </main>
  );
};
