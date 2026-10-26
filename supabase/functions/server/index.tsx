import { Hono } from "npm:hono";
import { cors } from "npm:hono/cors";
import { logger } from "npm:hono/logger";
import { createClient } from "npm:@supabase/supabase-js@2";
import * as kv from "./kv_store.tsx";
import permissionsRoute from "./permissions.tsx";
import payrollRoute from "./payroll.tsx";
import telegramRoute from "./telegram.tsx";
import metaMessagingRoute from "./meta_messaging.tsx";
import googleAdsRoute, { syncGoogleAdsSnapshotRange } from "./google_ads.tsx";
import tiktokAdsRoute, { syncTikTokSnapshotRange } from "./tiktok_ads.tsx";
import {
  getRequesterAccessContext,
  hasEffectivePermission,
  isOwnerRole,
} from "./requester_access.ts";
import type { PermissionKey } from "../../../src/app/data/permissions.ts";
import {
  fetchAdsDailySnapshots,
  fetchLatestAdsDailySnapshotsBeforeOrOn,
  getLatestAdsSnapshotSyncAt,
  loadInternalAdAccounts,
  upsertAdsDailySnapshots,
  type AdsDailySnapshotRecord,
} from "./ads_snapshot_store.tsx";
import {
  clampNumber,
  diffInDaysInclusive,
  getMaxTimestamp,
  isSyncFresh,
  listDateChunks,
  parseBooleanFlag,
} from "./ads_snapshot_utils.tsx";
import {
  ADS_MANAGE_PERMISSION,
  ADS_REFERENCE_READ_PERMISSIONS,
  CS_OKR_MANAGE_PERMISSION,
  CS_OKR_VIEW_PERMISSION,
  DAILY_REPORT_CREATE_PERMISSION,
  DAILY_REPORT_DELETE_PERMISSION,
  DAILY_REPORT_EDIT_PERMISSION,
  DAILY_REPORT_VIEW_PERMISSION,
  MAP_EXPAND_URL_PERMISSIONS,
  MARKETING_MONITORING_VIEW_PERMISSION,
  MASTER_DATA_CREATE_PERMISSION,
  MASTER_DATA_DELETE_PERMISSION,
  MASTER_DATA_EDIT_PERMISSION,
  MASTER_DATA_VIEW_PERMISSION,
  OPERATIONAL_EXPENSE_CREATE_PERMISSION,
  OPERATIONAL_EXPENSE_DELETE_PERMISSION,
  OPERATIONAL_EXPENSE_EDIT_PERMISSION,
  OPERATIONAL_EXPENSE_VIEW_PERMISSION,
  RECURRING_EXPENSE_PAY_PERMISSION,
  RECURRING_EXPENSE_VIEW_PERMISSION,
} from "./app_data_access.ts";
import { registerAppDataRoutes } from "./app_data_routes.tsx";
import {
  findLeadDuplicates,
  formatLeadDuplicateWarning,
  getLeadDuplicateCsId,
  normalizeLeadComparablePhone,
} from "../../../utils/leadDuplicate.ts";

const app = new Hono();
const CS_ASSIGNMENT_STATUSES = new Set(["available", "busy", "offline"]);
const DEFAULT_ALLOWED_CORS_ORIGINS = [
  "https://polesheadlamp.id",
  "https://www.polesheadlamp.id",
  "https://polesheadlamp-id.pages.dev",
  "http://localhost:5173",
  "http://localhost:5174",
  "http://localhost:5175",
  "http://localhost:4173",
  "http://127.0.0.1:5173",
  "http://127.0.0.1:5174",
  "http://127.0.0.1:5175",
  "http://127.0.0.1:4173",
];

const normalizeOrigin = (origin: string) => origin.trim().replace(/\/+$/, "");

const configuredAllowedCorsOrigins = (Deno.env.get("APP_ALLOWED_ORIGINS") || Deno.env.get("CORS_ALLOWED_ORIGINS") || "")
  .split(",")
  .map(normalizeOrigin)
  .filter(Boolean);

const allowedCorsOrigins = new Set([
  ...DEFAULT_ALLOWED_CORS_ORIGINS,
  ...configuredAllowedCorsOrigins,
]);

const resolveCorsOrigin = (origin: string) => {
  const normalizedOrigin = normalizeOrigin(origin || "");
  return allowedCorsOrigins.has(normalizedOrigin) ? normalizedOrigin : "";
};

const normalizeCsAssignmentStatusValue = (value: unknown) => {
  if (typeof value !== "string") return "available";
  const normalized = value.trim().toLowerCase();
  return CS_ASSIGNMENT_STATUSES.has(normalized) ? normalized : "available";
};

const normalizeCsMaxActiveChatsValue = (value: unknown) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) return 25;
  return Math.min(Math.trunc(numeric), 500);
};

// Enable logger
app.use('*', logger(console.log));

// Enable CORS for all routes and methods
app.use(
  "/*",
  cors({
    origin: resolveCorsOrigin,
    allowHeaders: ["Content-Type", "Authorization", "x-client-token", "X-Client-Token", "x-service-role-key", "x-scheduler-secret"],
    allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    exposeHeaders: ["Content-Length"],
    maxAge: 600,
  }),
);

app.use("/*", async (c, next) => {
  await next();
  c.header("X-Content-Type-Options", "nosniff");
  c.header("Referrer-Policy", "strict-origin-when-cross-origin");
  c.header("Permissions-Policy", "camera=(), microphone=(), payment=(), usb=()");
});

app.route("/make-server-f781cd00/permissions", permissionsRoute);
app.route("/make-server-f781cd00/payroll", payrollRoute);
app.route("/make-server-f781cd00/telegram", telegramRoute);
app.route("/make-server-f781cd00/meta/messaging", metaMessagingRoute);
app.route("/make-server-f781cd00/google", googleAdsRoute);
app.route("/make-server-f781cd00/tiktok", tiktokAdsRoute);

app.get("/make-server-f781cd00/finance/operational-expense-categories", async (c) => {
  const url = new URL(c.req.url);
  const includeInactive = parseBooleanFlag(url.searchParams.get("includeInactive") || url.searchParams.get("include_inactive"));
  const access = includeInactive
    ? await requireOperationalExpensePermission(c, MASTER_DATA_VIEW_PERMISSION, "Anda tidak memiliki akses ke master kategori biaya operasional.")
    : await requireAnyOperationalExpensePermission(c, [OPERATIONAL_EXPENSE_VIEW_PERMISSION, MASTER_DATA_VIEW_PERMISSION]);
  if (access.error) return access.error;

  let query = supabase
    .from("operational_expense_categories")
    .select("id, category, subcategory, account_code, account_type, description, sort_order, is_active, finance_category_id, finance_account_id")
    .order("sort_order", { ascending: true })
    .order("category", { ascending: true })
    .order("subcategory", { ascending: true });

  if (!includeInactive) query = query.eq("is_active", true);
  const accountType = normalizeOperationalExpenseText(url.searchParams.get("accountType") || url.searchParams.get("account_type"));
  if (accountType && accountType !== "all") query = query.eq("account_type", accountType);

  const { data, error } = await query;

  if (error) {
    console.error("Error fetching operational expense categories:", error);
    return c.json({ error: error.message }, 500);
  }

  return c.json(data || []);
});

app.post("/make-server-f781cd00/finance/operational-expense-categories", async (c) => {
  const access = await requireOperationalExpensePermission(c, MASTER_DATA_CREATE_PERMISSION, "Anda tidak memiliki akses tambah master kategori biaya operasional.");
  if (access.error) return access.error;

  try {
    const body = await c.req.json();
    const payload = buildOperationalExpenseCategoryPayload(body);

    const { data, error } = await supabase
      .from("operational_expense_categories")
      .upsert(payload, { onConflict: "category,subcategory" })
      .select("id, category, subcategory, account_code, account_type, description, sort_order, is_active, finance_category_id, finance_account_id")
      .single();

    if (error) throw error;
    return c.json({ data }, 201);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Gagal menyimpan kategori biaya operasional";
    console.error("Error creating operational expense category:", error);
    return c.json({ error: message }, 400);
  }
});

app.put("/make-server-f781cd00/finance/operational-expense-categories/:id", async (c) => {
  const access = await requireOperationalExpensePermission(c, MASTER_DATA_EDIT_PERMISSION, "Anda tidak memiliki akses edit master kategori biaya operasional.");
  if (access.error) return access.error;

  try {
    const id = normalizeOperationalExpenseText(c.req.param("id"));
    if (!id) return c.json({ error: "ID kategori biaya operasional wajib diisi" }, 400);

    const body = await c.req.json();
    const payload = buildOperationalExpenseCategoryPayload(body);

    const { data, error } = await supabase
      .from("operational_expense_categories")
      .update(payload)
      .eq("id", id)
      .select("id, category, subcategory, account_code, account_type, description, sort_order, is_active, finance_category_id, finance_account_id")
      .single();

    if (error) throw error;
    return c.json({ data });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Gagal memperbarui kategori biaya operasional";
    console.error("Error updating operational expense category:", error);
    return c.json({ error: message }, 400);
  }
});

app.delete("/make-server-f781cd00/finance/operational-expense-categories/:id", async (c) => {
  const access = await requireOperationalExpensePermission(c, MASTER_DATA_DELETE_PERMISSION, "Anda tidak memiliki akses hapus master kategori biaya operasional.");
  if (access.error) return access.error;

  try {
    const id = normalizeOperationalExpenseText(c.req.param("id"));
    if (!id) return c.json({ error: "ID kategori biaya operasional wajib diisi" }, 400);

    const { data, error } = await supabase
      .from("operational_expense_categories")
      .update({ is_active: false })
      .eq("id", id)
      .select("id, category, subcategory, account_code, account_type, description, sort_order, is_active, finance_category_id, finance_account_id")
      .single();

    if (error) throw error;
    return c.json({ data });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Gagal menonaktifkan kategori biaya operasional";
    console.error("Error deleting operational expense category:", error);
    return c.json({ error: message }, 400);
  }
});

app.get("/make-server-f781cd00/finance/recurring-expense-payments", async (c) => {
  const auth = await requireAuthorizedRequester(c, [
    RECURRING_EXPENSE_VIEW_PERMISSION,
    RECURRING_EXPENSE_PAY_PERMISSION,
  ]);
  if (auth.response) return auth.response;

  const url = new URL(c.req.url);
  const periodKey = normalizeOperationalExpenseText(url.searchParams.get("periodKey") || url.searchParams.get("period_key"));
  const recurringExpenseId = normalizeOperationalExpenseText(
    url.searchParams.get("recurringExpenseId") || url.searchParams.get("recurring_expense_id"),
  );
  const status = normalizeOperationalExpenseText(url.searchParams.get("status"));
  const requestedLimit = Number(url.searchParams.get("limit") || 500);
  const limit = Number.isFinite(requestedLimit)
    ? Math.min(Math.max(Math.trunc(requestedLimit), 1), 1000)
    : 500;

  let query = supabase
    .from("recurring_expense_payments")
    .select("*")
    .order("paid_at", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(limit);

  if (periodKey) query = query.eq("period_key", periodKey);
  if (recurringExpenseId) query = query.eq("recurring_expense_id", recurringExpenseId);
  if (status) query = query.eq("status", status);

  const { data, error } = await query;
  if (error) {
    console.error("Error fetching recurring expense payments:", error);
    return c.json({ error: error.message }, 500);
  }

  return c.json({ data: data || [] });
});

app.post("/make-server-f781cd00/finance/recurring-expenses/pay", async (c) => {
  const auth = await requireAuthorizedRequester(c, [
    RECURRING_EXPENSE_PAY_PERMISSION,
    OPERATIONAL_EXPENSE_CREATE_PERMISSION,
  ], "all");
  if (auth.response) return auth.response;

  try {
    const body = await c.req.json();
    const amount = Number(body.p_amount ?? body.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      return c.json({ error: "Nominal pembayaran wajib lebih dari 0." }, 400);
    }

    const params = {
      p_recurring_expense_id: normalizeOperationalExpenseText(body.p_recurring_expense_id || body.recurring_expense_id),
      p_period_key: normalizeOperationalExpenseText(body.p_period_key || body.period_key),
      p_due_date: normalizeOperationalExpenseText(body.p_due_date || body.due_date),
      p_paid_at: normalizeOperationalExpenseText(body.p_paid_at || body.paid_at),
      p_amount: amount,
      p_payment_source: normalizeOperationalExpenseText(body.p_payment_source || body.payment_source),
      p_operational_category: normalizeOperationalExpenseText(body.p_operational_category || body.operational_category),
      p_operational_subcategory: normalizeOperationalExpenseText(body.p_operational_subcategory || body.operational_subcategory),
      p_vendor_name: normalizeOperationalExpenseText(body.p_vendor_name || body.vendor_name),
      p_description: normalizeOperationalExpenseText(body.p_description || body.description),
      p_branch_id: normalizeOperationalExpenseText(body.p_branch_id || body.branch_id),
      p_notes: normalizeOperationalExpenseText(body.p_notes || body.notes),
      p_proof_url: normalizeOperationalExpenseText(body.p_proof_url || body.proof_url),
      p_paid_by: auth.requester?.authUser.id || normalizeOperationalExpenseText(body.p_paid_by || body.paid_by),
      p_paid_by_name: auth.requester?.actorName || normalizeOperationalExpenseText(body.p_paid_by_name || body.paid_by_name || "System"),
    };

    if (!params.p_recurring_expense_id) return c.json({ error: "ID pengeluaran rutin wajib diisi." }, 400);
    if (!/^\d{4}-\d{2}$/.test(params.p_period_key)) return c.json({ error: "Periode pembayaran tidak valid." }, 400);
    if (!isOperationalExpenseDate(params.p_due_date)) return c.json({ error: "Tanggal jatuh tempo tidak valid." }, 400);
    if (!isOperationalExpenseDate(params.p_paid_at)) return c.json({ error: "Tanggal bayar tidak valid." }, 400);
    if (!params.p_operational_category) return c.json({ error: "Kategori biaya operasional wajib diisi." }, 400);
    if (!params.p_operational_subcategory) return c.json({ error: "Subkategori biaya operasional wajib diisi." }, 400);

    const { data, error } = await supabase.rpc("pay_recurring_expense", params);
    if (error) throw error;

    return c.json({ data: data || [] });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Gagal mencatat pembayaran rutin";
    console.error("Error paying recurring expense:", error);
    return c.json({ error: message }, 400);
  }
});

app.get("/make-server-f781cd00/finance/operational-expenses", async (c) => {
  const access = await requireOperationalExpensePermission(c, OPERATIONAL_EXPENSE_VIEW_PERMISSION);
  if (access.error) return access.error;

  const url = new URL(c.req.url);
  const page = Math.max(Number(url.searchParams.get("page") || "1"), 1);
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit") || "25"), 1), 200);
  const offset = (page - 1) * limit;

  let query = supabase
    .from("operational_expense_ledger")
    .select("*", { count: "exact" });

  query = applyOperationalExpenseFilters(query, url.searchParams);

  const { data, error, count } = await query
    .order("expense_date", { ascending: false })
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) {
    console.error("Error fetching operational expenses:", error);
    return c.json({ error: error.message }, 500);
  }

  const total = count || 0;
  return c.json({
    data: data || [],
    meta: {
      page,
      limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    },
  });
});

app.get("/make-server-f781cd00/finance/operational-expenses/summary", async (c) => {
  const access = await requireOperationalExpensePermission(c, OPERATIONAL_EXPENSE_VIEW_PERMISSION);
  if (access.error) return access.error;

  const url = new URL(c.req.url);
  let query = supabase
    .from("operational_expense_ledger")
    .select("id, amount, category, subcategory, status");

  query = applyOperationalExpenseFilters(query, url.searchParams);

  const { data, error } = await query;
  if (error) {
    console.error("Error fetching operational expense summary:", error);
    return c.json({ error: error.message }, 500);
  }

  const rows = data || [];
  const totalAmount = rows.reduce((sum, row) => sum + parseOperationalExpenseAmount(row.amount), 0);
  const categoryCount = new Set(rows.map((row) => normalizeOperationalExpenseText(row.category)).filter(Boolean)).size;
  const subcategoryCount = new Set(rows.map((row) => normalizeOperationalExpenseText(row.subcategory)).filter(Boolean)).size;

  return c.json({
    totalAmount,
    transactionCount: rows.length,
    averageAmount: rows.length > 0 ? totalAmount / rows.length : 0,
    categoryCount,
    subcategoryCount,
  });
});

app.post("/make-server-f781cd00/finance/operational-expenses", async (c) => {
  const access = await requireOperationalExpensePermission(c, OPERATIONAL_EXPENSE_CREATE_PERMISSION);
  if (access.error) return access.error;

  try {
    const body = await c.req.json();
    const payload = await buildOperationalExpensePayload(body);

    const { data, error } = await supabase
      .from("operational_expense_ledger")
      .insert({
        ...payload,
        status: "active",
        created_by: access.requester?.authUser.id,
        created_by_name: access.requester?.actorName || "System",
        updated_by: access.requester?.authUser.id,
        updated_by_name: access.requester?.actorName || "System",
      })
      .select()
      .single();

    if (error) throw error;
    return c.json({ data }, 201);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Gagal menyimpan biaya operasional";
    console.error("Error creating operational expense:", error);
    return c.json({ error: message }, 400);
  }
});

app.put("/make-server-f781cd00/finance/operational-expenses/:id", async (c) => {
  const access = await requireOperationalExpensePermission(c, OPERATIONAL_EXPENSE_EDIT_PERMISSION);
  if (access.error) return access.error;

  try {
    const id = normalizeOperationalExpenseText(c.req.param("id"));
    if (!id) return c.json({ error: "ID biaya operasional wajib diisi" }, 400);

    const body = await c.req.json();
    const payload = await buildOperationalExpensePayload(body);

    const { data, error } = await supabase
      .from("operational_expense_ledger")
      .update({
        ...payload,
        updated_by: access.requester?.authUser.id,
        updated_by_name: access.requester?.actorName || "System",
      })
      .eq("id", id)
      .eq("status", "active")
      .select()
      .single();

    if (error) throw error;
    return c.json({ data });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Gagal memperbarui biaya operasional";
    console.error("Error updating operational expense:", error);
    return c.json({ error: message }, 400);
  }
});

app.delete("/make-server-f781cd00/finance/operational-expenses/:id", async (c) => {
  const access = await requireOperationalExpensePermission(c, OPERATIONAL_EXPENSE_DELETE_PERMISSION);
  if (access.error) return access.error;

  try {
    const id = normalizeOperationalExpenseText(c.req.param("id"));
    if (!id) return c.json({ error: "ID biaya operasional wajib diisi" }, 400);

    const body = await c.req.json().catch(() => ({}));
    const reason = normalizeOperationalExpenseText(body.reason || body.void_reason);

    const { data, error } = await supabase
      .from("operational_expense_ledger")
      .update({
        status: "void",
        void_reason: reason,
        voided_at: new Date().toISOString(),
        voided_by: access.requester?.authUser.id,
        updated_by: access.requester?.authUser.id,
        updated_by_name: access.requester?.actorName || "System",
      })
      .eq("id", id)
      .eq("status", "active")
      .select()
      .single();

    if (error) throw error;
    return c.json({ data });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Gagal void biaya operasional";
    console.error("Error voiding operational expense:", error);
    return c.json({ error: message }, 400);
  }
});

// Initialize Supabase Admin Client
const supabaseUrl = Deno.env.get("SUPABASE_URL")?.trim() || "";
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim() || "";
const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")?.trim() || "";

if (!supabaseUrl || !supabaseServiceKey) {
  throw new Error("SUPABASE_URL dan SUPABASE_SERVICE_ROLE_KEY wajib dikonfigurasi untuk server API.");
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);
const authSupabase = createClient(supabaseUrl, supabaseAnonKey || supabaseServiceKey);

// Ensure Storage Bucket Exists
async function ensureBucket(bucketName: string) {
  if (!supabaseServiceKey) {
    console.log(`Skipping bucket check for ${bucketName}: SUPABASE_SERVICE_ROLE_KEY is not configured.`);
    return;
  }
  try {
    const { data: buckets } = await supabase.storage.listBuckets();
    const bucketExists = buckets?.some(b => b.name === bucketName);
    
    if (!bucketExists) {
        console.log(`Creating bucket: ${bucketName}`);
        await supabase.storage.createBucket(bucketName, {
            public: false, // Private by default as per instructions
            fileSizeLimit: 10485760, // 10MB
            allowedMimeTypes: ['image/png', 'image/jpeg', 'image/jpg', 'image/webp']
        });
    }
  } catch (e) {
      console.error("Error ensuring bucket:", e);
  }
}

// Initialize Bucket
ensureBucket("make-f781cd00");

const PROOF_ASSETS_BUCKET = "proof-assets";
const PROOF_ASSET_ALLOWED_MIME_TYPES = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
]);

function sanitizeUploadFileName(fileName: string) {
  return (fileName || "image.jpg")
    .normalize("NFKD")
    .replace(/[^\w.\-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^\.+/, "")
    .slice(0, 120) || "image.jpg";
}

async function ensureProofAssetsBucket() {
  if (!supabaseServiceKey) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY belum dikonfigurasi untuk upload aset.");
  }

  const options = {
    public: true,
    fileSizeLimit: 10 * 1024 * 1024,
    allowedMimeTypes: Array.from(PROOF_ASSET_ALLOWED_MIME_TYPES),
  };
  const { data: buckets, error: listError } = await supabase.storage.listBuckets();
  if (listError) throw listError;

  const bucketExists = buckets?.some((bucket) => bucket.name === PROOF_ASSETS_BUCKET);
  if (!bucketExists) {
    const { error } = await supabase.storage.createBucket(PROOF_ASSETS_BUCKET, options);
    if (error) throw error;
    return;
  }

  await supabase.storage.updateBucket(PROOF_ASSETS_BUCKET, options).catch(() => undefined);
}

async function uploadProofAssetFile(file: File, userId: string) {
  const mimeType = file.type || "application/octet-stream";
  if (!PROOF_ASSET_ALLOWED_MIME_TYPES.has(mimeType)) {
    throw new Error("Gambar harus JPG, PNG, atau WebP.");
  }

  await ensureProofAssetsBucket();

  const safeName = sanitizeUploadFileName(file.name || "proof-asset.jpg");
  const objectPath = [
    userId || "system",
    new Date().toISOString().slice(0, 10),
    `${Date.now()}-${crypto.randomUUID()}-${safeName}`,
  ].join("/");
  const uploadBody = new Blob([await file.arrayBuffer()], { type: mimeType });
  const { error } = await supabase.storage
    .from(PROOF_ASSETS_BUCKET)
    .upload(objectPath, uploadBody, {
      contentType: mimeType,
      upsert: false,
    });
  if (error) throw error;

  const { data } = supabase.storage.from(PROOF_ASSETS_BUCKET).getPublicUrl(objectPath);
  return {
    url: data.publicUrl,
    path: objectPath,
    bucket: PROOF_ASSETS_BUCKET,
    size: file.size,
    mimeType,
  };
}

// Helper to log activity
async function logActivity(user: string, action: string, detail: string, ip: string) {
  const timestamp = Date.now();
  const key = `audit:${timestamp}:${Math.random().toString(36).substring(7)}`;
  const entry = {
    time: new Date(timestamp).toISOString(),
    user,
    action,
    detail,
    ip,
    type: action.toLowerCase().includes('delete') ? 'red' : action.toLowerCase().includes('create') || action.toLowerCase().includes('add') ? 'green' : 'blue' 
  };
  await kv.set(key, entry);
}

function runBackgroundTask(label: string, task: Promise<unknown>) {
  const guardedTask = task.catch((error) => {
    console.warn(`[BackgroundTask] ${label} failed:`, error?.message || error);
  });

  const edgeRuntime = (globalThis as unknown as {
    EdgeRuntime?: { waitUntil?: (task: Promise<unknown>) => void };
  }).EdgeRuntime;

  if (edgeRuntime?.waitUntil) {
    edgeRuntime.waitUntil(guardedTask);
    return;
  }

  void guardedTask;
}

// Helper to get actor name from token
async function getActorName(authHeader?: string, clientTokenHeader?: string) {
    const token = clientTokenHeader?.trim()
      ? clientTokenHeader.trim()
      : authHeader?.startsWith("Bearer ")
        ? authHeader.split(' ')[1]
        : "";
    if (!token) return "System";
    const { data: { user } } = await supabase.auth.getUser(token);
    return user?.user_metadata?.name || user?.email || "System";
}

const OPERATIONAL_EXPENSE_SOURCE_TYPES = new Set(["manual", "cash_out_forward", "recurring", "adjustment", "import"]);

function normalizeOperationalExpenseText(value: unknown) {
  return String(value || "").trim();
}

function parseOperationalExpenseAmount(value: unknown) {
  const amount = Number(value);
  return Number.isFinite(amount) ? amount : 0;
}

function isOperationalExpenseDate(value: string) {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return false;
  const [, rawYear, rawMonth, rawDay] = match;
  const year = Number(rawYear);
  const month = Number(rawMonth);
  const day = Number(rawDay);
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
}

async function requireOperationalExpensePermission(c: any, permission: PermissionKey, forbiddenMessage = "Anda tidak memiliki akses ke Biaya Operasional.") {
  const requester = await getRequesterAccessContext(c.req.raw.headers);
  if (!requester) {
    return {
      error: c.json({ error: "Session login tidak valid. Silakan login ulang." }, 401),
      requester: null,
    };
  }

  if (!hasEffectivePermission(requester, permission)) {
    return {
      error: c.json({ error: forbiddenMessage }, 403),
      requester,
    };
  }

  return { error: null, requester };
}

async function requireAnyOperationalExpensePermission(c: any, permissions: PermissionKey[]) {
  const requester = await getRequesterAccessContext(c.req.raw.headers);
  if (!requester) {
    return {
      error: c.json({ error: "Session login tidak valid. Silakan login ulang." }, 401),
      requester: null,
    };
  }

  if (!permissions.some((permission) => hasEffectivePermission(requester, permission))) {
    return {
      error: c.json({ error: "Anda tidak memiliki akses ke Biaya Operasional." }, 403),
      requester,
    };
  }

  return { error: null, requester };
}

function buildOperationalExpenseCategoryPayload(body: Record<string, unknown>) {
  const category = normalizeOperationalExpenseText(body.category);
  const subcategory = normalizeOperationalExpenseText(body.subcategory);

  if (!category) throw new Error("Kategori biaya operasional wajib diisi");
  if (!subcategory) throw new Error("Subkategori biaya operasional wajib diisi");

  const sortOrder = Number(body.sort_order ?? body.sortOrder ?? 0);
  const accountType = normalizeOperationalExpenseText(body.account_type || body.accountType || "expense");
  if (!["income", "expense", "cogs"].includes(accountType)) {
    throw new Error("Tipe akun harus income, expense, atau cogs");
  }

  return {
    category,
    subcategory,
    account_code: normalizeOperationalExpenseText(body.account_code || body.accountCode || body.code),
    account_type: accountType,
    description: normalizeOperationalExpenseText(body.description),
    sort_order: Number.isFinite(sortOrder) ? sortOrder : 0,
    finance_category_id: normalizeOperationalExpenseText(body.finance_category_id || body.financeCategoryId),
    finance_account_id: normalizeOperationalExpenseText(body.finance_account_id || body.financeAccountId),
    is_active: typeof body.is_active === "boolean"
      ? body.is_active
      : typeof body.isActive === "boolean"
        ? body.isActive
        : true,
  };
}

async function resolveOperationalExpenseBranch(branchId: string) {
  if (!branchId) {
    return { branchId: null, branchName: "" };
  }

  const { data, error } = await supabase
    .from("branches")
    .select("id, name")
    .eq("id", branchId)
    .maybeSingle();

  if (error) throw error;
  if (!data?.id) throw new Error("Cabang biaya operasional tidak ditemukan");

  return { branchId: data.id, branchName: normalizeOperationalExpenseText(data.name) };
}

async function buildOperationalExpensePayload(body: Record<string, unknown>) {
  const expenseDate = normalizeOperationalExpenseText(body.expense_date || body.expenseDate || body.date);
  if (!expenseDate || !isOperationalExpenseDate(expenseDate)) {
    throw new Error("Tanggal biaya operasional wajib diisi dengan format YYYY-MM-DD");
  }

  const category = normalizeOperationalExpenseText(body.category);
  if (!category) throw new Error("Kategori biaya operasional wajib diisi");

  const subcategory = normalizeOperationalExpenseText(body.subcategory);
  if (!subcategory) throw new Error("Subkategori biaya operasional wajib diisi");

  const amount = parseOperationalExpenseAmount(body.amount);
  if (amount <= 0) throw new Error("Nominal biaya operasional wajib lebih besar dari 0");

  const branch = await resolveOperationalExpenseBranch(
    normalizeOperationalExpenseText(body.branch_id || body.branchId),
  );
  const sourceType = normalizeOperationalExpenseText(body.source_type || body.sourceType) || "manual";
  if (!OPERATIONAL_EXPENSE_SOURCE_TYPES.has(sourceType)) {
    throw new Error("Tipe sumber biaya operasional tidak valid");
  }

  return {
    expense_date: expenseDate,
    period_key: expenseDate.slice(0, 7),
    branch_id: branch.branchId,
    branch_name: branch.branchName,
    category,
    subcategory,
    vendor_name: normalizeOperationalExpenseText(body.vendor_name || body.vendorName),
    description: normalizeOperationalExpenseText(body.description),
    amount,
    currency: normalizeOperationalExpenseText(body.currency) || "IDR",
    payment_source: normalizeOperationalExpenseText(body.payment_source || body.paymentSource),
    source_type: sourceType,
    source_ref: normalizeOperationalExpenseText(body.source_ref || body.sourceRef),
    notes: normalizeOperationalExpenseText(body.notes),
  };
}

function applyOperationalExpenseFilters(query: any, params: URLSearchParams) {
  const branchId = normalizeOperationalExpenseText(params.get("branch_id") || params.get("branchId"));
  const category = normalizeOperationalExpenseText(params.get("category"));
  const subcategory = normalizeOperationalExpenseText(params.get("subcategory"));
  const status = normalizeOperationalExpenseText(params.get("status") || "active");
  const startDate = normalizeOperationalExpenseText(params.get("startDate") || params.get("start_date"));
  const endDate = normalizeOperationalExpenseText(params.get("endDate") || params.get("end_date"));
  const q = normalizeOperationalExpenseText(params.get("q"));

  if (branchId && branchId !== "all") query = query.eq("branch_id", branchId);
  if (category && category !== "all") query = query.eq("category", category);
  if (subcategory && subcategory !== "all") query = query.eq("subcategory", subcategory);
  if (status && status !== "all") query = query.eq("status", status);
  if (startDate) query = query.gte("expense_date", startDate);
  if (endDate) query = query.lte("expense_date", endDate);
  if (q) {
    const escaped = q.replace(/[%_,]/g, "");
    query = query.or(
      `description.ilike.%${escaped}%,vendor_name.ilike.%${escaped}%,category.ilike.%${escaped}%,subcategory.ilike.%${escaped}%,payment_source.ilike.%${escaped}%,source_ref.ilike.%${escaped}%,notes.ilike.%${escaped}%`,
    );
  }

  return query;
}

const META_GRAPH_VERSION = Deno.env.get("META_GRAPH_VERSION")?.trim() || "v23.0";
const META_ACCESS_TOKEN = Deno.env.get("META_ACCESS_TOKEN")?.trim() || "";
const META_DM_USER_TOKEN = Deno.env.get("META_DM_USER_TOKEN")?.trim() || "";
const META_APP_ID = Deno.env.get("META_APP_ID")?.trim() || "";
const META_APP_SECRET = Deno.env.get("META_APP_SECRET")?.trim() || "";
const META_BATCH_SIZE = Math.min(50, Math.max(1, Number(Deno.env.get("META_BATCH_SIZE") || "50")));

type MetaBusinessRecord = {
  id: string;
  name: string;
  verification_status?: string;
};

type MetaAdAccountRecord = {
  id: string;
  account_id?: string;
  name?: string;
  account_status?: number | string;
  currency?: string;
  business?: {
    id?: string;
    name?: string;
  } | null;
};

type MetaInsightsRow = {
  account_id?: string;
  account_name?: string;
  spend?: string | number;
  clicks?: string | number;
  cpc?: string | number;
  ctr?: string | number;
  cpm?: string | number;
  cpp?: string | number;
  reach?: string | number;
  impressions?: string | number;
  actions?: Array<{ action_type?: string; value?: string | number }>;
  cost_per_action_type?: Array<{ action_type?: string; value?: string | number }>;
  date_start?: string;
  date_stop?: string;
};

function ensureMetaConfigured(accessToken = META_ACCESS_TOKEN) {
  if (!accessToken) {
    throw new Error("Token Meta belum dikonfigurasi di server.");
  }
}

function toNumber(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

const META_MESSAGING_RESULT_ACTION_PRIORITY = [
  "onsite_conversion.messaging_conversation_started_7d",
  "onsite_conversion.messaging_conversation_started",
  "messaging_conversation_started_7d",
  "messaging_conversation_started",
];

function normalizeMetaActionType(actionType: string) {
  return actionType.trim().toLowerCase();
}

function findMetaMessagingResultAction(actions?: Array<{ action_type?: string; value?: string | number }>) {
  if (!Array.isArray(actions)) return null;

  const normalizedActions = actions.map((action) => ({
    action,
    type: normalizeMetaActionType(String(action.action_type || "")),
  }));

  for (const resultActionType of META_MESSAGING_RESULT_ACTION_PRIORITY) {
    const matchedAction = normalizedActions.find((item) => item.type === resultActionType);
    if (matchedAction) return matchedAction.action;
  }

  return null;
}

function extractMetaMessagingResultValue(actions?: Array<{ action_type?: string; value?: string | number }>) {
  return toNumber(findMetaMessagingResultAction(actions)?.value);
}

function extractMetaMessagingResultCost(actions?: Array<{ action_type?: string; value?: string | number }>) {
  const resultAction = findMetaMessagingResultAction(actions);
  return resultAction ? toNumber(resultAction.value) : null;
}

function isValidDateParam(value?: string) {
  return Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value));
}

function splitIntoChunks<T>(items: T[], chunkSize: number) {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += chunkSize) {
    result.push(items.slice(index, index + chunkSize));
  }
  return result;
}

async function createAppSecretProof(accessToken: string) {
  if (!META_APP_SECRET) return null;

  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(META_APP_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );

  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(accessToken));
  return Array.from(new Uint8Array(signature))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function getMetaAuthParams(accessToken = META_ACCESS_TOKEN) {
  ensureMetaConfigured(accessToken);

  const params = new URLSearchParams({
    access_token: accessToken,
  });

  const appSecretProof = await createAppSecretProof(accessToken);
  if (appSecretProof) {
    params.set("appsecret_proof", appSecretProof);
  }

  return params;
}

async function fetchMetaJson(url: string, init?: RequestInit) {
  const response = await fetch(url, init);
  const payload = await response.json().catch(() => ({}));

  if (!response.ok || payload?.error) {
    const message =
      payload?.error?.message ||
      payload?.message ||
      `Meta Graph API error (${response.status})`;
    throw new Error(message);
  }

  return payload;
}

async function fetchMetaPaged<T>(
  path: string,
  params: Record<string, string>,
  accessToken = META_ACCESS_TOKEN,
) {
  const authParams = await getMetaAuthParams(accessToken);
  const url = new URL(`https://graph.facebook.com/${META_GRAPH_VERSION}${path}`);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  authParams.forEach((value, key) => {
    url.searchParams.set(key, value);
  });

  const rows: T[] = [];
  let nextUrl: string | null = url.toString();

  while (nextUrl) {
    const payload = await fetchMetaJson(nextUrl);
    if (Array.isArray(payload?.data)) {
      rows.push(...payload.data);
    }
    nextUrl = payload?.paging?.next || null;
  }

  return rows;
}

async function fetchMetaInsightsBatch(
  accounts: MetaAdAccountRecord[],
  from: string,
  to: string,
  accessToken = META_ACCESS_TOKEN,
) {
  const authParams = await getMetaAuthParams(accessToken);
  const insightsByAccountId = new Map<string, { metrics: MetaInsightsRow | null; error: string | null }>();
  const chunks = splitIntoChunks(accounts, META_BATCH_SIZE);

  for (const chunk of chunks) {
    const batch = chunk.map((account) => {
      const params = new URLSearchParams({
        fields: "account_id,account_name,spend,clicks,cpc,ctr,cpm,cpp,reach,impressions,actions,cost_per_action_type,date_start,date_stop",
        level: "account",
        time_range: JSON.stringify({ since: from, until: to }),
        limit: "1",
      });
      authParams.forEach((value, key) => {
        params.set(key, value);
      });

      return {
        method: "GET",
        relative_url: `${account.id}/insights?${params.toString()}`,
      };
    });

    const body = new URLSearchParams({
      batch: JSON.stringify(batch),
    });
    authParams.forEach((value, key) => {
      body.set(key, value);
    });

    const payload = await fetchMetaJson(`https://graph.facebook.com/${META_GRAPH_VERSION}/`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: body.toString(),
    });

    const responses = Array.isArray(payload) ? payload : [];

    chunk.forEach((account, index) => {
      const response = responses[index];
      if (!response) {
        insightsByAccountId.set(account.id, {
          metrics: null,
          error: "Meta batch response missing",
        });
        return;
      }

      if (response.code !== 200) {
        insightsByAccountId.set(account.id, {
          metrics: null,
          error: `Meta batch error (${response.code})`,
        });
        return;
      }

      const parsedBody = JSON.parse(response.body || "{}");
      const metrics = Array.isArray(parsedBody?.data) && parsedBody.data.length > 0 ? parsedBody.data[0] : null;

      insightsByAccountId.set(account.id, {
        metrics,
        error: parsedBody?.error?.message || null,
      });
    });
  }

  return insightsByAccountId;
}

async function fetchMetaDailyInsightsBatch(
  accounts: MetaAdAccountRecord[],
  from: string,
  to: string,
  accessToken = META_ACCESS_TOKEN,
) {
  const authParams = await getMetaAuthParams(accessToken);
  const insightsByAccountId = new Map<string, { metrics: MetaInsightsRow[]; error: string | null }>();
  const chunks = splitIntoChunks(accounts, META_BATCH_SIZE);

  for (const chunk of chunks) {
    const batch = chunk.map((account) => {
      const params = new URLSearchParams({
        fields: "account_id,account_name,spend,clicks,cpc,ctr,cpm,cpp,reach,impressions,actions,cost_per_action_type,date_start,date_stop",
        level: "account",
        time_increment: "1",
        time_range: JSON.stringify({ since: from, until: to }),
        limit: "500",
      });
      authParams.forEach((value, key) => {
        params.set(key, value);
      });

      return {
        method: "GET",
        relative_url: `${account.id}/insights?${params.toString()}`,
      };
    });

    const body = new URLSearchParams({
      batch: JSON.stringify(batch),
    });
    authParams.forEach((value, key) => {
      body.set(key, value);
    });

    const payload = await fetchMetaJson(`https://graph.facebook.com/${META_GRAPH_VERSION}/`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: body.toString(),
    });

    const responses = Array.isArray(payload) ? payload : [];

    chunk.forEach((account, index) => {
      const response = responses[index];
      if (!response) {
        insightsByAccountId.set(account.id, {
          metrics: [],
          error: "Meta batch response missing",
        });
        return;
      }

      if (response.code !== 200) {
        insightsByAccountId.set(account.id, {
          metrics: [],
          error: `Meta batch error (${response.code})`,
        });
        return;
      }

      const parsedBody = JSON.parse(response.body || "{}");
      const metrics = Array.isArray(parsedBody?.data) ? parsedBody.data : [];

      insightsByAccountId.set(account.id, {
        metrics,
        error: parsedBody?.error?.message || null,
      });
    });
  }

  if (from !== to) {
    const suspiciousAccountsByDate = new Map<string, MetaAdAccountRecord[]>();

    for (const account of accounts) {
      const result = insightsByAccountId.get(account.id);
      for (const metrics of result?.metrics || []) {
        const snapshotDate = metrics.date_start || metrics.date_stop;
        const hasDelivery =
          toNumber(metrics.clicks) > 0 ||
          toNumber(metrics.impressions) > 0 ||
          toNumber(metrics.reach) > 0 ||
          extractMetaMessagingResultValue(metrics.actions) > 0;
        if (!snapshotDate || toNumber(metrics.spend) > 0 || !hasDelivery) continue;

        const dateAccounts = suspiciousAccountsByDate.get(snapshotDate) || [];
        if (!dateAccounts.some((item) => item.id === account.id)) {
          dateAccounts.push(account);
        }
        suspiciousAccountsByDate.set(snapshotDate, dateAccounts);
      }
    }

    for (const [snapshotDate, suspiciousAccounts] of suspiciousAccountsByDate) {
      const retryMap = await fetchMetaDailyInsightsBatch(
        suspiciousAccounts,
        snapshotDate,
        snapshotDate,
        accessToken,
      );

      for (const account of suspiciousAccounts) {
        const current = insightsByAccountId.get(account.id);
        const retried = retryMap.get(account.id);
        const retriedMetrics = (retried?.metrics || []).find(
          (metrics) => (metrics.date_start || metrics.date_stop) === snapshotDate,
        );
        if (!current || !retriedMetrics || toNumber(retriedMetrics.spend) <= 0) continue;

        current.metrics = current.metrics.map((metrics) =>
          (metrics.date_start || metrics.date_stop) === snapshotDate ? retriedMetrics : metrics
        );
        current.error = retried?.error || current.error;
        insightsByAccountId.set(account.id, current);
      }
    }
  }

  return insightsByAccountId;
}

type MetaRegistryTokenCandidate = {
  accessToken: string;
  source: "runtime-system" | "dm-user";
};

type MetaRegistrySnapshot = {
  source: MetaRegistryTokenCandidate["source"];
  accessToken: string;
  businesses: MetaBusinessRecord[];
  accounts: MetaAdAccountRecord[];
};

type MetaIntegrationConfigRecord = {
  adAccountId: string;
  enabled: boolean;
  businessManagerId?: string;
  businessManagerName?: string;
  liveMetaAccountId?: string;
  liveMetaAccountName?: string;
};

type InternalAdAccountRecord = Awaited<ReturnType<typeof loadInternalAdAccounts>>[number];

const META_CONFIG_LOAD_TIMEOUT_MS = 8_000;

function isNonNull<T>(value: T | null): value is T {
  return value !== null;
}

function getMetaRegistryTokenCandidates() {
  const seen = new Set<string>();
  const candidates: MetaRegistryTokenCandidate[] = [];

  for (const candidate of [
    { accessToken: META_ACCESS_TOKEN, source: "runtime-system" as const },
    { accessToken: META_DM_USER_TOKEN, source: "dm-user" as const },
  ]) {
    const token = candidate.accessToken.trim();
    if (!token || seen.has(token)) continue;
    seen.add(token);
    candidates.push({ ...candidate, accessToken: token });
  }

  return candidates;
}

async function resolveBestMetaRegistrySnapshot() {
  const candidates = getMetaRegistryTokenCandidates();
  if (candidates.length === 0) {
    throw new Error("META_ACCESS_TOKEN atau META_DM_USER_TOKEN belum dikonfigurasi di server.");
  }

  let bestSnapshot: MetaRegistrySnapshot | null = null;
  let lastError: Error | null = null;

  for (const candidate of candidates) {
    try {
      const [businesses, accounts] = await Promise.all([
        fetchMetaPaged<MetaBusinessRecord>(
          "/me/businesses",
          {
            fields: "id,name,verification_status",
            limit: "200",
          },
          candidate.accessToken,
        ),
        fetchMetaPaged<MetaAdAccountRecord>(
          "/me/adaccounts",
          {
            fields: "id,account_id,name,account_status,currency,business{id,name}",
            limit: "500",
          },
          candidate.accessToken,
        ),
      ]);

      const snapshot: MetaRegistrySnapshot = {
        source: candidate.source,
        accessToken: candidate.accessToken,
        businesses,
        accounts,
      };

      if (!bestSnapshot) {
        bestSnapshot = snapshot;
        continue;
      }

      const bestScore = bestSnapshot.accounts.length * 1000 + bestSnapshot.businesses.length;
      const nextScore = snapshot.accounts.length * 1000 + snapshot.businesses.length;
      if (nextScore > bestScore) {
        bestSnapshot = snapshot;
      }
    } catch (error) {
      lastError = error instanceof Error ? error : new Error("Gagal membaca registry Meta.");
    }
  }

  if (!bestSnapshot) {
    throw lastError || new Error("Tidak ada token Meta yang berhasil membaca registry.");
  }

  return bestSnapshot;
}

async function debugMetaToken() {
  ensureMetaConfigured();

  if (!META_APP_ID || !META_APP_SECRET) {
    throw new Error("META_APP_ID atau META_APP_SECRET belum diatur di server.");
  }

  const appAccessToken = `${META_APP_ID}|${META_APP_SECRET}`;
  const url = new URL("https://graph.facebook.com/debug_token");
  url.searchParams.set("input_token", META_ACCESS_TOKEN);
  url.searchParams.set("access_token", appAccessToken);

  return fetchMetaJson(url.toString());
}

async function requireAuthenticatedUser(c: any) {
  const clientTokenHeader = c.req.header("x-client-token");
  const authHeader = c.req.header("Authorization");
  const token = clientTokenHeader?.trim()
    ? clientTokenHeader.trim()
    : authHeader?.startsWith("Bearer ")
      ? authHeader.slice(7)
      : "";

  if (!token) {
    return null;
  }

  const { data, error } = await authSupabase.auth.getUser(token);
  if (error || !data?.user) {
    return null;
  }

  return data.user;
}

async function requireAuthorizedRequester(
  c: any,
  permissions?: readonly PermissionKey[],
  mode: "any" | "all" = "any",
) {
  const requester = await getRequesterAccessContext(c.req.raw.headers);

  if (!requester) {
    return { requester: null, response: c.json({ error: "Unauthorized" }, 401) };
  }

  if (permissions?.length) {
    const hasAccess =
      mode === "all"
        ? permissions.every((permission) => hasEffectivePermission(requester, permission))
        : permissions.some((permission) => hasEffectivePermission(requester, permission));

    if (!hasAccess) {
      return { requester: null, response: c.json({ error: "Forbidden" }, 403) };
    }
  }

  return { requester, response: null };
}

function requesterHasAnyPermission(
  requester: Awaited<ReturnType<typeof getRequesterAccessContext>> | null,
  permissions: readonly PermissionKey[],
) {
  if (!requester) return false;
  return permissions.some((permission) => hasEffectivePermission(requester, permission));
}

function requesterCanViewOwnTechnicianSurface(
  requester: Awaited<ReturnType<typeof getRequesterAccessContext>> | null,
  userId: string,
) {
  if (!requester) return false;
  return requester.authUser.id === userId && hasEffectivePermission(requester, "teknisi.view_mobile");
}

function requesterCanManageTechnicianAttendance(
  requester: Awaited<ReturnType<typeof getRequesterAccessContext>> | null,
) {
  return requesterHasAnyPermission(requester, ["technician_schedule.manage"]);
}

function requesterCanViewTechnicianAttendance(
  requester: Awaited<ReturnType<typeof getRequesterAccessContext>> | null,
) {
  return requesterHasAnyPermission(requester, [
    "monitoring.activity_view",
    "technician_schedule.view",
    "technician_schedule.manage",
  ]);
}

function requesterCanReadShift(
  requester: Awaited<ReturnType<typeof getRequesterAccessContext>> | null,
  userId: string,
) {
  return (
    requesterCanViewOwnTechnicianSurface(requester, userId) ||
    requesterCanViewTechnicianAttendance(requester)
  );
}

function requesterCanWriteShift(
  requester: Awaited<ReturnType<typeof getRequesterAccessContext>> | null,
  userId: string,
) {
  return (
    requesterCanViewOwnTechnicianSurface(requester, userId) ||
    requesterCanManageTechnicianAttendance(requester)
  );
}

function requesterCanResetShift(
  requester: Awaited<ReturnType<typeof getRequesterAccessContext>> | null,
) {
  return requesterCanManageTechnicianAttendance(requester);
}

function requesterCanReadTechnicianOrders(
  requester: Awaited<ReturnType<typeof getRequesterAccessContext>> | null,
  userId: string,
) {
  return (
    requesterCanViewOwnTechnicianSurface(requester, userId) ||
    requesterCanViewTechnicianAttendance(requester)
  );
}

async function readJsonBody(c: any) {
  try {
    return await c.req.json();
  } catch {
    return {};
  }
}

function toInteger(value: unknown) {
  return Math.trunc(toNumber(value));
}

async function loadMetaIntegrationConfigMap() {
  const configs = (await kv.getByPrefix("meta_integration_config:")) as MetaIntegrationConfigRecord[];
  const mapped = new Map<string, MetaIntegrationConfigRecord>();

  for (const config of configs) {
    const accountId = config?.liveMetaAccountId?.trim();
    if (!accountId || !config?.adAccountId) continue;
    for (const variant of buildMetaExternalAccountIdVariants(accountId)) {
      mapped.set(variant, config);
    }
  }

  return mapped;
}

async function loadMetaIntegrationConfigs() {
  return (await kv.getByPrefix("meta_integration_config:")) as MetaIntegrationConfigRecord[];
}

async function loadMetaIntegrationConfigMapSafe() {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  try {
    const timeout = new Promise<Map<string, MetaIntegrationConfigRecord>>((resolve) => {
      timeoutId = setTimeout(() => resolve(new Map()), META_CONFIG_LOAD_TIMEOUT_MS);
    });
    const result = await Promise.race([loadMetaIntegrationConfigMap(), timeout]);
    if (result.size === 0) {
      console.warn("Meta integration config lookup empty/timeout; falling back to exact internal account name matching.");
    }
    return result;
  } catch (error) {
    console.warn(
      "Meta integration config lookup failed; falling back to exact internal account name matching.",
      error instanceof Error ? error.message : error,
    );
    return new Map<string, MetaIntegrationConfigRecord>();
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

function normalizeMetaAccountName(value?: string | null) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeMetaAccountNumericSuffix(value: string) {
  return value.replace(/(^|\s)0+(\d+)(?=$|\s)/g, (_match, prefix, digits) => `${prefix}${Number(digits)}`);
}

function buildMetaAccountNameVariants(value?: string | null) {
  const variants = new Set<string>();
  const add = (next?: string | null) => {
    const normalized = normalizeMetaAccountName(next);
    const compact = normalized.replace(/\s+/g, "");
    if (normalized) variants.add(normalized);
    if (compact) variants.add(compact);

    const normalizedNumeric = normalizeMetaAccountNumericSuffix(normalized);
    const compactNumeric = compact.replace(/0+(\d+)$/g, (_match, digits) => String(Number(digits)));
    if (normalizedNumeric) variants.add(normalizedNumeric);
    if (compactNumeric) variants.add(compactNumeric);
  };

  add(value);

  for (const variant of Array.from(variants)) {
    if (variant.includes("rahmansha")) add(variant.replace(/rahmansha/g, "rahmansa"));
    if (variant.includes("rahmansa")) add(variant.replace(/rahmansa/g, "rahmansha"));
  }

  return variants;
}

function findInternalAdAccountByMetaName(
  internalAccounts: InternalAdAccountRecord[],
  metaAccount: MetaAdAccountRecord,
) {
  const externalNames = buildMetaAccountNameVariants(metaAccount.name);
  if (externalNames.size === 0) return null;

  return internalAccounts.find((account) =>
    account.status === "active" &&
    Array.from(buildMetaAccountNameVariants(account.accountName)).some((name) => externalNames.has(name))
  ) || null;
}

function buildMetaExternalAccountIdVariants(value?: string | null) {
  const trimmed = String(value || "").trim();
  if (!trimmed) return [];

  const withoutPrefix = trimmed.replace(/^act_/i, "");
  return Array.from(new Set([trimmed, withoutPrefix, `act_${withoutPrefix}`].filter(Boolean)));
}

async function syncMetaSnapshotRange(params: {
  from: string;
  to: string;
  requestedBusinessId?: string;
  requestedAccountId?: string;
  requestedAccountName?: string;
  force?: boolean;
  minFreshMinutes?: number;
  mappedOnly?: boolean;
}) {
  const latestSyncedAt = await getLatestAdsSnapshotSyncAt({
    platformKey: "meta",
    from: params.from,
    to: params.to,
  });

  const [internalAccounts, integrationConfigByAccountId] = await Promise.all([
    loadInternalAdAccounts(),
    loadMetaIntegrationConfigMapSafe(),
  ]);
  const internalAccountById = new Map(
    internalAccounts.map((account) => [account.id, account]),
  );
  const configuredMetaAccountIdSet = new Set(
    Array.from(integrationConfigByAccountId.values())
      .filter((config) => config.enabled && config.liveMetaAccountId)
      .flatMap((config) => buildMetaExternalAccountIdVariants(config.liveMetaAccountId)),
  );
  const shouldLimitToMappedAccounts = Boolean(
    params.mappedOnly &&
      !params.requestedAccountId &&
      configuredMetaAccountIdSet.size > 0,
  );
  const filterMappedRows = (rows: AdsDailySnapshotRecord[]) =>
    shouldLimitToMappedAccounts
      ? rows.filter((row) =>
          buildMetaExternalAccountIdVariants(row.externalAccountId).some((accountId) =>
            configuredMetaAccountIdSet.has(accountId),
          ),
        )
      : rows;

  if (!params.force && isSyncFresh(latestSyncedAt, params.minFreshMinutes || 0)) {
    const rows = filterMappedRows(await fetchAdsDailySnapshots({
      platformKey: "meta",
      from: params.from,
      to: params.to,
      externalAccountIds: params.requestedAccountId
        ? buildMetaExternalAccountIdVariants(params.requestedAccountId)
        : undefined,
      externalGroupId: params.requestedBusinessId || null,
    }));

    return {
      rows,
      latestSyncedAt: latestSyncedAt || getMaxTimestamp(rows),
      upsertedCount: 0,
      servedFrom: "database-fresh",
      skippedSync: true,
    };
  }

  const registrySnapshot = await resolveBestMetaRegistrySnapshot();
  const filteredAccounts = registrySnapshot.accounts.filter((account) => {
    if (params.requestedBusinessId && account.business?.id !== params.requestedBusinessId) {
      return false;
    }
    const accountIdVariants = buildMetaExternalAccountIdVariants(account.id)
      .concat(buildMetaExternalAccountIdVariants(account.account_id));
    const requestedNameVariants = buildMetaAccountNameVariants(params.requestedAccountName);
    const accountNameVariants = buildMetaAccountNameVariants(account.name);
    if (
      params.requestedAccountId &&
      !(
        buildMetaExternalAccountIdVariants(params.requestedAccountId).some((accountId) =>
          accountIdVariants.includes(accountId),
        ) ||
        (requestedNameVariants.size > 0 && Array.from(requestedNameVariants).some((name) => accountNameVariants.has(name)))
      )
    ) {
      return false;
    }
    if (shouldLimitToMappedAccounts) {
      if (!accountIdVariants.some((accountId) => configuredMetaAccountIdSet.has(accountId))) {
        return false;
      }
    }
    return true;
  });

  if (params.requestedAccountId && filteredAccounts.length === 0) {
    throw new Error(
      `Akun Meta ${params.requestedAccountName || params.requestedAccountId} tidak ditemukan di token Meta aktif. Cek mapping akun iklan atau reconnect Meta.`,
    );
  }

  let upsertedCount = 0;
  for (const chunk of listDateChunks(params.from, params.to, 31)) {
    const insightMap = await fetchMetaDailyInsightsBatch(
      filteredAccounts,
      chunk.from,
      chunk.to,
      registrySnapshot.accessToken,
    );

    const chunkRecords: AdsDailySnapshotRecord[] = filteredAccounts.flatMap((account) => {
      const insight = insightMap.get(account.id);
      const metricsRows = insight?.metrics || [];

      const records: Array<AdsDailySnapshotRecord | null> = metricsRows
        .map((metrics) => {
          const snapshotDate = metrics?.date_start || metrics?.date_stop;
          if (!snapshotDate) return null;

          const integrationConfig =
            integrationConfigByAccountId.get(account.id) ||
            integrationConfigByAccountId.get(account.account_id || "");
          const internalAccount = integrationConfig?.adAccountId
            ? internalAccountById.get(integrationConfig.adAccountId)
            : findInternalAdAccountByMetaName(internalAccounts, account);
          const spend = toNumber(metrics?.spend);
          const dashboardResultCost = extractMetaMessagingResultCost(metrics?.cost_per_action_type);
          const dashboardResultValue = extractMetaMessagingResultValue(metrics?.actions);
          const conversions =
            dashboardResultValue > 0
              ? dashboardResultValue
              : dashboardResultCost && dashboardResultCost > 0
                ? Math.round(spend / dashboardResultCost)
                : 0;
          const costPerConversion =
            dashboardResultCost ||
            (conversions > 0 ? spend / conversions : null);

          return {
            platformKey: "meta",
            snapshotDate,
            internalAdAccountId: integrationConfig?.adAccountId || internalAccount?.id || null,
            advertiserId: internalAccount?.advertiserId || null,
            platformId: internalAccount?.platformId || null,
            externalAccountId: account.id,
            externalAccountName: account.name || metrics?.account_name || account.id,
            externalGroupId: account.business?.id || null,
            externalGroupName: account.business?.name || "Tanpa Business Manager",
            externalAccountStatus:
              account.account_status != null ? String(account.account_status) : null,
            currencyCode: account.currency || "IDR",
            spend,
            clicks: toNumber(metrics?.clicks),
            impressions: toNumber(metrics?.impressions),
            reach: toNumber(metrics?.reach),
            conversions,
            ctr: metrics?.ctr != null ? toNumber(metrics.ctr) : null,
            cpc: metrics?.cpc != null ? toNumber(metrics.cpc) : null,
            cpm: metrics?.cpm != null ? toNumber(metrics.cpm) : null,
            costPerConversion,
            error: insight?.error || null,
          } satisfies AdsDailySnapshotRecord;
        });

      return records.filter(isNonNull);
    });

    if (chunkRecords.length === 0) {
      const insightErrors = filteredAccounts
        .map((account) => insightMap.get(account.id)?.error)
        .filter(Boolean);
      if (insightErrors.length > 0) {
        throw new Error(`Meta tidak mengembalikan insight: ${insightErrors[0]}`);
      }
      continue;
    }
    const chunkResult = await upsertAdsDailySnapshots(chunkRecords);
    upsertedCount += chunkResult.upsertedCount;
  }

  const rows = filterMappedRows(await fetchAdsDailySnapshots({
    platformKey: "meta",
    from: params.from,
    to: params.to,
    externalAccountIds: params.requestedAccountId
      ? buildMetaExternalAccountIdVariants(params.requestedAccountId)
      : undefined,
    externalGroupId: params.requestedBusinessId || null,
  }));

  return {
    rows,
    latestSyncedAt: getMaxTimestamp(rows),
    upsertedCount,
    servedFrom: "meta-live",
    skippedSync: false,
  };
}

type AdsSyncTriggerSource = "manual" | "scheduled" | "reconcile";
type AdsSyncProviderKey = "meta" | "google" | "tiktok";

type AdsSyncProviderStatus = {
  key: AdsSyncProviderKey;
  label: string;
  state: "success" | "empty" | "error";
  count: number;
  message: string;
};

type AdsSyncFilters = {
  platformId?: string;
  advertiserId?: string;
  csId?: string;
  adAccountId?: string;
};

const ADS_SYNC_PROVIDER_LABELS: Record<AdsSyncProviderKey, string> = {
  meta: "Meta",
  google: "Google Ads",
  tiktok: "TikTok Ads",
};

const waitForAdsSyncRetry = (milliseconds: number) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

const isTransientAdsSyncError = (error: unknown) =>
  /timeout|timed out|429|rate.?limit|temporar|network|fetch|\b5\d\d\b/i.test(
    error instanceof Error ? error.message : String(error || ""),
  );

async function runAdsProviderWithRetry<T>(operation: () => Promise<T>) {
  let lastError: unknown;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt === 3 || !isTransientAdsSyncError(error)) throw error;
      await waitForAdsSyncRetry(attempt === 1 ? 1_000 : 3_000);
    }
  }
  throw lastError;
}

const formatJakartaDateKey = (date: Date) => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const valueByPart = new Map(parts.map((part) => [part.type, part.value]));
  return `${valueByPart.get("year")}-${valueByPart.get("month")}-${valueByPart.get("day")}`;
};

const shiftDateKey = (value: string, days: number) => {
  const date = new Date(`${value}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};

const normalizeAdsExternalAccountId = (platformKey: string, value: unknown) => {
  const normalized = String(value || "").trim().toLowerCase();
  if (platformKey === "meta") return normalized.replace(/^act_/, "").replace(/\D/g, "");
  return normalized.replace(/[^a-z0-9]/g, "");
};

const isDateInsideAssignment = (
  assignment: { start_date?: string | null; end_date?: string | null; status?: string | null },
  date: string,
) => assignment.status === "active" &&
  Boolean(assignment.start_date && assignment.start_date <= date) &&
  (!assignment.end_date || assignment.end_date >= date);

async function materializeAdsSnapshotsToDailyAds(params: {
  runId: string;
  rows: AdsDailySnapshotRecord[];
  filters: AdsSyncFilters;
}) {
  if (params.rows.length === 0) {
    return {
      inserted: 0,
      updated: 0,
      protectedManual: 0,
      skipped: 0,
      unmapped: 0,
      totalMapped: 0,
      spend: 0,
    };
  }

  const [accountsResult, mappingsResult, assignmentsResult, ownersResult, existingResult] = await Promise.all([
    supabase
      .from("ad_accounts")
      .select("id, platform_id, advertiser_id, sub_channel_id, status, ppn, fee"),
    supabase
      .from("ad_account_api_mappings")
      .select("internal_ad_account_id, platform_key, external_account_id, status")
      .eq("status", "active"),
    supabase
      .from("ad_account_assignments")
      .select("ad_account_id, cs_id, sub_channel_id, start_date, end_date, status"),
    supabase
      .from("ad_account_owner_assignments")
      .select("ad_account_id, advertiser_id, start_date, end_date, status"),
    supabase
      .from("daily_ads")
      .select("id, date, ad_account_id, edit_count")
      .gte("date", params.rows.reduce((value, row) => row.snapshotDate < value ? row.snapshotDate : value, params.rows[0]?.snapshotDate || "9999-12-31"))
      .lte("date", params.rows.reduce((value, row) => row.snapshotDate > value ? row.snapshotDate : value, params.rows[0]?.snapshotDate || "0001-01-01")),
  ]);

  for (const result of [accountsResult, mappingsResult, assignmentsResult, ownersResult, existingResult]) {
    if (result.error) throw new Error(result.error.message);
  }

  const activeAccountById = new Map(
    (accountsResult.data || [])
      .filter((account: any) => account.status === "active")
      .map((account: any) => [String(account.id), account]),
  );
  const mappedAccountByExternalKey = new Map(
    (mappingsResult.data || []).map((mapping: any) => [
      `${mapping.platform_key}:${normalizeAdsExternalAccountId(mapping.platform_key, mapping.external_account_id)}`,
      String(mapping.internal_ad_account_id),
    ]),
  );
  const assignmentsByAccount = new Map<string, any[]>();
  for (const assignment of assignmentsResult.data || []) {
    const key = String((assignment as any).ad_account_id);
    assignmentsByAccount.set(key, [...(assignmentsByAccount.get(key) || []), assignment]);
  }
  const ownersByAccount = new Map<string, any[]>();
  for (const assignment of ownersResult.data || []) {
    const key = String((assignment as any).ad_account_id);
    ownersByAccount.set(key, [...(ownersByAccount.get(key) || []), assignment]);
  }
  const existingByKey = new Map(
    (existingResult.data || []).map((row: any) => [`${row.date}:${row.ad_account_id}`, row]),
  );

  const groupedRows = new Map<string, {
    date: string;
    accountId: string;
    spend: number;
    conversions: number;
    providerSyncedAt: string | null;
  }>();
  let unmapped = 0;
  let ignored = 0;

  for (const row of params.rows) {
    const spend = Number(row.spend) || 0;
    const conversions = Math.round(Number(row.conversions) || 0);
    if (spend <= 0 && conversions <= 0) {
      ignored += 1;
      continue;
    }

    const mappedAccountId = row.internalAdAccountId || mappedAccountByExternalKey.get(
      `${row.platformKey}:${normalizeAdsExternalAccountId(row.platformKey, row.externalAccountId)}`,
    );
    const account = mappedAccountId ? activeAccountById.get(String(mappedAccountId)) : null;
    if (!account) {
      unmapped += 1;
      continue;
    }

    const accountId = String(account.id);
    if (params.filters.platformId && params.filters.platformId !== "all" && account.platform_id !== params.filters.platformId) continue;
    if (params.filters.adAccountId && params.filters.adAccountId !== "all" && accountId !== params.filters.adAccountId) continue;

    const owner = (ownersByAccount.get(accountId) || [])
      .filter((assignment) => isDateInsideAssignment(assignment, row.snapshotDate))
      .sort((left, right) => String(right.start_date).localeCompare(String(left.start_date)))[0];
    const advertiserId = owner?.advertiser_id || account.advertiser_id;
    const assignment = (assignmentsByAccount.get(accountId) || [])
      .filter((item) => isDateInsideAssignment(item, row.snapshotDate))
      .sort((left, right) => String(right.start_date).localeCompare(String(left.start_date)))[0];

    if (params.filters.advertiserId && params.filters.advertiserId !== "all" && advertiserId !== params.filters.advertiserId) continue;
    if (params.filters.csId && params.filters.csId !== "all" && assignment?.cs_id !== params.filters.csId) continue;

    const key = `${row.snapshotDate}:${accountId}`;
    const current = groupedRows.get(key) || {
      date: row.snapshotDate,
      accountId,
      spend: 0,
      conversions: 0,
      providerSyncedAt: null,
    };
    current.spend += spend;
    current.conversions += conversions;
    if (row.syncedAt && (!current.providerSyncedAt || row.syncedAt > current.providerSyncedAt)) {
      current.providerSyncedAt = row.syncedAt;
    }
    groupedRows.set(key, current);
  }

  let inserted = 0;
  let updated = 0;
  let protectedManual = 0;
  const now = new Date().toISOString();

  for (const row of groupedRows.values()) {
    const account: any = activeAccountById.get(row.accountId);
    const owner = (ownersByAccount.get(row.accountId) || [])
      .filter((assignment) => isDateInsideAssignment(assignment, row.date))
      .sort((left, right) => String(right.start_date).localeCompare(String(left.start_date)))[0];
    const assignment = (assignmentsByAccount.get(row.accountId) || [])
      .filter((item) => isDateInsideAssignment(item, row.date))
      .sort((left, right) => String(right.start_date).localeCompare(String(left.start_date)))[0];
    const existing: any = existingByKey.get(`${row.date}:${row.accountId}`);

    if (existing && Number(existing.edit_count || 0) > 0) {
      protectedManual += 1;
      continue;
    }

    const payload = {
      date: row.date,
      advertiser_id: owner?.advertiser_id || account.advertiser_id,
      platform_id: account.platform_id,
      sub_channel_id: assignment?.sub_channel_id || account.sub_channel_id || null,
      ad_account_id: row.accountId,
      cs_id: assignment?.cs_id || null,
      amount_spent: Math.round(row.spend),
      leads_dashboard: row.conversions,
      ppn_amount: Math.round(row.spend * ((Number(account.ppn) || 0) / 100)),
      fee_amount: Math.round(row.spend * ((Number(account.fee) || 0) / 100)),
      sync_source: "api",
      provider_synced_at: row.providerSyncedAt,
      last_sync_run_id: params.runId,
      synced_at: now,
    };

    if (existing) {
      const { data, error } = await supabase
        .from("daily_ads")
        .update(payload)
        .eq("id", existing.id)
        .or("edit_count.is.null,edit_count.eq.0")
        .select("id");
      if (error) throw new Error(error.message);
      if ((data || []).length > 0) updated += 1;
      else protectedManual += 1;
      continue;
    }

    const { error } = await supabase
      .from("daily_ads")
      .insert({ id: crypto.randomUUID(), ...payload, edit_count: 0 });
    if (!error) {
      inserted += 1;
      continue;
    }
    if (error.code !== "23505") throw new Error(error.message);

    const { data: concurrentRows, error: concurrentReadError } = await supabase
      .from("daily_ads")
      .select("id, edit_count")
      .eq("date", row.date)
      .eq("ad_account_id", row.accountId)
      .limit(1);
    if (concurrentReadError) throw new Error(concurrentReadError.message);
    const concurrent = concurrentRows?.[0];
    if (!concurrent || Number(concurrent.edit_count || 0) > 0) {
      protectedManual += 1;
      continue;
    }
    const { data: updatedRows, error: updateError } = await supabase
      .from("daily_ads")
      .update(payload)
      .eq("id", concurrent.id)
      .or("edit_count.is.null,edit_count.eq.0")
      .select("id");
    if (updateError) throw new Error(updateError.message);
    if ((updatedRows || []).length > 0) updated += 1;
    else protectedManual += 1;
  }

  return {
    inserted,
    updated,
    protectedManual,
    skipped: ignored + protectedManual,
    unmapped,
    totalMapped: groupedRows.size,
    spend: Array.from(groupedRows.values()).reduce((sum, row) => sum + row.spend, 0),
  };
}

async function executeAdsDailySync(params: {
  runId: string;
  range: { from: string; to: string };
  filters: AdsSyncFilters;
  forceProviders: boolean;
}) {
  const providerOperations: Array<{
    key: AdsSyncProviderKey;
    operation: () => Promise<{ rows: AdsDailySnapshotRecord[]; latestSyncedAt?: string | null; servedFrom?: string }>;
  }> = [
    {
      key: "meta",
      operation: () => syncMetaSnapshotRange({
        from: params.range.from,
        to: params.range.to,
        force: params.forceProviders,
        minFreshMinutes: 10,
        mappedOnly: true,
      }),
    },
    {
      key: "google",
      operation: () => syncGoogleAdsSnapshotRange({
        from: params.range.from,
        to: params.range.to,
        force: params.forceProviders,
        minFreshMinutes: 10,
      }),
    },
    {
      key: "tiktok",
      operation: () => syncTikTokSnapshotRange({
        from: params.range.from,
        to: params.range.to,
        force: params.forceProviders,
        minFreshMinutes: 10,
      }),
    },
  ];

  const settled = await Promise.allSettled(
    providerOperations.map(({ operation }) => runAdsProviderWithRetry(operation)),
  );
  const providerStatuses: AdsSyncProviderStatus[] = [];
  const rows: AdsDailySnapshotRecord[] = [];
  const errors: string[] = [];

  settled.forEach((result, index) => {
    const key = providerOperations[index].key;
    const label = ADS_SYNC_PROVIDER_LABELS[key];
    if (result.status === "rejected") {
      const message = result.reason instanceof Error ? result.reason.message : String(result.reason || "Sinkron gagal.");
      errors.push(`${label}: ${message}`);
      providerStatuses.push({ key, label, state: "error", count: 0, message });
      return;
    }
    const providerRows = result.value.rows || [];
    rows.push(...providerRows);
    providerStatuses.push({
      key,
      label,
      state: providerRows.length > 0 ? "success" : "empty",
      count: providerRows.length,
      message: providerRows.length > 0
        ? `${providerRows.length} snapshot tersedia.`
        : "Provider berhasil diperiksa, tetapi tidak ada snapshot pada periode ini.",
    });
  });

  if (settled.every((result) => result.status === "rejected")) {
    throw Object.assign(new Error(errors[0] || "Semua provider iklan gagal disinkronkan."), {
      providerStatuses,
      syncErrors: errors,
    });
  }

  const counts = await materializeAdsSnapshotsToDailyAds({
    runId: params.runId,
    rows,
    filters: params.filters,
  });
  return { providerStatuses, errors, counts };
}

async function sha256Hex(value: string) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function isTrustedAdsSchedulerRequest(c: any) {
  const expected = String(Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "").trim();
  const providedServiceRole = String(
    c.req.header("x-service-role-key") || c.req.header("x-supabase-service-role-key") || "",
  ).trim();
  if (expected && providedServiceRole && expected === providedServiceRole) return true;

  const schedulerSecret = String(c.req.header("x-scheduler-secret") || "").trim();
  if (!schedulerSecret) return false;

  const { data, error } = await supabase
    .from("ads_sync_runtime")
    .select("scheduler_token_hash")
    .eq("id", "daily-ads")
    .maybeSingle();
  if (error || !data?.scheduler_token_hash) return false;

  return data.scheduler_token_hash === await sha256Hex(schedulerSecret);
}

app.get("/make-server-f781cd00/ads/sync-status", async (c) => {
  const auth = await requireAuthorizedRequester(c, ADS_REFERENCE_READ_PERMISSIONS);
  if (auth.response) return auth.response;

  const [recentResult, lastUpdateResult, runtimeResult] = await Promise.all([
    supabase
      .from("daily_ads_sync_runs")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(5),
    supabase
      .from("daily_ads_sync_runs")
      .select("*")
      .eq("run_kind", "commit")
      .in("status", ["succeeded", "partial"])
      .order("finished_at", { ascending: false, nullsFirst: false })
      .limit(1),
    supabase
      .from("ads_sync_runtime")
      .select("last_run_id,last_started_at,last_finished_at,last_success_at,last_status,last_error")
      .eq("id", "daily-ads")
      .maybeSingle(),
  ]);

  const queryError = recentResult.error || lastUpdateResult.error || runtimeResult.error;
  if (queryError) {
    console.error("Ads sync status query failed:", queryError);
    return c.json({ error: "Status sinkron iklan belum dapat dibaca." }, 500);
  }

  return c.json({
    recent: recentResult.data || [],
    lastUpdate: lastUpdateResult.data?.[0] || null,
    runtime: runtimeResult.data || null,
    checkedAt: new Date().toISOString(),
  });
});

app.get("/make-server-f781cd00/ads/sync-health", async (c) => {
  const { data, error } = await supabase
    .from("ads_sync_runtime")
    .select("last_started_at,last_finished_at,last_success_at,last_status,scheduler_token_hash")
    .eq("id", "daily-ads")
    .maybeSingle();

  if (error) {
    return c.json({ ok: false, error: "Ads sync health is unavailable." }, 503);
  }

  return c.json({
    ok: Boolean(data?.last_success_at),
    scheduler: data?.scheduler_token_hash ? "database-cron" : "not-configured",
    lastStartedAt: data?.last_started_at || null,
    lastFinishedAt: data?.last_finished_at || null,
    lastSuccessAt: data?.last_success_at || null,
    lastStatus: data?.last_status || null,
    checkedAt: new Date().toISOString(),
  });
});

app.post("/make-server-f781cd00/ads/sync-run", async (c) => {
  const trustedScheduler = await isTrustedAdsSchedulerRequest(c);
  const auth = trustedScheduler
    ? { requester: null, response: null }
    : await requireAuthorizedRequester(c, [ADS_MANAGE_PERMISSION]);
  if (auth.response) return auth.response;

  const body = await readJsonBody(c);
  const requestedTrigger = body?.triggerSource;
  const triggerSource: AdsSyncTriggerSource = trustedScheduler
    ? requestedTrigger === "reconcile" ? "reconcile" : "scheduled"
    : "manual";
  const today = formatJakartaDateKey(new Date());
  const defaultFrom = triggerSource === "reconcile" ? shiftDateKey(today, -6) : shiftDateKey(today, -1);
  const from = typeof body?.from === "string" ? body.from : defaultFrom;
  const to = typeof body?.to === "string" ? body.to : today;
  if (!isValidDateParam(from) || !isValidDateParam(to) || from! > to!) {
    return c.json({ error: "Rentang sinkron wajib menggunakan format YYYY-MM-DD yang valid." }, 400);
  }
  if (diffInDaysInclusive(from!, to!) > 92) {
    return c.json({ error: "Rentang sinkron maksimal 92 hari per proses." }, 400);
  }

  const filters: AdsSyncFilters = {
    platformId: typeof body?.filters?.platformId === "string" ? body.filters.platformId : undefined,
    advertiserId: typeof body?.filters?.advertiserId === "string" ? body.filters.advertiserId : undefined,
    csId: typeof body?.filters?.csId === "string" ? body.filters.csId : undefined,
    adAccountId: typeof body?.filters?.adAccountId === "string" ? body.filters.adAccountId : undefined,
  };
  const forceProviders = typeof body?.forceProviders === "boolean"
    ? body.forceProviders
    : triggerSource !== "scheduled";
  const runId = crypto.randomUUID();
  const actorId = auth.requester?.authUser.id || null;
  const actorName = auth.requester?.actorName || (triggerSource === "reconcile" ? "Rekonsiliasi Otomatis" : "Sinkron Otomatis");
  const actorRole = auth.requester?.role || "System";
  const startedAt = new Date().toISOString();

  const { data: claimed, error: claimError } = await supabase.rpc("claim_ads_daily_sync_lock", {
    p_run_id: runId,
    p_ttl_seconds: 900,
  });
  if (claimError) return c.json({ error: `Gagal mengambil lock sinkron: ${claimError.message}` }, 500);
  if (!claimed) {
    return c.json({
      busy: true,
      status: "skipped",
      message: "Sinkron lain sedang berjalan. Data akan diperbarui oleh proses tersebut.",
    }, 202);
  }

  const baseRun = {
    id: runId,
    created_at: startedAt,
    started_at: startedAt,
    heartbeat_at: startedAt,
    run_kind: "commit",
    trigger_source: triggerSource,
    status: "running",
    actor_id: actorId,
    actor_name: actorName,
    actor_role: actorRole,
    range_from: from,
    range_to: to,
    platform_id: filters.platformId && filters.platformId !== "all" ? filters.platformId : null,
    advertiser_id: filters.advertiserId && filters.advertiserId !== "all" ? filters.advertiserId : null,
    cs_id: filters.csId && filters.csId !== "all" ? filters.csId : null,
    mode: "update-existing",
    preserve_edited: true,
  };
  const { error: startError } = await supabase.from("daily_ads_sync_runs").insert(baseRun);
  if (startError) {
    await supabase.rpc("release_ads_daily_sync_lock", {
      p_run_id: runId,
      p_status: "failed",
      p_error: startError.message,
    });
    return c.json({ error: `Gagal mencatat proses sinkron: ${startError.message}` }, 500);
  }

  try {
    const result = await executeAdsDailySync({
      runId,
      range: { from: from!, to: to! },
      filters,
      forceProviders,
    });
    const status = result.errors.length > 0 ? "partial" : "succeeded";
    const finishedAt = new Date().toISOString();
    const { error: finishError } = await supabase
      .from("daily_ads_sync_runs")
      .update({
        status,
        finished_at: finishedAt,
        heartbeat_at: finishedAt,
        inserted_count: result.counts.inserted,
        updated_count: result.counts.updated,
        new_count: result.counts.inserted,
        update_count: result.counts.updated,
        skipped_count: result.counts.skipped,
        unmapped_count: result.counts.unmapped,
        spend: result.counts.spend,
        provider_statuses: result.providerStatuses,
        errors: result.errors,
        error_message: result.errors.join(" | ") || null,
      })
      .eq("id", runId);
    if (finishError) throw new Error(finishError.message);
    await supabase.rpc("release_ads_daily_sync_lock", {
      p_run_id: runId,
      p_status: status,
      p_error: result.errors.join(" | ") || null,
    });
    return c.json({
      runId,
      status,
      triggerSource,
      range: { from, to },
      counts: result.counts,
      providerStatuses: result.providerStatuses,
      errors: result.errors,
      finishedAt,
    });
  } catch (error: any) {
    const message = error instanceof Error ? error.message : "Sinkronisasi iklan gagal.";
    const providerStatuses = Array.isArray(error?.providerStatuses) ? error.providerStatuses : [];
    const errors = Array.isArray(error?.syncErrors) ? error.syncErrors : [message];
    const finishedAt = new Date().toISOString();
    await supabase
      .from("daily_ads_sync_runs")
      .update({
        status: "failed",
        finished_at: finishedAt,
        heartbeat_at: finishedAt,
        provider_statuses: providerStatuses,
        errors,
        error_message: message,
      })
      .eq("id", runId);
    await supabase.rpc("release_ads_daily_sync_lock", {
      p_run_id: runId,
      p_status: "failed",
      p_error: message,
    });
    console.error("Ads daily sync failed:", error);
    return c.json({ error: message, runId, status: "failed", providerStatuses, errors }, 500);
  }
});

// Health check endpoint
app.get("/make-server-f781cd00/health", (c) => {
  return c.json({ status: "ok" });
});

app.get("/make-server-f781cd00/meta/live-breakdown", async (c) => {
  try {
    const auth = await requireAuthorizedRequester(c, [MARKETING_MONITORING_VIEW_PERMISSION]);
    if (auth.response) return auth.response;

    if (!META_ACCESS_TOKEN && !META_DM_USER_TOKEN) {
      return c.json({ error: "META_ACCESS_TOKEN atau META_DM_USER_TOKEN belum diatur di server." }, 503);
    }

    const from = c.req.query("from");
    const to = c.req.query("to");
    const requestedBusinessId = c.req.query("businessId");
    const requestedAccountId = c.req.query("accountId");

    if (!isValidDateParam(from) || !isValidDateParam(to)) {
      return c.json({ error: "Parameter from/to wajib format YYYY-MM-DD." }, 400);
    }

    const registrySnapshot = await resolveBestMetaRegistrySnapshot();
    const businesses = registrySnapshot.businesses;
    const allAccounts = registrySnapshot.accounts;

    const filteredAccounts = allAccounts.filter((account) => {
      if (requestedBusinessId && account.business?.id !== requestedBusinessId) return false;
      if (requestedAccountId && account.id !== requestedAccountId) return false;
      return true;
    });

    const insightMap = await fetchMetaInsightsBatch(
      filteredAccounts,
      from!,
      to!,
      registrySnapshot.accessToken,
    );

    const accountSnapshots = filteredAccounts.map((account) => {
      const insight = insightMap.get(account.id);
      const metrics = insight?.metrics;
      const spend = toNumber(metrics?.spend);
      const clicks = toNumber(metrics?.clicks);
      const impressions = toNumber(metrics?.impressions);
      const reach = toNumber(metrics?.reach);
      const cpc = metrics?.cpc != null ? toNumber(metrics.cpc) : null;
      const ctr = metrics?.ctr != null ? toNumber(metrics.ctr) : null;
      const cpm = metrics?.cpm != null ? toNumber(metrics.cpm) : null;
      const cpp = metrics?.cpp != null ? toNumber(metrics.cpp) : null;

      return {
        id: account.id,
        accountId: account.account_id || account.id.replace(/^act_/, ""),
        name: account.name || metrics?.account_name || account.id,
        businessId: account.business?.id || null,
        businessName: account.business?.name || "Tanpa BM",
        accountStatus: account.account_status != null ? Number(account.account_status) : null,
        currency: account.currency || "IDR",
        spend,
        clicks,
        impressions,
        reach,
        cpc,
        ctr,
        cpm,
        cpp,
        dateStart: metrics?.date_start || from,
        dateStop: metrics?.date_stop || to,
        error: insight?.error || null,
      };
    });

    const businessSummaryMap = new Map(
      businesses.map((business) => [
        business.id,
        {
          id: business.id,
          name: business.name,
          verificationStatus: business.verification_status || "unknown",
          accountCount: 0,
          spend: 0,
          clicks: 0,
          impressions: 0,
          reach: 0,
        },
      ]),
    );

    for (const account of accountSnapshots) {
      if (!account.businessId) continue;

      const business =
        businessSummaryMap.get(account.businessId) ||
        {
          id: account.businessId,
          name: account.businessName,
          verificationStatus: "unknown",
          accountCount: 0,
          spend: 0,
          clicks: 0,
          impressions: 0,
          reach: 0,
        };

      business.accountCount += 1;
      business.spend += account.spend;
      business.clicks += account.clicks;
      business.impressions += account.impressions;
      business.reach += account.reach;
      businessSummaryMap.set(account.businessId, business);
    }

    const businessSnapshots = Array.from(businessSummaryMap.values()).sort((left, right) => {
      if (right.spend !== left.spend) return right.spend - left.spend;
      return left.name.localeCompare(right.name);
    });

    const summary = accountSnapshots.reduce(
      (acc, account) => {
        acc.accountCount += 1;
        acc.businessCount = businessSnapshots.length;
        acc.spend += account.spend;
        acc.clicks += account.clicks;
        acc.impressions += account.impressions;
        acc.reach += account.reach;
        return acc;
      },
      {
        businessCount: businessSnapshots.length,
        accountCount: 0,
        spend: 0,
        clicks: 0,
        impressions: 0,
        reach: 0,
      },
    );

    return c.json({
      source: "meta-live",
      generatedAt: new Date().toISOString(),
      requestedBy: auth.requester?.authUser.id || null,
      range: {
        from,
        to,
      },
      businesses: businessSnapshots,
      accounts: accountSnapshots.sort((left, right) => {
        if (right.spend !== left.spend) return right.spend - left.spend;
        return left.name.localeCompare(right.name);
      }),
      summary,
      metadata: {
        registryTokenSource: registrySnapshot.source,
        registryBusinessCount: businesses.length,
        registryAccountCount: allAccounts.length,
      },
    });
  } catch (err: any) {
    console.error("Meta live breakdown error:", err);
    return c.json({ error: err.message || "Unknown error" }, 500);
  }
});

app.get("/make-server-f781cd00/meta/snapshots", async (c) => {
  try {
    const auth = await requireAuthorizedRequester(c, ADS_REFERENCE_READ_PERMISSIONS);
    if (auth.response) return auth.response;

    const from = c.req.query("from");
    const to = c.req.query("to");
    const requestedBusinessId = c.req.query("businessId");
    const requestedAccountId = c.req.query("accountId");
    const includeLastKnown = parseBooleanFlag(c.req.query("includeLastKnown"));

    if (!isValidDateParam(from) || !isValidDateParam(to)) {
      return c.json({ error: "Parameter from/to wajib format YYYY-MM-DD." }, 400);
    }

    let rows = await fetchAdsDailySnapshots({
      platformKey: "meta",
      from: from!,
      to: to!,
      externalAccountIds: requestedAccountId
        ? buildMetaExternalAccountIdVariants(requestedAccountId)
        : undefined,
      externalGroupId: requestedBusinessId || null,
    });

    let servedFrom = "meta-snapshot-db";
    let fallbackSnapshotDate: string | null = null;

    if (includeLastKnown) {
      const existingAccountIds = new Set(rows.flatMap((row) => buildMetaExternalAccountIdVariants(row.externalAccountId)));
      let fallbackAccountIds = requestedAccountId ? buildMetaExternalAccountIdVariants(requestedAccountId) : [];

      if (!requestedAccountId) {
        try {
          const configs = await loadMetaIntegrationConfigs();
          fallbackAccountIds = configs
            .filter(
              (config) =>
                config.enabled &&
                config.liveMetaAccountId &&
                (!requestedBusinessId || config.businessManagerId === requestedBusinessId),
            )
            .flatMap((config) => buildMetaExternalAccountIdVariants(config.liveMetaAccountId))
            .filter((accountId) => accountId && !existingAccountIds.has(accountId));
        } catch (configError) {
          console.warn(
            "Meta snapshot config lookup failed; using latest stored snapshots without config filter.",
            configError instanceof Error ? configError.message : configError,
          );
        }
      }

      const fallbackRows =
        fallbackAccountIds.length > 0 || rows.length === 0
          ? await fetchLatestAdsDailySnapshotsBeforeOrOn({
              platformKey: "meta",
              onOrBefore: to!,
              externalAccountIds: fallbackAccountIds.length > 0 ? fallbackAccountIds : undefined,
              externalGroupId: requestedBusinessId || null,
            })
          : [];

      const mergedAccountIds = new Set(rows.flatMap((row) => buildMetaExternalAccountIdVariants(row.externalAccountId)));
      const missingFallbackRows = fallbackRows.filter((row) => {
        const variants = buildMetaExternalAccountIdVariants(row.externalAccountId);
        if (variants.some((accountId) => mergedAccountIds.has(accountId))) return false;
        variants.forEach((accountId) => mergedAccountIds.add(accountId));
        return true;
      });

      rows = [...rows, ...missingFallbackRows];
      servedFrom = missingFallbackRows.length > 0 ? "meta-snapshot-db-with-latest-known" : servedFrom;
      fallbackSnapshotDate = missingFallbackRows[0]?.snapshotDate || null;
    }

    return c.json({
      source: servedFrom,
      range: { from, to },
      rows,
      metadata: {
        rowCount: rows.length,
        lastSyncedAt: getMaxTimestamp(rows),
        servedFrom,
        fallbackSnapshotDate,
      },
    });
  } catch (err: any) {
    console.error("Meta snapshot db error:", err);
    return c.json({ error: err.message || "Unknown error" }, 500);
  }
});

app.post("/make-server-f781cd00/meta/sync-snapshots", async (c) => {
  try {
    if (!isTrustedAdsSchedulerRequest(c)) {
      const auth = await requireAuthorizedRequester(c, [ADS_MANAGE_PERMISSION]);
      if (auth.response) return auth.response;
    }

    if (!META_ACCESS_TOKEN && !META_DM_USER_TOKEN) {
      return c.json({ error: "META_ACCESS_TOKEN atau META_DM_USER_TOKEN belum diatur di server." }, 503);
    }

    const body = await readJsonBody(c);
    const from = typeof body?.from === "string" ? body.from : c.req.query("from");
    const to = typeof body?.to === "string" ? body.to : c.req.query("to");
    const requestedBusinessId =
      typeof body?.businessId === "string" ? body.businessId : c.req.query("businessId");
    const requestedAccountId =
      typeof body?.accountId === "string" ? body.accountId : c.req.query("accountId");
    const requestedAccountName =
      typeof body?.accountName === "string" ? body.accountName : c.req.query("accountName");
    const force = parseBooleanFlag(
      typeof body?.force !== "undefined" ? body.force : c.req.query("force"),
      false,
    );
    const mappedOnly = parseBooleanFlag(
      typeof body?.mappedOnly !== "undefined" ? body.mappedOnly : c.req.query("mappedOnly"),
      false,
    );
    const minFreshMinutes = clampNumber(
      typeof body?.minFreshMinutes !== "undefined"
        ? body.minFreshMinutes
        : c.req.query("minFreshMinutes"),
      10,
      0,
      240,
    );

    if (!isValidDateParam(from) || !isValidDateParam(to)) {
      return c.json({ error: "Parameter from/to wajib format YYYY-MM-DD." }, 400);
    }

    if (diffInDaysInclusive(from!, to!) > 730) {
      return c.json({ error: "Rentang sync maksimal 730 hari per request." }, 400);
    }

    const result = await syncMetaSnapshotRange({
      from: from!,
      to: to!,
      requestedBusinessId: requestedBusinessId || undefined,
      requestedAccountId: requestedAccountId || undefined,
      requestedAccountName: requestedAccountName || undefined,
      force,
      minFreshMinutes,
      mappedOnly,
    });

    let rows = result.rows;
    if (requestedBusinessId) {
      rows = rows.filter((row) => row.externalGroupId === requestedBusinessId);
    }
    if (requestedAccountId) {
      const requestedAccountIdVariants = new Set(buildMetaExternalAccountIdVariants(requestedAccountId));
      rows = rows.filter((row) =>
        buildMetaExternalAccountIdVariants(row.externalAccountId).some((accountId) =>
          requestedAccountIdVariants.has(accountId),
        ),
      );
    }

    return c.json({
      source: "meta-snapshot-sync",
      range: { from, to },
      rows,
      metadata: {
        rowCount: rows.length,
        upsertedCount: result.upsertedCount,
        servedFrom: result.servedFrom,
        skippedSync: result.skippedSync,
        lastSyncedAt: result.latestSyncedAt,
        mappedOnly,
      },
    });
  } catch (err: any) {
    console.error("Meta snapshot sync error:", err);
    return c.json({ error: err.message || "Unknown error" }, 500);
  }
});

app.get("/make-server-f781cd00/meta/token-health", async (c) => {
  try {
    const auth = await requireAuthorizedRequester(c, [MARKETING_MONITORING_VIEW_PERMISSION, ADS_MANAGE_PERMISSION]);
    if (auth.response) return auth.response;

    const debugPayload = await debugMetaToken();
    const tokenData = debugPayload?.data || {};

    return c.json({
      ok: Boolean(tokenData?.is_valid),
      checkedAt: new Date().toISOString(),
      appId: tokenData?.app_id || null,
      type: tokenData?.type || null,
      application: tokenData?.application || null,
      isValid: Boolean(tokenData?.is_valid),
      expiresAt: tokenData?.expires_at || null,
      dataAccessExpiresAt: tokenData?.data_access_expires_at || null,
      scopes: Array.isArray(tokenData?.scopes) ? tokenData.scopes : [],
      granularScopes: Array.isArray(tokenData?.granular_scopes) ? tokenData.granular_scopes : [],
      userId: tokenData?.user_id || null,
      metadata: {
        usesAppSecretProof: Boolean(META_APP_SECRET),
        source: "server",
      },
    });
  } catch (err: any) {
    console.error("Meta token health error:", err);
    return c.json({ error: err.message || "Unknown error" }, 500);
  }
});

app.get("/make-server-f781cd00/meta/integration-configs", async (c) => {
  try {
    const auth = await requireAuthorizedRequester(c, ADS_REFERENCE_READ_PERMISSIONS);
    if (auth.response) return auth.response;

    const configs = await kv.getByPrefix("meta_integration_config:");
    return c.json({ configs });
  } catch (err: any) {
    console.error("Meta integration configs error:", err);
    return c.json({ error: err.message || "Unknown error" }, 500);
  }
});

app.post("/make-server-f781cd00/meta/integration-configs/:adAccountId", async (c) => {
  try {
    const auth = await requireAuthorizedRequester(c, [ADS_MANAGE_PERMISSION]);
    if (auth.response) return auth.response;

    const adAccountId = c.req.param("adAccountId");
    const body = await c.req.json();
    const enabled = Boolean(body?.enabled);
    const businessManagerId =
      typeof body?.businessManagerId === "string" && body.businessManagerId.trim()
        ? body.businessManagerId.trim()
        : undefined;
    const businessManagerName =
      typeof body?.businessManagerName === "string" && body.businessManagerName.trim()
        ? body.businessManagerName.trim()
        : undefined;
    const liveMetaAccountId =
      typeof body?.liveMetaAccountId === "string" && body.liveMetaAccountId.trim()
        ? body.liveMetaAccountId.trim()
        : undefined;
    const liveMetaAccountName =
      typeof body?.liveMetaAccountName === "string" && body.liveMetaAccountName.trim()
        ? body.liveMetaAccountName.trim()
        : undefined;

    const config = {
      adAccountId,
      enabled,
      businessManagerId,
      businessManagerName,
      liveMetaAccountId,
      liveMetaAccountName,
      updatedAt: new Date().toISOString(),
      updatedBy: auth.requester?.authUser.id,
    };

    await kv.set(`meta_integration_config:${adAccountId}`, config);
    return c.json({ success: true, config });
  } catch (err: any) {
    console.error("Save Meta integration config error:", err);
    return c.json({ error: err.message || "Unknown error" }, 500);
  }
});

// Verify Email Route (Basic MX Check)
app.post("/make-server-f781cd00/verify-email", async (c) => {
  const auth = await requireAuthorizedRequester(c, ["users.create", "users.edit"]);
  if (auth.response) return auth.response;

  try {
    const { email } = await c.req.json();
    if (!email || !email.includes('@')) {
      return c.json({ valid: false, reason: "Invalid format" });
    }

    const domain = email.split('@')[1];
    
    // 1. Check for disposable domains (Basic list)
    const disposableDomains = ['tempmail.com', 'throwawaymail.com', 'mailinator.com', 'guerrillamail.com', '10minutemail.com', 'yopmail.com'];
    if (disposableDomains.includes(domain.toLowerCase())) {
        return c.json({ valid: false, reason: "Disposable email detected" });
    }

    // 2. Resolve MX Records using Deno's DNS API
    // This confirms the domain can receive emails.
    try {
        const records = await Deno.resolveDns(domain, "MX");
        if (!records || records.length === 0) {
            return c.json({ valid: false, reason: "Domain has no mail servers (MX records missing)" });
        }
        
        // Success
        return c.json({ 
            valid: true, 
            mxFound: true, 
            provider: records[0].exchange 
        });

    } catch (dnsError) {
        // If DNS lookup fails, the domain likely doesn't exist
        return c.json({ valid: false, reason: "Domain does not exist or has no MX records" });
    }

  } catch (err: any) {
    console.error("Email verification error:", err);
    return c.json({ error: err.message }, 500);
  }
});

// Create User (Admin only)
app.post("/make-server-f781cd00/users", async (c) => {
  try {
    const requester = await getRequesterAccessContext(c.req.raw.headers);
    if (!requester) {
      return c.json({ error: "Unauthorized" }, 401);
    }
    if (!hasEffectivePermission(requester, "users.create")) {
      return c.json({ error: "Forbidden" }, 403);
    }

    const body = await c.req.json();
    const {
      email,
      password,
      name,
      role,
      branchId,
      employmentStatus,
      avatarUrl,
      phone,
      joinDate,
      bankName,
      bankAccountNumber,
      emergencyPhone,
      csWhatsappNumber,
      csDisplayName,
      csAssignmentStatus,
      csMaxActiveChats,
      csNotes,
    } = body;
    const targetRole = typeof role === "string" && role.trim() ? role.trim() : "CS";
    const targetStatus = body?.status === "inactive" ? "inactive" : "active";
    const normalizedCsAssignmentStatus = normalizeCsAssignmentStatusValue(csAssignmentStatus);
    const normalizedCsMaxActiveChats = normalizeCsMaxActiveChatsValue(csMaxActiveChats);

    if (!email || !password) {
      return c.json({ error: "Email and password are required" }, 400);
    }
    if (isOwnerRole(targetRole) && !requester.isOwner) {
      return c.json({ error: "Forbidden: hanya Owner yang dapat membuat akun Owner" }, 403);
    }

    // 1. Create User in Auth
    const { data: authData, error: authError } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true, // Auto confirm
      user_metadata: { name, role: targetRole, branch_id: branchId }
    });

    if (authError) {
      return c.json({ error: authError.message }, 400);
    }

    if (!authData.user) {
      return c.json({ error: "User creation failed" }, 500);
    }

    // 2. Ensure Profile is Created/Updated
    // We use UPSERT to handle cases where the Trigger might be missing or slow.
    const { error: profileError } = await supabase
      .from('profiles')
      .upsert({ 
        id: authData.user.id,
        name,
        email: email, // Store email in profile for easy access
        role: targetRole,
        branch_id: branchId && branchId !== "none_branch" ? branchId : null,
        employment_status: employmentStatus || 'permanent',
        avatar_url: avatarUrl || null,
        phone: phone || null,
        join_date: joinDate || null,
        bank_name: bankName || null,
        bank_account_number: bankAccountNumber || null,
        emergency_phone: emergencyPhone || null,
        cs_whatsapp_number: csWhatsappNumber || null,
        cs_display_name: csDisplayName || null,
        cs_assignment_status: normalizedCsAssignmentStatus,
        cs_max_active_chats: normalizedCsMaxActiveChats,
        cs_notes: csNotes || null,
        status: targetStatus
      });

    if (profileError) {
      console.error("Profile upsert error:", profileError);
      
      // ROLLBACK: Delete the auth user if profile creation fails to prevent inconsistent state
      await supabase.auth.admin.deleteUser(authData.user.id);
      
      return c.json({ 
        error: `Gagal membuat profil pengguna: ${profileError.message}. User Auth dibatalkan.` 
      }, 500);
    }

    // Log Activity
    const actor = requester.actorName;
    // Get IP (simulated or from header)
    const ip = c.req.header('x-forwarded-for') || "127.0.0.1";
    const rhiId = `RHI-${authData.user.id.slice(-4).toUpperCase()}`;
    await logActivity(actor, "Create User", `Created user ${name} (${rhiId}) - Role: ${targetRole}`, ip);

    return c.json({ user: authData.user, message: "User created successfully" });

  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

// Update User (Profile) with permission checks.
app.put("/make-server-f781cd00/users/:id", async (c) => {
  const id = c.req.param("id");

  try {
    const requester = await getRequesterAccessContext(c.req.raw.headers);
    if (!requester) {
      return c.json({ error: "Unauthorized" }, 401);
    }
    if (!hasEffectivePermission(requester, "users.edit")) {
      return c.json({ error: "Forbidden" }, 403);
    }

    const { data: existingProfile, error: profileError } = await supabase
      .from("profiles")
      .select("id, role")
      .eq("id", id)
      .maybeSingle();

    if (profileError) {
      return c.json({ error: profileError.message }, 400);
    }
    if (!existingProfile) {
      return c.json({ error: "User not found" }, 404);
    }
    if (isOwnerRole(existingProfile.role) && !requester.isOwner) {
      return c.json({ error: "Forbidden: hanya Owner yang dapat mengubah akun Owner" }, 403);
    }

    const body = await c.req.json();
    const nextRole = typeof body?.role === "string" && body.role.trim() ? body.role.trim() : existingProfile.role;
    const normalizedCsAssignmentStatus = normalizeCsAssignmentStatusValue(body?.csAssignmentStatus);
    const normalizedCsMaxActiveChats = normalizeCsMaxActiveChatsValue(body?.csMaxActiveChats);
    if (isOwnerRole(nextRole) && !requester.isOwner) {
      return c.json({ error: "Forbidden: hanya Owner yang dapat menetapkan role Owner" }, 403);
    }

    const profilePayload = {
      name: body?.name,
      role: nextRole,
      branch_id:
        !body?.branchId || body.branchId === "none_branch"
          ? null
          : body.branchId,
      status: body?.status,
      phone: body?.phone || null,
      employment_status: body?.employmentStatus || null,
      avatar_url: body?.avatarUrl || null,
      join_date: body?.joinDate || null,
      bank_name: body?.bankName || null,
      bank_account_number: body?.bankAccountNumber || null,
      emergency_phone: body?.emergencyPhone || null,
      cs_whatsapp_number: body?.csWhatsappNumber || null,
      cs_display_name: body?.csDisplayName || null,
      cs_assignment_status: normalizedCsAssignmentStatus,
      cs_max_active_chats: normalizedCsMaxActiveChats,
      cs_notes: body?.csNotes || null,
    };

    const { data: updatedProfile, error: updateError } = await supabase
      .from("profiles")
      .update(profilePayload)
      .eq("id", id)
      .select("*")
      .single();

    if (updateError) {
      return c.json({ error: updateError.message }, 400);
    }

    const metadataUpdate = {
      name: body?.name,
      role: nextRole,
      branch_id: profilePayload.branch_id,
    };

    const actor = requester.actorName;
    const ip = c.req.header("x-forwarded-for") || "127.0.0.1";
    const rhiId = `RHI-${id.slice(-4).toUpperCase()}`;

    runBackgroundTask(
      `sync auth metadata for user ${id}`,
      supabase.auth.admin.updateUserById(id, {
        user_metadata: metadataUpdate,
      }).then(({ error }) => {
        if (error) throw error;
      }),
    );
    runBackgroundTask(
      `log user update ${id}`,
      logActivity(actor, "Update User", `Updated user ${body?.name || rhiId} (${rhiId})`, ip),
    );

    return c.json({ profile: updatedProfile, message: "User updated successfully" });
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

app.delete("/make-server-f781cd00/users/:id", async (c) => {
  const id = c.req.param("id");
  try {
    const requester = await getRequesterAccessContext(c.req.raw.headers);
    if (!requester) {
      return c.json({ error: "Unauthorized" }, 401);
    }
    if (!hasEffectivePermission(requester, "users.delete")) {
      return c.json({ error: "Forbidden" }, 403);
    }
    if (requester.authUser.id === id) {
      return c.json({ error: "Forbidden: akun sendiri tidak dapat dihapus" }, 403);
    }

    const { data: targetProfile } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", id)
      .maybeSingle();
    if (isOwnerRole(targetProfile?.role) && !requester.isOwner) {
      return c.json({ error: "Forbidden: hanya Owner yang dapat menghapus akun Owner" }, 403);
    }

    const { error } = await supabase.auth.admin.deleteUser(id);
    if (error) throw error;
    
    // Also delete from profiles if not cascaded (though it usually should be if FK is set right)
    // Or we just let it be orphan if we want to keep history (but usually we want to delete access)
    
    // Log Activity
    const actor = requester.actorName;
    const ip = c.req.header('x-forwarded-for') || "127.0.0.1";
    const rhiId = `RHI-${id.slice(-4).toUpperCase()}`;
    await logActivity(actor, "Delete User", `Deleted user ${rhiId}`, ip);

    return c.json({ message: "User deleted successfully" });
  } catch (err: any) {
     return c.json({ error: err.message }, 500);
  }
});

// Reset User Password
app.put("/make-server-f781cd00/users/:id/password", async (c) => {
  const id = c.req.param("id");
  try {
    const requester = await getRequesterAccessContext(c.req.raw.headers);
    if (!requester) {
      return c.json({ error: "Unauthorized" }, 401);
    }
    if (!hasEffectivePermission(requester, "users.reset_password")) {
      return c.json({ error: "Forbidden: Insufficient permissions" }, 403);
    }

    const { password } = await c.req.json();
    if (!password || password.length < 6) {
        return c.json({ error: "Password must be at least 6 characters" }, 400);
    }

    const { data: targetProfile } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", id)
      .maybeSingle();
    if (isOwnerRole(targetProfile?.role) && !requester.isOwner) {
        return c.json({ error: "Forbidden: hanya Owner yang dapat mereset password akun Owner" }, 403);
    }

    // Update Password
    const { error: updateError } = await supabase.auth.admin.updateUserById(id, { password });
    
    if (updateError) {
        console.error("Update password error:", updateError);
        throw updateError;
    }

    // Force logout (revoke all active sessions for this user)
    try {
        const { error: signOutError } = await supabase.auth.admin.signOut(id);
        if (signOutError) {
            console.warn(`Warning: Failed to revoke sessions for user ${id}:`, signOutError.message);
        }
    } catch (signOutEx: any) {
        console.warn(`Exception during signOut for user ${id}:`, signOutEx.message);
    }

    // Log Activity
    const actor = requester.actorName;
    const ip = c.req.header('x-forwarded-for') || "127.0.0.1";
    const rhiId = `RHI-${id.slice(-4).toUpperCase()}`;
    await logActivity(actor, "Reset Password", `Reset password for user ${rhiId}`, ip);

    return c.json({ success: true, message: "Password updated successfully" });

  } catch (err: any) {
    const errorMessage = err.message || (typeof err === 'string' ? err : JSON.stringify(err));
    return c.json({ error: errorMessage }, 500);
  }
});

// --- LEADS API ---

// Get All Leads
app.get("/make-server-f781cd00/leads", async (c) => {
  const auth = await requireAuthorizedRequester(c, ["leads.view"]);
  if (auth.response) return auth.response;

  try {
    // Fetch all keys starting with "lead:"
    const leads = await kv.getByPrefix("lead:");
    // Sort by timestamp desc
    leads.sort((a: any, b: any) => new Date(b.timestamp || 0).getTime() - new Date(a.timestamp || 0).getTime());
    return c.json(leads);
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

// Create Lead
app.post("/make-server-f781cd00/leads", async (c) => {
  const auth = await requireAuthorizedRequester(c, ["leads.create"]);
  if (auth.response) return auth.response;

  try {
    const data = await c.req.json();
    if (!data.id) return c.json({ error: "ID is required" }, 400);
    
    const key = `lead:${data.id}`;
    // Add timestamp if missing
    const payload = { ...data, timestamp: data.timestamp || new Date().toISOString() };
    
    await kv.set(key, payload);
    
    // Log
    const actor = auth.requester?.actorName || "System";
    await logActivity(actor, "Create Lead", `Created lead ${data.name} (${data.id})`, "System");
    
    return c.json(payload);
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

// Update Lead
app.put("/make-server-f781cd00/leads/:id", async (c) => {
  const id = c.req.param("id");
  const auth = await requireAuthorizedRequester(c, ["leads.edit"]);
  if (auth.response) return auth.response;

  try {
    const data = await c.req.json();
    const key = `lead:${id}`;
    
    await kv.set(key, data);
    
    return c.json(data);
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

// Delete Lead
app.delete("/make-server-f781cd00/leads/:id", async (c) => {
  const id = c.req.param("id");
  const auth = await requireAuthorizedRequester(c, ["leads.delete"]);
  if (auth.response) return auth.response;

  try {
    const key = `lead:${id}`;
    await kv.del(key);
    
    const actor = auth.requester?.actorName || "System";
    await logActivity(actor, "Delete Lead", `Deleted lead ${id}`, "System");
    
    return c.json({ success: true });
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

// --- ORDERS API ---

// Get All Orders
app.get("/make-server-f781cd00/orders", async (c) => {
  const auth = await requireAuthorizedRequester(c, ["order.view"]);
  if (auth.response) return auth.response;

  try {
    const orders = await kv.getByPrefix("order:");
    // Sort by serviceDate desc
    orders.sort((a: any, b: any) => new Date(b.serviceDate || 0).getTime() - new Date(a.serviceDate || 0).getTime());
    return c.json(orders);
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

// Create Order
app.post("/make-server-f781cd00/orders", async (c) => {
  const auth = await requireAuthorizedRequester(c, ["order.create"]);
  if (auth.response) return auth.response;

  try {
    const data = await c.req.json();
    if (!data.id) return c.json({ error: "ID is required" }, 400);
    
    const key = `order:${data.id}`;
    const payload = { ...data, createdAt: data.createdAt || new Date().toISOString() };
    
    await kv.set(key, payload);
    
    const actor = auth.requester?.actorName || "System";
    await logActivity(actor, "Create Order", `Created order ${data.id} - ${data.customerName}`, "System");
    
    return c.json(payload);
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

// Update Order
app.put("/make-server-f781cd00/orders/:id", async (c) => {
  const id = c.req.param("id");
  const auth = await requireAuthorizedRequester(c, ["order.edit"]);
  if (auth.response) return auth.response;

  try {
    const data = await c.req.json();
    const key = `order:${id}`;
    
    await kv.set(key, data);
    
    return c.json(data);
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

// Delete Order
app.delete("/make-server-f781cd00/orders/:id", async (c) => {
  const id = c.req.param("id");
  const auth = await requireAuthorizedRequester(c, ["order.delete"]);
  if (auth.response) return auth.response;

  try {
    const key = `order:${id}`;
    await kv.del(key);
    
    const actor = auth.requester?.actorName || "System";
    await logActivity(actor, "Delete Order", `Deleted order ${id}`, "System");
    
    return c.json({ success: true });
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

// --- AFFILIATES API ---

// Get All Affiliates
app.get("/make-server-f781cd00/affiliates", async (c) => {
  const auth = await requireAuthorizedRequester(c, ["affiliate.view"]);
  if (auth.response) return auth.response;

  try {
    const affiliates = await kv.getByPrefix("affiliate:");
    // Sort by created_at desc (newest first)
    affiliates.sort((a: any, b: any) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime());
    return c.json(affiliates);
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

// Create Affiliate
app.post("/make-server-f781cd00/affiliates", async (c) => {
  const auth = await requireAuthorizedRequester(c, ["affiliate.manage"]);
  if (auth.response) return auth.response;

  try {
    const data = await c.req.json();
    if (!data.id) return c.json({ error: "ID is required" }, 400);
    
    const key = `affiliate:${data.id}`;
    const payload = { ...data, created_at: data.created_at || new Date().toISOString() };
    
    await kv.set(key, payload);
    
    const actor = auth.requester?.actorName || "System";
    await logActivity(actor, "Create Affiliate", `Created affiliate ${data.nama_lengkap} (${data.id})`, "System");
    
    return c.json(payload);
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

// Update Affiliate
app.put("/make-server-f781cd00/affiliates/:id", async (c) => {
  const id = c.req.param("id");
  const auth = await requireAuthorizedRequester(c, ["affiliate.manage"]);
  if (auth.response) return auth.response;

  try {
    const data = await c.req.json();
    const key = `affiliate:${id}`;
    
    // We should probably check if it exists, but KV upsert is fine
    await kv.set(key, data);
    
    return c.json(data);
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

// Delete Affiliate
app.delete("/make-server-f781cd00/affiliates/:id", async (c) => {
  const id = c.req.param("id");
  const auth = await requireAuthorizedRequester(c, ["affiliate.manage"]);
  if (auth.response) return auth.response;

  try {
    const key = `affiliate:${id}`;
    await kv.del(key);
    
    const actor = auth.requester?.actorName || "System";
    await logActivity(actor, "Delete Affiliate", `Deleted affiliate ${id}`, "System");
    
    return c.json({ success: true });
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

// Get Audit Logs
app.get("/make-server-f781cd00/logs", async (c) => {
  const auth = await requireAuthorizedRequester(c, ["audit_logs.view"]);
  if (auth.response) return auth.response;

  try {
    const logs = await kv.getByPrefix("audit:");
    // Sort descending
    logs.sort((a: any, b: any) => new Date(b.time).getTime() - new Date(a.time).getTime());
    return c.json(logs);
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

// Expand Short URL (e.g. Google Maps)
app.post("/make-server-f781cd00/expand-url", async (c) => {
  let url = "";
  try {
    const auth = await requireAuthorizedRequester(c, MAP_EXPAND_URL_PERMISSIONS);
    if (auth.response) return auth.response;

    ({ url } = await c.req.json());
    if (!url) return c.json({ error: "URL is required" }, 400);

    let parsedUrl: URL;
    try {
      parsedUrl = new URL(url);
    } catch {
      return c.json({ error: "URL tidak valid." }, 400);
    }

    if (!["https:", "http:"].includes(parsedUrl.protocol)) {
      return c.json({ error: "URL harus memakai HTTP atau HTTPS." }, 400);
    }

    const allowedHosts = new Set([
      "goo.gl",
      "bit.ly",
      "maps.app.goo.gl",
      "g.co",
      "google.com",
      "www.google.com",
      "google.co.id",
      "www.google.co.id",
      "maps.google.com",
    ]);
    const normalizedHost = parsedUrl.hostname.toLowerCase();
    const isAllowed = allowedHosts.has(normalizedHost);
    
    if (!isAllowed) {
       // If it's just a raw google maps link that isn't short, just return it
       if (normalizedHost.endsWith(".google.com") && parsedUrl.pathname.includes('/maps')) {
         return c.json({ expandedUrl: url });
       }
       // Otherwise reject generic URLs to prevent abuse
       return c.json({ error: "Only Google Maps URLs are supported" }, 400);
    }

    // Optimization: If it's already a full maps URL, return immediately without fetching
    // This prevents connection errors on long URLs and saves resources
    if (parsedUrl.pathname.includes('/maps/')) {
        return c.json({ expandedUrl: url });
    }

    // Use a browser User-Agent to avoid blocking and ensure redirects work
    const headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9'
    };

    const toCoordinateUrl = (source: string) => {
      const decoded = source.replace(/&amp;/g, "&");
      const coordinate = "(-?\\d+(?:\\.\\d+)?)";
      const candidates = [
        new RegExp(`(?:[?&]center=|@)${coordinate}(?:,|%2C)${coordinate}`),
        new RegExp(`!3d${coordinate}!4d${coordinate}`),
        new RegExp(`!2d${coordinate}!3d${coordinate}`),
      ];

      for (const pattern of candidates) {
        const match = decoded.match(pattern);
        if (!match) continue;

        const first = Number(match[1]);
        const second = Number(match[2]);
        const [lat, lng] = pattern.source.startsWith("!2d")
          ? [second, first]
          : [first, second];

        if (Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180) {
          return `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
        }
      }

      return null;
    };

    try {
        const resp = await fetch(url, { 
            method: 'GET',
            headers,
            redirect: 'follow', // Follow all redirects automatically
        });
        
        // If successful, return the final destination URL
        if (resp.url && resp.url !== url) {
             const finalUrl = new URL(resp.url);
             const finalHost = finalUrl.hostname.toLowerCase();
             const isFinalGoogleMapsUrl =
               allowedHosts.has(finalHost) ||
               (finalHost.endsWith(".google.com") && finalUrl.pathname.includes("/maps"));
             if (!isFinalGoogleMapsUrl) {
               return c.json({ error: "Redirect URL tidak diizinkan." }, 400);
             }

             // Google Maps short links often resolve to a place URL without coordinates.
             // Its HTML still exposes a map center, which lets downstream route features work.
             const coordinatesFromUrl = toCoordinateUrl(resp.url);
             if (coordinatesFromUrl) {
               return c.json({ expandedUrl: coordinatesFromUrl });
             }

             const responseBody = await resp.text();
             const coordinatesFromPage = toCoordinateUrl(responseBody);
             if (coordinatesFromPage) {
               return c.json({ expandedUrl: coordinatesFromPage });
             }

             return c.json({ expandedUrl: resp.url });
        }

    } catch (e: any) {
        // Log generic warning instead of full stack trace for connection resets to reduce noise
        if (e.message?.includes('connection reset') || e.message?.includes('connection error')) {
            console.warn(`URL Expansion connection failed for ${url}: ${e.message}`);
        } else {
            console.error("Fetch error:", e);
        }
    }

    // Force return original if nothing changed
    return c.json({ expandedUrl: url });

  } catch (err: any) {
    console.error("Expand URL error:", err);
    // Graceful fallback: return original
    return c.json({ expandedUrl: url });
  }
});

// --- SHIFTS API ---

// Get Shift
app.get("/make-server-f781cd00/shifts/:userId/:date", async (c) => {
  const userId = c.req.param("userId");
  const date = c.req.param("date"); // yyyy-MM-dd
  const key = `shift:${userId}:${date}`;
  const auth = await requireAuthorizedRequester(c);
  if (auth.response) return auth.response;
  if (!requesterCanReadShift(auth.requester, userId)) {
    return c.json({ error: "Forbidden" }, 403);
  }

  try {
    const shift = await kv.get(key);
    return c.json(shift || null);
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

// Delete Shift
app.delete("/make-server-f781cd00/shifts/:userId/:date", async (c) => {
  const userId = c.req.param("userId");
  const date = c.req.param("date");
  const key = `shift:${userId}:${date}`;
  const auth = await requireAuthorizedRequester(c);
  if (auth.response) return auth.response;
  if (!requesterCanResetShift(auth.requester)) {
    return c.json({ error: "Forbidden" }, 403);
  }

  try {
    await kv.del(key);
    
    // Log Activity
    const actor = auth.requester?.actorName || "System";
    await logActivity(actor, "Reset Shift", `Reset shift for ${userId} on ${date}`, "System");
    
    return c.json({ success: true });
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

// --- SPECIALIZED MOBILE ENDPOINTS (OPTIMIZED) ---

const MOBILE_TECHNICIAN_ORDER_COLUMNS = [
  'id',
  'lead_date',
  'customer_name',
  'customer_phone',
  'address',
  'service_date',
  'service_time',
  'service_id',
  'service_category',
  'maps_url',
  'vehicle_id',
  'price',
  'units',
  'platform_id',
  'sub_channel_id',
  'cs_id',
  'advertiser_id',
  'technician_id',
  'branch_id',
  'area_id',
  'status',
  'payment_type',
  'payment_method_id',
  'income',
  'payment_status',
  'payment_validation',
  'affiliate_name',
  'lat',
  'lng',
  'lead_id',
  'photos',
  'payload',
  'notes',
  'cancel_reason',
  'cancel_reason_note',
  'created_at',
  'start_travel_at',
  'start_work_at',
  'finished_at',
].join(',');

// Get Technician Specific Orders (Server-Side Filtering via Supabase SQL)
app.get("/make-server-f781cd00/mobile/technician-orders/:userId", async (c) => {
  const userId = c.req.param("userId");
  const dateStr = c.req.query("date"); // YYYY-MM-DD
  const auth = await requireAuthorizedRequester(c);
  if (auth.response) return auth.response;
  if (!requesterCanReadTechnicianOrders(auth.requester, userId)) {
    return c.json({ error: "Forbidden" }, 403);
  }
  
  try {
    // 1. Fetch Vehicles Reference (Safely)
    // We do this sequentially to prevent any Promise.all race conditions or unhandled rejections
    let vehiclesMap = new Map();
    
    // Attempt 1: Fetch from SQL 'vehicle_types' table
    try {
        const { data: vData, error: vError } = await supabase
            .from('vehicle_types')
            .select('id, name');
            
        if (!vError && vData) {
            vData.forEach((v: any) => vehiclesMap.set(String(v.id), v.name));
        }
    } catch (e) {
        console.error("SQL Vehicle fetch ignored:", e);
    }

    // Attempt 2: Fetch from KV Store 'vehicle_type' (Master Data)
    try {
        const kvVehicles = await kv.getByPrefix('vehicle_type:');
        if (kvVehicles) {
             kvVehicles.forEach((v: any) => {
                 if (v.id && v.name) vehiclesMap.set(String(v.id), v.name);
             });
        }
    } catch (e) {
        console.error("KV Vehicle fetch error:", e);
    }

    // 2. Fetch Orders directly from SQL Table
    let query = supabase
        .from('orders')
        .select(MOBILE_TECHNICIAN_ORDER_COLUMNS)
        .eq('technician_id', userId);

    if (dateStr) {
       query = query.eq('service_date', dateStr);
    }
    
    // Sort by time
    query = query.order('service_time', { ascending: true });

    const { data: ordersData, error: ordersError } = await query;

    if (ordersError) {
        console.error("Orders Query Error:", ordersError);
        return c.json({ error: ordersError.message }, 500);
    }

    // 3. Normalize Data for Frontend
    const normalizedOrders = (ordersData || []).map((o: any) => ({
        ...o, // Keep original keys
        id: o.id,
        technicianId: o.technician_id,
        serviceDate: o.service_date,
        serviceTime: o.service_time,
        serviceId: o.service_id,
        serviceCategory: o.service_category,
        customerName: o.customer_name,
        customerPhone: o.customer_phone,
        address: o.address,
        vehicleId: o.vehicle_id,
        vehicleType: vehiclesMap.get(String(o.vehicle_id)) || o.kendaraan || o.vehicle_type || 'Unknown',
        price: o.price,
        status: o.status,
        mapsUrl: o.maps_url,
        lat: Number(o.lat || 0),
        lng: Number(o.lng || 0),
        leadId: o.lead_id,
    }));

    return c.json(normalizedOrders);
  } catch (err: any) {
    console.error("Endpoint Error:", err);
    return c.json({ error: err.message }, 500);
  }
});

// Save Shift
app.post("/make-server-f781cd00/shifts", async (c) => {
  const auth = await requireAuthorizedRequester(c);
  if (auth.response) return auth.response;
  try {
    const { userId, date, data } = await c.req.json();
    if (!userId || !date || !data) {
        return c.json({ error: "Missing required fields" }, 400);
    }
    if (!requesterCanWriteShift(auth.requester, String(userId))) {
        return c.json({ error: "Forbidden" }, 403);
    }
    
    const key = `shift:${userId}:${date}`;
    await kv.set(key, data);
    
    // Log Activity (Optional, but good for tracking)
    // const actor = await getActorName(c.req.header('Authorization'));
    // const actionName = data.status === 'active' ? 'Start Shift' : 'End Shift';
    // await logActivity(actor, actionName, `User ${userId} - ${data.status}`, "System");
    
    return c.json({ success: true });
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

// --- TECHNICIAN AVAILABILITY SCHEDULES ---

const TECHNICIAN_SCHEDULE_TYPES = new Set(["Libur", "Sakit", "Cuti", "Izin"]);

app.post("/make-server-f781cd00/technician-schedules", async (c) => {
  const auth = await requireAuthorizedRequester(c, ["technician_schedule.manage"]);
  if (auth.response) return auth.response;

  try {
    const body = await c.req.json();
    const userId = typeof body.userId === "string" ? body.userId.trim() : String(body.user_id || "").trim();
    const date = typeof body.date === "string" ? body.date.trim() : "";
    const type = TECHNICIAN_SCHEDULE_TYPES.has(body.type) ? body.type : "Libur";
    const reason = typeof body.reason === "string" && body.reason.trim() ? body.reason.trim() : type;

    if (!userId || !date) {
      return c.json({ error: "User teknisi dan tanggal wajib diisi." }, 400);
    }

    const { data, error } = await supabase
      .from("technician_schedules")
      .insert({
        user_id: userId,
        date,
        type,
        reason,
      })
      .select()
      .single();

    if (error) throw error;

    const actor = auth.requester?.actorName || "System";
    await logActivity(actor, "Update Ketersediaan Teknisi", `Menambahkan status ${type} untuk teknisi ${userId} pada ${date}`, "System");

    return c.json({ data });
  } catch (err: any) {
    return c.json({ error: err.message || "Gagal menyimpan jadwal teknisi." }, 500);
  }
});

app.delete("/make-server-f781cd00/technician-schedules/:userId/:date", async (c) => {
  const auth = await requireAuthorizedRequester(c, ["technician_schedule.manage"]);
  if (auth.response) return auth.response;

  const userId = c.req.param("userId");
  const date = c.req.param("date");

  try {
    if (!userId || !date) {
      return c.json({ error: "User teknisi dan tanggal wajib diisi." }, 400);
    }

    const { error } = await supabase
      .from("technician_schedules")
      .delete()
      .eq("user_id", userId)
      .eq("date", date);

    if (error) throw error;

    const actor = auth.requester?.actorName || "System";
    await logActivity(actor, "Update Ketersediaan Teknisi", `Menghapus jadwal libur teknisi ${userId} pada ${date}`, "System");

    return c.json({ success: true });
  } catch (err: any) {
    return c.json({ error: err.message || "Gagal menghapus jadwal teknisi." }, 500);
  }
});

// --- MASTER DATA GENERIC API ---

const handleProofAssetUpload = async (c: any) => {
  const auth = await requireAuthorizedRequester(c, [
    "proof_assets.create",
    "proof_assets.edit",
    "recurring_expenses.pay",
  ]);
  if (auth.response) return auth.response;

  try {
    const formData = await c.req.raw.formData();
    const file = formData.get("file");
    if (!(file instanceof File)) {
      return c.json({ error: "File gambar wajib diisi." }, 400);
    }

    const result = await uploadProofAssetFile(file, auth.requester?.authUser.id || "system");
    return c.json(result);
  } catch (err: any) {
    return c.json({ error: err.message || "Gagal upload gambar aset." }, 500);
  }
};

app.post("/make-server-f781cd00/upload-image", handleProofAssetUpload);
app.post("/upload-image", handleProofAssetUpload);

// --- GUARDED APP DATA API (Postgres-backed) ---
registerAppDataRoutes(app, {
  supabase,
  requireAuthorizedRequester,
  logActivity,
  runBackgroundTask,
  assertNoBlockingLeadDuplicate,
  getHttpErrorStatus,
});

// --- EMBED LEAD FORMS API ---

const EMBED_LEAD_FORM_MASTER_TYPE = "embed_lead_form";
const EMBED_LEAD_SUBMISSION_MASTER_TYPE = "embed_lead_form_submission";

function cleanEmbedRecord(value: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(value).filter(([, entryValue]) => typeof entryValue !== "undefined"),
  );
}

function normalizeEmbedAnswer(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function createEmbedClientId() {
  return crypto.randomUUID();
}

function createEmbedLeadShortId() {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let result = "";
  for (let index = 0; index < 7; index += 1) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

function isMissingEmbedSchemaError(error: any) {
  const text = [
    error?.code,
    error?.message,
    error?.details,
    error?.hint,
  ].filter(Boolean).join(" ").toLowerCase();

  return (
    text.includes("pgrst205") ||
    text.includes("42p01") ||
    text.includes("schema cache") ||
    text.includes("could not find the table") ||
    text.includes("embed_lead_forms") ||
    text.includes("embed_lead_form_fields") ||
    text.includes("embed_lead_form_cs_routes") ||
    text.includes("embed_lead_form_submissions")
  );
}

function isEmbedLeadSchemaError(error: any) {
  const text = [
    error?.code,
    error?.message,
    error?.details,
    error?.hint,
  ].filter(Boolean).join(" ").toLowerCase();

  return (
    text.includes("pgrst204") ||
    text.includes("42703") ||
    text.includes("schema cache") ||
    text.includes("could not find") ||
    text.includes("embed_form") ||
    text.includes("service_id") ||
    text.includes("affiliate_id") ||
    text.includes("origin") ||
    text.includes("landing_page_url") ||
    text.includes("utm_")
  );
}

async function loadEmbedLeadFormBundleRows(identifier: string, activeOnly: boolean) {
  const normalizedIdentifier = identifier.trim();
  if (!normalizedIdentifier) return null;

  let query = supabase
    .from("embed_lead_forms")
    .select("*")
    .eq("slug", normalizedIdentifier);
  if (activeOnly) query = query.eq("status", "active");

  let { data: form, error } = await query.maybeSingle();
  if (error) throw error;

  if (!form) {
    let tokenQuery = supabase
      .from("embed_lead_forms")
      .select("*")
      .eq("public_token", normalizedIdentifier);
    if (activeOnly) tokenQuery = tokenQuery.eq("status", "active");

    const tokenResult = await tokenQuery.maybeSingle();
    if (tokenResult.error) throw tokenResult.error;
    form = tokenResult.data;
  }

  if (!form) return null;

  const [fieldsResult, routesResult] = await Promise.all([
    supabase
      .from("embed_lead_form_fields")
      .select("*")
      .eq("form_id", form.id)
      .order("sort_order", { ascending: true }),
    supabase
      .from("embed_lead_form_cs_routes")
      .select("*")
      .eq("form_id", form.id)
      .order("sort_order", { ascending: true }),
  ]);

  if (fieldsResult.error) throw fieldsResult.error;
  if (routesResult.error) throw routesResult.error;

  return {
    form,
    fields: fieldsResult.data || [],
    routes: routesResult.data || [],
  };
}

function isEmbedOriginAllowed(c: any, form: any, body: any) {
  const allowedOrigins: string[] = Array.isArray(form?.allowed_embed_origins)
    ? form.allowed_embed_origins
        .map((value: unknown) => String(value || "").trim())
        .filter((value: string): value is string => Boolean(value))
    : [];
  if (allowedOrigins.length === 0) return true;

  const candidates = [
    c.req.header("origin"),
    c.req.header("referer"),
    body?.landingPageUrl,
    body?.referrerUrl,
  ].filter(Boolean) as string[];

  return candidates.some((candidate) => {
    try {
      const url = new URL(candidate);
      return allowedOrigins.some((allowed) => {
        try {
          const allowedUrl = new URL(allowed);
          return allowedUrl.origin === url.origin;
        } catch {
          return allowed === url.origin || allowed === url.hostname;
        }
      });
    } catch {
      return false;
    }
  });
}

function selectEmbedLeadRoute(form: any, routes: any[]) {
  const activeRoutes = routes
    .filter((route) => route.status === "active" && route.cs_id)
    .sort((left, right) => Number(left.sort_order || 0) - Number(right.sort_order || 0));
  const routeCsIds = activeRoutes.map((route) => String(route.cs_id));
  const fallbackCsId = form.fallback_cs_id || routeCsIds[0] || null;
  const currentCursor = Number(form.round_robin_cursor || 0);

  if (form.routing_mode === "broadcast") {
    return {
      primaryCsId: fallbackCsId,
      routedCsIds: routeCsIds.length > 0 ? routeCsIds : fallbackCsId ? [fallbackCsId] : [],
      nextCursor: currentCursor,
    };
  }

  if (form.routing_mode === "random" && routeCsIds.length > 0) {
    const index = Math.floor(Math.random() * routeCsIds.length);
    return {
      primaryCsId: routeCsIds[index],
      routedCsIds: [routeCsIds[index]],
      nextCursor: currentCursor,
    };
  }

  if (form.routing_mode === "round_robin" && routeCsIds.length > 0) {
    const index = currentCursor % routeCsIds.length;
    return {
      primaryCsId: routeCsIds[index],
      routedCsIds: [routeCsIds[index]],
      nextCursor: currentCursor + 1,
    };
  }

  return {
    primaryCsId: fallbackCsId,
    routedCsIds: fallbackCsId ? [fallbackCsId] : [],
    nextCursor: currentCursor,
  };
}

function legacyEmbedLeadPayload(payload: Record<string, unknown>) {
  return cleanEmbedRecord({
    id: payload.id,
    name: payload.name,
    phone: payload.phone,
    status: payload.status,
    notes: payload.notes,
    platform_id: payload.platform_id,
    sub_channel_id: payload.sub_channel_id,
    advertiser_id: payload.advertiser_id,
    cs_id: payload.cs_id,
    vehicle_id: payload.vehicle_id,
    last_contact: payload.last_contact,
    template_history: payload.template_history,
    social_platform: payload.social_platform,
    social_username: payload.social_username,
    social_profile_url: payload.social_profile_url,
    social_chat_url: payload.social_chat_url,
    created_at: payload.created_at,
  });
}

function minimalEmbedLeadPayload(payload: Record<string, unknown>) {
  return cleanEmbedRecord({
    id: payload.id,
    name: payload.name,
    phone: payload.phone,
    status: payload.status,
    notes: payload.notes,
    platform_id: payload.platform_id,
    sub_channel_id: payload.sub_channel_id,
    advertiser_id: payload.advertiser_id,
    cs_id: payload.cs_id,
    vehicle_id: payload.vehicle_id,
    last_contact: payload.last_contact,
    template_history: payload.template_history,
    created_at: payload.created_at,
  });
}

async function insertEmbedLeadWithSchemaFallback(payload: Record<string, unknown>) {
  await assertNoBlockingLeadDuplicate(payload);

  const fullResult = await supabase.from("leads").insert(payload).select().single();
  if (!fullResult.error) return fullResult.data;
  if (!isEmbedLeadSchemaError(fullResult.error)) throw fullResult.error;

  const legacyResult = await supabase.from("leads").insert(legacyEmbedLeadPayload(payload)).select().single();
  if (!legacyResult.error) return legacyResult.data;
  if (!isEmbedLeadSchemaError(legacyResult.error)) throw legacyResult.error;

  const minimalResult = await supabase.from("leads").insert(minimalEmbedLeadPayload(payload)).select().single();
  if (minimalResult.error) throw minimalResult.error;
  return minimalResult.data;
}

async function listLeadRowsByComparablePhone(comparablePhone: string) {
  const phoneTail = comparablePhone.slice(-9);
  if (!phoneTail) return [] as any[];

  const { data, error } = await supabase
    .from("leads")
    .select("id,name,phone,cs_id,status,created_at")
    .ilike("phone", `%${phoneTail}%`)
    .limit(100);

  if (error) throw error;

  return (data || []).filter(
    (row: any) => normalizeLeadComparablePhone(row?.phone) === comparablePhone,
  );
}

async function resolveLeadDuplicateCsLabels(leads: any[]) {
  const csIds = Array.from(
    new Set(leads.map((lead) => getLeadDuplicateCsId(lead)).filter(Boolean)),
  );
  if (csIds.length === 0) return new Map<string, string>();

  const { data, error } = await supabase
    .from("profiles")
    .select("id,name,email,cs_display_name")
    .in("id", csIds);

  if (error) {
    console.warn("Lead duplicate CS label lookup skipped.", error);
    return new Map<string, string>();
  }

  return new Map(
    (data || []).map((row: any) => [
      String(row.id),
      (typeof row.cs_display_name === "string" && row.cs_display_name.trim()) ||
        (typeof row.name === "string" && row.name.trim()) ||
        (typeof row.email === "string" && row.email.trim()) ||
        "CS",
    ]),
  );
}

async function assertNoBlockingLeadDuplicate(payload: Record<string, unknown>, ignoreId?: string | null) {
  const comparablePhone = normalizeLeadComparablePhone(payload.phone);
  if (!comparablePhone) return;

  const existingLeads = await listLeadRowsByComparablePhone(comparablePhone);
  const duplicateResult = findLeadDuplicates(
    {
      id: typeof payload.id === "string" ? payload.id : null,
      name: typeof payload.name === "string" ? payload.name : null,
      phone: typeof payload.phone === "string" ? payload.phone : null,
      status: typeof payload.status === "string" ? payload.status : null,
      cs_id: typeof payload.cs_id === "string" ? payload.cs_id : null,
    },
    existingLeads,
    { ignoreId },
  );

  if (!duplicateResult.blockingMatch) return;

  const csLabels = await resolveLeadDuplicateCsLabels([
    duplicateResult.blockingMatch,
    ...duplicateResult.phoneMatches,
  ]);
  const message = formatLeadDuplicateWarning(duplicateResult, (csId) => csLabels.get(csId)) ||
    "Nomor dan nama yang sama sudah ada. Simpan diblok agar data prospek tidak double.";
  const error = new Error(message) as Error & { statusCode?: number };
  error.statusCode = 409;
  throw error;
}

function getHttpErrorStatus(error: any, fallback = 500) {
  const status = Number(error?.statusCode || error?.status);
  return Number.isInteger(status) && status >= 400 && status < 600 ? status : fallback;
}

async function createEmbedSubmissionRecord(payload: Record<string, unknown>) {
  try {
    const result = await supabase
      .from("embed_lead_form_submissions")
      .insert(payload)
      .select()
      .single();
    if (result.error) throw result.error;
    return { submission: result.data as Record<string, unknown> & { id: string }, storage: "db" as const };
  } catch (error) {
    if (!isMissingEmbedSchemaError(error)) throw error;

    const now = new Date().toISOString();
    const fallbackSubmission = {
      id: createEmbedClientId(),
      ...payload,
      createdAt: now,
      updatedAt: now,
    };
    await kv.set(`${EMBED_LEAD_SUBMISSION_MASTER_TYPE}:${fallbackSubmission.id}`, fallbackSubmission);
    return { submission: fallbackSubmission, storage: "fallback" as const };
  }
}

async function updateEmbedSubmissionRecord(
  storage: "db" | "fallback",
  submission: Record<string, unknown> & { id: string },
  patch: Record<string, unknown>,
) {
  if (storage === "db") {
    const result = await supabase
      .from("embed_lead_form_submissions")
      .update(patch)
      .eq("id", submission.id);
    if (result.error && !isMissingEmbedSchemaError(result.error)) throw result.error;
    return;
  }

  await kv.set(`${EMBED_LEAD_SUBMISSION_MASTER_TYPE}:${submission.id}`, {
    ...submission,
    ...patch,
    updatedAt: new Date().toISOString(),
  });
}

async function updateEmbedRoutingSnapshot(form: any, route: ReturnType<typeof selectEmbedLeadRoute>) {
  if (form.routing_mode !== "round_robin" && !route.primaryCsId) return;
  const patch = cleanEmbedRecord({
    round_robin_cursor: form.routing_mode === "round_robin" ? route.nextCursor : undefined,
    last_routed_cs_id: route.primaryCsId,
    last_routed_at: route.primaryCsId ? new Date().toISOString() : undefined,
  });
  if (Object.keys(patch).length === 0) return;

  const result = await supabase
    .from("embed_lead_forms")
    .update(patch)
    .eq("id", form.id);
  if (result.error && !isMissingEmbedSchemaError(result.error)) throw result.error;
}

async function loadActivePublicAffiliate(affiliateId: string) {
  const id = String(affiliateId || "").trim();
  if (!id) return null;

  const { data, error } = await supabase
    .from("affiliates")
    .select("id,nama_lengkap,status")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  if (!data || data.status !== "Active") return null;
  return data;
}

app.get("/make-server-f781cd00/public/affiliates/:id", async (c) => {
  try {
    const affiliate = await loadActivePublicAffiliate(c.req.param("id"));
    if (!affiliate) return c.json({ affiliate: null }, 404);

    return c.json({
      affiliate: {
        id: affiliate.id,
        nama_lengkap: affiliate.nama_lengkap,
      },
    });
  } catch (err: any) {
    return c.json({ error: err.message || "Gagal memuat affiliate." }, 500);
  }
});

app.post("/make-server-f781cd00/public/affiliate-bookings", async (c) => {
  try {
    const body = await c.req.json();
    const affiliateId = normalizeEmbedAnswer(body?.affiliateId);
    const customerName = normalizeEmbedAnswer(body?.name);
    const customerPhone = normalizeEmbedAnswer(body?.phone);
    const address = normalizeEmbedAnswer(body?.address);
    const notes = normalizeEmbedAnswer(body?.notes);

    if (!customerName || !customerPhone || !address) {
      return c.json({ error: "Nama, nomor WhatsApp, dan alamat wajib diisi." }, 400);
    }

    const affiliate = affiliateId ? await loadActivePublicAffiliate(affiliateId) : null;
    if (affiliateId && !affiliate) {
      return c.json({ error: "Affiliate tidak ditemukan atau tidak aktif." }, 404);
    }

    const leadNotes = [notes, `Alamat: ${address}`].filter(Boolean).join(" | ");
    const leadPayload = cleanEmbedRecord({
      id: createEmbedLeadShortId(),
      name: customerName,
      phone: customerPhone,
      status: "Pending",
      notes: leadNotes,
      affiliate_id: affiliate?.id || null,
      origin: "affiliate_public_booking",
      landing_page_url: body?.landingPageUrl || null,
      referrer_url: body?.referrerUrl || null,
      user_agent: body?.userAgent || c.req.header("user-agent") || null,
      last_contact: "Baru saja",
      created_at: new Date().toISOString(),
      template_history: [],
    });

    const lead = await insertEmbedLeadWithSchemaFallback(leadPayload);
    return c.json({
      leadId: lead.id,
      affiliateId: affiliate?.id || null,
    });
  } catch (err: any) {
    return c.json({ error: err.message || "Gagal submit booking affiliate." }, getHttpErrorStatus(err));
  }
});

app.get("/make-server-f781cd00/embed/admin/forms", async (c) => {
  const auth = await requireAuthorizedRequester(c, ["leads.view"]);
  if (auth.response) return auth.response;

  try {
    const { data, error } = await supabase
      .from("embed_lead_forms")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) throw error;
    return c.json({ forms: data || [] });
  } catch (err: any) {
    return c.json({ error: err.message || "Gagal memuat embed form." }, 500);
  }
});

app.get("/make-server-f781cd00/embed/admin/forms/:identifier", async (c) => {
  const auth = await requireAuthorizedRequester(c, ["leads.view"]);
  if (auth.response) return auth.response;

  try {
    const bundle = await loadEmbedLeadFormBundleRows(c.req.param("identifier"), false);
    if (!bundle) return c.json({ bundle: null });
    return c.json({ bundle });
  } catch (err: any) {
    return c.json({ error: err.message || "Gagal memuat embed form." }, 500);
  }
});

app.post("/make-server-f781cd00/embed/admin/forms", async (c) => {
  const auth = await requireAuthorizedRequester(c, ["leads.create", "leads.edit"]);
  if (auth.response) return auth.response;

  try {
    const body = await c.req.json();
    const formPayload = {
      ...(body?.form || {}),
      updated_by: auth.requester?.authUser.id || null,
      created_by: body?.form?.created_by || auth.requester?.authUser.id || null,
    };

    const formResult = formPayload.id
      ? await supabase
          .from("embed_lead_forms")
          .update(formPayload)
          .eq("id", formPayload.id)
          .select()
          .single()
      : await supabase
          .from("embed_lead_forms")
          .insert(formPayload)
          .select()
          .single();
    if (formResult.error) throw formResult.error;

    const form = formResult.data;
    const fields = Array.isArray(body?.fields) ? body.fields : [];
    const routes = Array.isArray(body?.routes) ? body.routes : [];

    const deleteFields = await supabase
      .from("embed_lead_form_fields")
      .delete()
      .eq("form_id", form.id);
    if (deleteFields.error) throw deleteFields.error;

    if (fields.length > 0) {
      const insertFields = await supabase
        .from("embed_lead_form_fields")
        .insert(fields.map((field: Record<string, unknown>) => ({ ...field, form_id: form.id })));
      if (insertFields.error) throw insertFields.error;
    }

    const deleteRoutes = await supabase
      .from("embed_lead_form_cs_routes")
      .delete()
      .eq("form_id", form.id);
    if (deleteRoutes.error) throw deleteRoutes.error;

    if (routes.length > 0) {
      const insertRoutes = await supabase
        .from("embed_lead_form_cs_routes")
        .insert(routes.map((route: Record<string, unknown>) => ({ ...route, form_id: form.id })));
      if (insertRoutes.error) throw insertRoutes.error;
    }

    const bundle = await loadEmbedLeadFormBundleRows(form.slug || form.public_token || form.id, false);
    return c.json({ bundle });
  } catch (err: any) {
    return c.json({ error: err.message || "Gagal menyimpan embed form." }, 500);
  }
});

app.delete("/make-server-f781cd00/embed/admin/forms/:id", async (c) => {
  const auth = await requireAuthorizedRequester(c, ["leads.delete"]);
  if (auth.response) return auth.response;

  try {
    const id = c.req.param("id");
    const { error } = await supabase
      .from("embed_lead_forms")
      .delete()
      .eq("id", id);
    if (error) throw error;
    return c.json({ success: true });
  } catch (err: any) {
    return c.json({ error: err.message || "Gagal menghapus embed form." }, 500);
  }
});

app.get("/make-server-f781cd00/embed/public/forms/:identifier", async (c) => {
  try {
    const bundle = await loadEmbedLeadFormBundleRows(c.req.param("identifier"), true);
    if (!bundle) return c.json({ bundle: null }, 404);
    if (!isEmbedOriginAllowed(c, bundle.form, {})) {
      return c.json({ error: "Origin tidak diizinkan untuk form ini." }, 403);
    }
    return c.json({
      bundle: {
        form: bundle.form,
        fields: bundle.fields,
        routes: [],
      },
    });
  } catch (err: any) {
    return c.json({ error: err.message || "Gagal memuat public embed form." }, 500);
  }
});

app.post("/make-server-f781cd00/embed/public/forms/:identifier/submit", async (c) => {
  try {
    const body = await c.req.json();
    const bundle = await loadEmbedLeadFormBundleRows(c.req.param("identifier"), true);
    if (!bundle) return c.json({ error: "Form tidak ditemukan atau tidak aktif." }, 404);
    if (!isEmbedOriginAllowed(c, bundle.form, body)) {
      return c.json({ error: "Origin tidak diizinkan untuk form ini." }, 403);
    }

    const answers = body?.answers || {};
    const customerName = normalizeEmbedAnswer(answers.name);
    const customerPhone = normalizeEmbedAnswer(answers.phone);
    if (!customerName || !customerPhone) {
      return c.json({ error: "Nama customer dan No. WhatsApp wajib diisi." }, 400);
    }

    const form = bundle.form;
    const route = selectEmbedLeadRoute(form, bundle.routes);
    const serviceId = normalizeEmbedAnswer(answers.service_id) || form.default_service_id || null;
    const serviceField = bundle.fields.find((field: any) => field.field_key === "service_id");
    const serviceName =
      (Array.isArray(serviceField?.options)
        ? serviceField.options.find((option: any) => option.value === serviceId)?.label
        : null) ||
      form.default_service_name ||
      null;

    const submissionPayload = cleanEmbedRecord({
      form_id: form.id,
      form_slug: form.slug,
      form_name: form.name,
      public_token: form.public_token,
      customer_name: customerName,
      customer_phone: customerPhone,
      service_id: serviceId,
      service_name: serviceName,
      platform_id: normalizeEmbedAnswer(answers.platform_id) || form.platform_id || null,
      sub_channel_id: normalizeEmbedAnswer(answers.sub_channel_id) || form.sub_channel_id || null,
      advertiser_id: normalizeEmbedAnswer(answers.advertiser_id) || form.advertiser_id || null,
      ad_account_id: form.ad_account_id || null,
      vehicle_id: normalizeEmbedAnswer(answers.vehicle_id) || null,
      affiliate_id: normalizeEmbedAnswer(answers.affiliate_id) || null,
      notes: normalizeEmbedAnswer(answers.notes) || null,
      field_answers: answers,
      raw_payload: {
        answers,
        landingPageUrl: body?.landingPageUrl,
        referrerUrl: body?.referrerUrl,
        submittedAt: new Date().toISOString(),
      },
      tracking_context: body?.trackingContext || {},
      routing_context: {
        routingMode: form.routing_mode,
        fallbackCsId: form.fallback_cs_id,
        activeRouteCount: bundle.routes.filter((item: any) => item.status === "active").length,
      },
      utm_source: body?.utm?.utm_source || null,
      utm_medium: body?.utm?.utm_medium || null,
      utm_campaign: body?.utm?.utm_campaign || null,
      utm_term: body?.utm?.utm_term || null,
      utm_content: body?.utm?.utm_content || null,
      landing_page_url: body?.landingPageUrl || null,
      referrer_url: body?.referrerUrl || null,
      user_agent: body?.userAgent || c.req.header("user-agent") || null,
      status: "received",
      routing_mode: form.routing_mode,
      routed_cs_id: route.primaryCsId,
      routed_cs_ids: route.routedCsIds,
    });

    const { submission, storage } = await createEmbedSubmissionRecord(submissionPayload);

    const leadPayload = cleanEmbedRecord({
      id: createEmbedLeadShortId(),
      name: customerName,
      phone: customerPhone,
      status: form.default_status || "Pending",
      notes: normalizeEmbedAnswer(answers.notes) || null,
      platform_id: normalizeEmbedAnswer(answers.platform_id) || form.platform_id || null,
      sub_channel_id: normalizeEmbedAnswer(answers.sub_channel_id) || form.sub_channel_id || null,
      advertiser_id: normalizeEmbedAnswer(answers.advertiser_id) || form.advertiser_id || null,
      cs_id: route.primaryCsId,
      vehicle_id: normalizeEmbedAnswer(answers.vehicle_id) || null,
      service_id: serviceId,
      affiliate_id: normalizeEmbedAnswer(answers.affiliate_id) || null,
      social_platform: normalizeEmbedAnswer(answers.social_platform) || null,
      social_username: normalizeEmbedAnswer(answers.social_username) || null,
      social_profile_url: normalizeEmbedAnswer(answers.social_profile_url) || null,
      social_chat_url: normalizeEmbedAnswer(answers.social_chat_url) || null,
      embed_form_id: form.id,
      embed_form_submission_id: submission.id,
      embed_form_slug: form.slug,
      embed_form_name: form.name,
      origin: "embed_form",
      landing_page_url: body?.landingPageUrl || null,
      utm_source: body?.utm?.utm_source || null,
      utm_medium: body?.utm?.utm_medium || null,
      utm_campaign: body?.utm?.utm_campaign || null,
      utm_term: body?.utm?.utm_term || null,
      utm_content: body?.utm?.utm_content || null,
      created_at: new Date().toISOString(),
      last_contact: "Baru saja",
      template_history: [],
    });

    try {
      const lead = await insertEmbedLeadWithSchemaFallback(leadPayload);
      await updateEmbedSubmissionRecord(storage, submission, {
        lead_id: lead.id,
        lead_payload: leadPayload,
        status: "lead_created",
        processed_at: new Date().toISOString(),
      });
      await updateEmbedRoutingSnapshot(form, route);

      return c.json({
        submissionId: submission.id,
        leadId: lead.id,
        routedCsIds: route.routedCsIds,
      });
    } catch (error: any) {
      await updateEmbedSubmissionRecord(storage, submission, {
        status: "failed",
        error_message: error?.message || "Gagal membuat Prospek.",
        processed_at: new Date().toISOString(),
      });
      throw error;
    }
  } catch (err: any) {
    return c.json({ error: err.message || "Gagal submit embed form." }, getHttpErrorStatus(err));
  }
});

// Get Master Data by Type
app.get("/make-server-f781cd00/master/:type", async (c) => {
  const type = c.req.param("type");
  const auth = await requireAuthorizedRequester(c, ["master_data.view"]);
  if (auth.response) return auth.response;

  try {
    const items = await kv.getByPrefix(`${type}:`);
    // Generic sort by createdAt if available, else by name
    items.sort((a: any, b: any) => {
        if (a.createdAt && b.createdAt) {
            return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
        }
        return (a.name || "").localeCompare(b.name || "");
    });
    return c.json(items);
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

// Create/Update Master Data Item
app.post("/make-server-f781cd00/master/:type", async (c) => {
  const type = c.req.param("type");
  const auth = await requireAuthorizedRequester(c, ["master_data.create", "master_data.edit"]);
  if (auth.response) return auth.response;

  try {
    const data = await c.req.json();
    if (!data.id) return c.json({ error: "ID is required" }, 400);
    
    const key = `${type}:${data.id}`;
    const payload = { ...data, updatedAt: new Date().toISOString() };
    if (!payload.createdAt) payload.createdAt = new Date().toISOString();

    await kv.set(key, payload);
    
    const actor = auth.requester?.actorName || "System";
    await logActivity(actor, `Update ${type}`, `Updated ${type} ${data.name || data.id}`, "System");
    
    return c.json(payload);
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

// Delete Master Data Item
app.delete("/make-server-f781cd00/master/:type/:id", async (c) => {
  const type = c.req.param("type");
  const id = c.req.param("id");
  const auth = await requireAuthorizedRequester(c, ["master_data.delete"]);
  if (auth.response) return auth.response;

  try {
    const key = `${type}:${id}`;
    await kv.del(key);
    
    const actor = auth.requester?.actorName || "System";
    await logActivity(actor, `Delete ${type}`, `Deleted ${type} ${id}`, "System");
    
    return c.json({ success: true });
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

// --- PERMISSIONS API ---

// Get All Permissions
app.get("/make-server-f781cd00/permissions", async (c) => {
  const auth = await requireAuthorizedRequester(c, ["role_permissions.view"]);
  if (auth.response) return auth.response;

  try {
    // Returns array of { role: string, permissions: string[] }
    const items = await kv.getByPrefix("permission:");
    return c.json(items);
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

// Save Permissions (Batch)
app.post("/make-server-f781cd00/permissions", async (c) => {
  const auth = await requireAuthorizedRequester(c, ["role_permissions.manage"]);
  if (auth.response) return auth.response;

  try {
    const { permissions } = await c.req.json(); // Record<Role, string[]>
    
    if (!permissions) return c.json({ error: "Permissions object required" }, 400);

    // Optimized: Use mset to save all in one transaction/request
    const entries = Object.entries(permissions);
    
    // Convert to proper key-value pairs for mset
    const updates: Record<string, any> = {};
    entries.forEach(([role, perms]) => {
        updates[`permission:${role}`] = { role, permissions: perms };
    });

    await kv.mset(Object.keys(updates), Object.values(updates));

    try {
        const actor = auth.requester?.actorName || "System";
        await logActivity(actor, "Update Permissions", "Updated role permissions", "System");
    } catch (e) {
        console.error("Log activity failed:", e);
    }

    return c.json({ success: true });
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

// --- MANUAL DEBTS API (HYBRID APPROACH) ---

// Get All Manual Debts
app.get("/make-server-f781cd00/manual-debts", async (c) => {
  const auth = await requireAuthorizedRequester(c, ["debts.view", "finance.manage"]);
  if (auth.response) return auth.response;

  try {
    const debts = await kv.getByPrefix("debt:");
    // Sort by created_at desc
    debts.sort((a: any, b: any) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime());
    return c.json(debts);
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

// Create Manual Debt
app.post("/make-server-f781cd00/manual-debts", async (c) => {
  const auth = await requireAuthorizedRequester(c, ["finance.manage"]);
  if (auth.response) return auth.response;

  try {
    const data = await c.req.json();
    if (!data.id) return c.json({ error: "ID is required" }, 400);
    
    const key = `debt:${data.id}`;
    const payload = { ...data, created_at: data.created_at || new Date().toISOString() };
    
    await kv.set(key, payload);
    
    const actor = auth.requester?.actorName || "System";
    await logActivity(actor, "Create Debt", `Created debt for ${data.user_name || 'Unknown'} - ${data.amount}`, "System");
    
    return c.json(payload);
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

// Update Manual Debt (Pay/Settle)
app.put("/make-server-f781cd00/manual-debts/:id", async (c) => {
  const id = c.req.param("id");
  const auth = await requireAuthorizedRequester(c, ["finance.manage"]);
  if (auth.response) return auth.response;

  try {
    const data = await c.req.json();
    const key = `debt:${id}`;
    
    await kv.set(key, data);
    
    const actor = auth.requester?.actorName || "System";
    await logActivity(actor, "Update Debt", `Updated debt ${id} status to ${data.status}`, "System");
    
    return c.json(data);
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

// Delete Manual Debt
app.delete("/make-server-f781cd00/manual-debts/:id", async (c) => {
  const id = c.req.param("id");
  const auth = await requireAuthorizedRequester(c, ["finance.manage"]);
  if (auth.response) return auth.response;

  try {
    const key = `debt:${id}`;
    await kv.del(key);
    
    const actor = auth.requester?.actorName || "System";
    await logActivity(actor, "Delete Debt", `Deleted debt ${id}`, "System");
    
    return c.json({ success: true });
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

// --- USER SPECIFIC PERMISSIONS API ---

// Get User Permissions
app.get("/make-server-f781cd00/permissions/user/:userId", async (c) => {
    const userId = c.req.param("userId");
    const key = `user_permission:${userId}`;
    const auth = await requireAuthorizedRequester(c, ["role_permissions.view"]);
    if (auth.response) return auth.response;
    
    try {
        const perms = await kv.get(key);
        if (!perms) {
            return c.json({ permissions: null }, 404);
        }
        return c.json(perms); // { permissions: [] }
    } catch (err: any) {
        return c.json({ error: err.message }, 500);
    }
});

// Set User Permissions
app.post("/make-server-f781cd00/permissions/user/:userId", async (c) => {
    const userId = c.req.param("userId");
    const auth = await requireAuthorizedRequester(c, ["role_permissions.manage"]);
    if (auth.response) return auth.response;

    try {
        let body;
        try {
            body = await c.req.json();
        } catch (e) {
            return c.json({ error: "Invalid JSON body" }, 400);
        }

        const { permissions } = body; // { permissions: [...] }
        if (!Array.isArray(permissions)) {
            return c.json({ error: "Invalid format: permissions must be an array" }, 400);
        }
        
        const key = `user_permission:${userId}`;
        await kv.set(key, { permissions });

        const actor = auth.requester?.actorName || "System";
        // Wrap log in try-catch to prevent main flow failure
        try {
            await logActivity(actor, "Update User Permissions", `Updated custom permissions for ${userId}`, "System");
        } catch (e) {
            console.error("Log activity failed:", e);
        }
        
        return c.json({ success: true });
    } catch (err: any) {
        console.error("Set user permissions error:", err);
        return c.json({ error: err.message }, 500);
    }
});

// Delete User Permissions (Reset to Role Default)
app.delete("/make-server-f781cd00/permissions/user/:userId", async (c) => {
    const userId = c.req.param("userId");
    const auth = await requireAuthorizedRequester(c, ["role_permissions.manage"]);
    if (auth.response) return auth.response;

    try {
        const key = `user_permission:${userId}`;
        await kv.del(key);
        
        const actor = auth.requester?.actorName || "System";
        try {
            await logActivity(actor, "Reset User Permissions", `Reset permissions for ${userId} to default`, "System");
        } catch (e) {
            console.error("Log activity failed:", e);
        }

        return c.json({ success: true });
    } catch (err: any) {
        return c.json({ error: err.message }, 500);
    }
});

// --- OPERASIONAL TEKNISI (REPORTS) API ---

// Get Reports (Optional Date Filter)
app.get("/make-server-f781cd00/reports", async (c) => {
  try {
    const auth = await requireAuthorizedRequester(c, [DAILY_REPORT_VIEW_PERMISSION, "finance_report.view"]);
    if (auth.response) return auth.response;

    const date = c.req.query("date");
    const reports = await kv.getByPrefix("report:");
    
    if (date) {
        // Filter by date if provided
        const filtered = reports.filter((r: any) => r.date === date);
        return c.json(filtered);
    }
    
    // Sort by date desc
    reports.sort((a: any, b: any) => new Date(b.date || 0).getTime() - new Date(a.date || 0).getTime());
    return c.json(reports);
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

// Create/Update Report
app.post("/make-server-f781cd00/reports", async (c) => {
  try {
    const auth = await requireAuthorizedRequester(c, [DAILY_REPORT_CREATE_PERMISSION, DAILY_REPORT_EDIT_PERMISSION]);
    if (auth.response) return auth.response;

    const data = await c.req.json();
    // ID format: report:YYYY-MM-DD:TECHNICIAN_ID
    // Ensure unique key for Date + Technician
    if (!data.date || !data.technicianId) {
        return c.json({ error: "Date and Technician ID are required" }, 400);
    }
    
    const id = data.id || `${data.date}:${data.technicianId}`;
    const key = `report:${id}`;
    
    const payload = { 
        ...data, 
        id, // Ensure ID is consistent
        updatedAt: new Date().toISOString() 
    };
    
    await kv.set(key, payload);
    
    const actor = auth.requester?.actorName || await getActorName(c.req.header('Authorization'));
    await logActivity(actor, "Save Report", `Saved report for ${data.technicianName} on ${data.date}`, "System");
    
    return c.json(payload);
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

// Delete Report
app.delete("/make-server-f781cd00/reports/:id", async (c) => {
  const id = c.req.param("id");
  try {
    const auth = await requireAuthorizedRequester(c, [DAILY_REPORT_DELETE_PERMISSION]);
    if (auth.response) return auth.response;

    const key = `report:${id}`;
    await kv.del(key);
    
    const actor = auth.requester?.actorName || await getActorName(c.req.header('Authorization'));
    await logActivity(actor, "Delete Report", `Deleted report ${id}`, "System");
    
    return c.json({ success: true });
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

// --- TARGETS API (Monthly by Unit/Service) ---
app.get("/make-server-f781cd00/targets/:month", async (c) => {
    const month = c.req.param("month"); // YYYY-MM
    try {
        const auth = await requireAuthorizedRequester(c, [
          "targets.manage",
          "monitoring.activity_view",
          "monitoring.marketing.view",
          "monitoring.view",
        ]);
        if (auth.response) {
          return auth.response;
        }

        const key = `targets:${month}`;
        const data = await kv.get(key);
        return c.json(data || []);
    } catch (err: any) {
        return c.json({ error: err.message }, 500);
    }
});

app.post("/make-server-f781cd00/targets/:month", async (c) => {
    const month = c.req.param("month");
    try {
        const auth = await requireAuthorizedRequester(c, ["targets.manage"]);
        if (auth.response) {
          return auth.response;
        }

        const { targets } = await c.req.json(); // Array of TargetItem
        const key = `targets:${month}`;
        await kv.set(key, targets);
        
        const actor = auth.requester?.actorName || "System";
        await logActivity(actor, "Update Targets", `Updated targets for ${month}`, "System");

        return c.json({ success: true });
    } catch (err: any) {
        return c.json({ error: err.message }, 500);
    }
});

type CsOkrTargetRecord = {
  id: string;
  month: string;
  csId: string;
  platformId: string | null;
  leadsTarget: number;
  orderTarget: number;
  revenueTarget: number;
  conversionTargetPercent: number;
  responseTargetSeconds: number;
  slaTargetPercent: number;
  spamTargetPercent: number;
  notes: string;
  updatedAt?: string | null;
};

const CS_OKR_MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function normalizeCsOkrMonth(value: string) {
  const month = String(value || "").trim();
  if (!CS_OKR_MONTH_PATTERN.test(month)) {
    throw new Error("Format bulan OKR CS tidak valid.");
  }
  return month;
}

function clampCsOkrNumber(value: unknown, fallback = 0, max = 1_000_000_000_000) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(0, Math.min(max, numeric));
}

function normalizeCsOkrTargetPayload(target: any, month: string): CsOkrTargetRecord {
  const csId = String(target?.csId || target?.cs_id || "").trim();
  if (!UUID_PATTERN.test(csId)) {
    throw new Error("CS target OKR tidak valid.");
  }

  const rawPlatformId = String(target?.platformId || target?.platform_id || "").trim();
  const platformId = rawPlatformId && rawPlatformId !== "all" ? rawPlatformId : null;

  return {
    id: UUID_PATTERN.test(String(target?.id || "")) ? String(target.id) : crypto.randomUUID(),
    month,
    csId,
    platformId,
    leadsTarget: Math.round(clampCsOkrNumber(target?.leadsTarget ?? target?.leads_target)),
    orderTarget: Math.round(clampCsOkrNumber(target?.orderTarget ?? target?.order_target)),
    revenueTarget: Math.round(clampCsOkrNumber(target?.revenueTarget ?? target?.revenue_target)),
    conversionTargetPercent: clampCsOkrNumber(target?.conversionTargetPercent ?? target?.conversion_target_percent, 20, 100),
    responseTargetSeconds: Math.max(1, Math.round(clampCsOkrNumber(target?.responseTargetSeconds ?? target?.response_target_seconds, 600, 86400))),
    slaTargetPercent: clampCsOkrNumber(target?.slaTargetPercent ?? target?.sla_target_percent, 85, 100),
    spamTargetPercent: clampCsOkrNumber(target?.spamTargetPercent ?? target?.spam_target_percent, 10, 100),
    notes: String(target?.notes || "").trim().slice(0, 500),
    updatedAt: typeof target?.updatedAt === "string" ? target.updatedAt : null,
  };
}

function mapCsOkrTargetRow(row: any): CsOkrTargetRecord {
  return {
    id: String(row.id),
    month: String(row.month_key || row.month),
    csId: String(row.cs_id || row.csId),
    platformId: row.platform_id || row.platformId || null,
    leadsTarget: Number(row.leads_target ?? row.leadsTarget) || 0,
    orderTarget: Number(row.order_target ?? row.orderTarget) || 0,
    revenueTarget: Number(row.revenue_target ?? row.revenueTarget) || 0,
    conversionTargetPercent: Number(row.conversion_target_percent ?? row.conversionTargetPercent) || 20,
    responseTargetSeconds: Number(row.response_target_seconds ?? row.responseTargetSeconds) || 600,
    slaTargetPercent: Number(row.sla_target_percent ?? row.slaTargetPercent) || 85,
    spamTargetPercent: Number(row.spam_target_percent ?? row.spamTargetPercent) || 10,
    notes: String(row.notes || ""),
    updatedAt: row.updated_at || row.updatedAt || null,
  };
}

function buildCsOkrTargetDbRow(target: CsOkrTargetRecord, actorId?: string | null) {
  return {
    id: target.id,
    month_key: target.month,
    cs_id: target.csId,
    platform_id: target.platformId,
    leads_target: target.leadsTarget,
    order_target: target.orderTarget,
    revenue_target: target.revenueTarget,
    conversion_target_percent: target.conversionTargetPercent,
    response_target_seconds: target.responseTargetSeconds,
    sla_target_percent: target.slaTargetPercent,
    spam_target_percent: target.spamTargetPercent,
    notes: target.notes,
    updated_by: actorId || null,
    updated_at: new Date().toISOString(),
  };
}

function dedupeCsOkrTargets(targets: CsOkrTargetRecord[]) {
  const byScope = new Map<string, CsOkrTargetRecord>();
  targets.forEach((target) => {
    byScope.set(`${target.month}:${target.csId}:${target.platformId || "all"}`, target);
  });
  return Array.from(byScope.values());
}

function isMissingCsOkrTargetTableError(error: any) {
  const code = String(error?.code || "");
  const message = String(error?.message || "");
  return code === "42P01" || message.includes("cs_okr_targets");
}

async function loadCsOkrTargetsFromDatabase(month: string) {
  const { data, error } = await supabase
    .from("cs_okr_targets")
    .select("*")
    .eq("month_key", month)
    .order("cs_id", { ascending: true })
    .order("platform_id", { ascending: true });

  if (error) throw error;
  return (data || []).map(mapCsOkrTargetRow);
}

async function saveCsOkrTargetsToDatabase(month: string, targets: CsOkrTargetRecord[], actorId?: string | null) {
  const now = new Date().toISOString();
  const rows = targets.map((target) => ({
    ...buildCsOkrTargetDbRow(target, actorId),
    created_by: actorId || null,
    created_at: now,
  }));

  const deleteResult = await supabase
    .from("cs_okr_targets")
    .delete()
    .eq("month_key", month);
  if (deleteResult.error) throw deleteResult.error;

  if (rows.length === 0) return [] as CsOkrTargetRecord[];

  const { data, error } = await supabase
    .from("cs_okr_targets")
    .insert(rows)
    .select("*")
    .order("cs_id", { ascending: true })
    .order("platform_id", { ascending: true });

  if (error) throw error;
  return (data || []).map(mapCsOkrTargetRow);
}

// --- CS OKR TARGETS API (Monthly by CS/Platform) ---
app.get("/make-server-f781cd00/cs-okr-targets/:month", async (c) => {
    try {
        const month = normalizeCsOkrMonth(c.req.param("month"));
        const auth = await requireAuthorizedRequester(c, [CS_OKR_VIEW_PERMISSION]);
        if (auth.response) {
          return auth.response;
        }

        let targets: CsOkrTargetRecord[] = [];
        let source = "database";
        try {
          targets = await loadCsOkrTargetsFromDatabase(month);
        } catch (error) {
          if (!isMissingCsOkrTargetTableError(error)) throw error;
          const key = `cs_okr_targets:${month}`;
          const data = await kv.get(key);
          targets = Array.isArray(data)
            ? data.map((target: any) => mapCsOkrTargetRow({ ...target, month }))
            : [];
          source = "kv";
        }

        const requesterProfileId = auth.requester?.profile?.id || auth.requester?.authUser.id;
        const scopedTargets = auth.requester?.role === "CS"
          ? targets.filter((target) => target.csId === requesterProfileId)
          : targets;
        return c.json({ targets: scopedTargets, source });
    } catch (err: any) {
        return c.json({ error: err.message }, 500);
    }
});

app.post("/make-server-f781cd00/cs-okr-targets/:month", async (c) => {
    try {
        const month = normalizeCsOkrMonth(c.req.param("month"));
        const auth = await requireAuthorizedRequester(c, [CS_OKR_MANAGE_PERMISSION]);
        if (auth.response) {
          return auth.response;
        }

        const body = await c.req.json();
        const rawTargets = Array.isArray(body?.targets) ? body.targets : [];
        const targets = dedupeCsOkrTargets(
          rawTargets.map((target: any) => normalizeCsOkrTargetPayload(target, month)),
        );
        const actorId = auth.requester?.authUser.id || null;
        let savedTargets: CsOkrTargetRecord[] = [];
        let source = "database";

        try {
          savedTargets = await saveCsOkrTargetsToDatabase(month, targets, actorId);
        } catch (error) {
          if (!isMissingCsOkrTargetTableError(error)) throw error;
          const normalizedTargets = targets.map((target) => ({
            ...target,
            updatedAt: new Date().toISOString(),
          }));
          const key = `cs_okr_targets:${month}`;
          await kv.set(key, normalizedTargets);
          savedTargets = normalizedTargets;
          source = "kv";
        }

        const actor = auth.requester?.actorName || "System";
        await logActivity(actor, "Update CS OKR Targets", `Updated CS OKR targets for ${month}`, "System");

        return c.json({ success: true, targets: savedTargets, source });
    } catch (err: any) {
        return c.json({ error: err.message }, 500);
    }
});


// --- STOCK MANAGEMENT API ---

// 1. Get Stock Settings (Service Types & Units)
app.get("/make-server-f781cd00/stock/settings", async (c) => {
    try {
        const auth = await requireAuthorizedRequester(c, ["inventory.view", "stock.settings.manage"]);
        if (auth.response) {
          return auth.response;
        }

        const settings = await kv.get("stock_settings");
        // Default structure if not found
        const defaultSettings = {
            service_types: ["Cuci Reguler", "Detailing", "Coating", "F&B", "Umum"],
            units: ["Pcs", "Liter", "Botol", "Box", "Set", "Kaleng"]
        };
        return c.json(settings || defaultSettings);
    } catch (err: any) {
        return c.json({ error: err.message }, 500);
    }
});

// 2. Save Stock Settings
app.post("/make-server-f781cd00/stock/settings", async (c) => {
    try {
        const auth = await requireAuthorizedRequester(c, ["stock.settings.manage"]);
        if (auth.response) {
          return auth.response;
        }

        const data = await c.req.json();
        await kv.set("stock_settings", data);
        
        const actor = auth.requester?.actorName || "System";
        await logActivity(actor, "Update Stock Settings", "Updated service types or units", "System");
        
        return c.json({ success: true, data });
    } catch (err: any) {
        return c.json({ error: err.message }, 500);
    }
});

// 3. Get All Products
app.get("/make-server-f781cd00/stock/products", async (c) => {
    try {
        const auth = await requireAuthorizedRequester(c, ["inventory.view"]);
        if (auth.response) {
          return auth.response;
        }

        const products = await kv.getByPrefix("stock_product:");
        // Sort by name
        products.sort((a: any, b: any) => (a.name || "").localeCompare(b.name || ""));
        return c.json(products);
    } catch (err: any) {
        return c.json({ error: err.message }, 500);
    }
});

// 4. Create/Update Product (Master Data Only - No Stock Adjustment Here usually, unless initial)
app.post("/make-server-f781cd00/stock/products", async (c) => {
    try {
        const auth = await requireAuthorizedRequester(c, ["inventory.create", "inventory.edit"]);
        if (auth.response) {
          return auth.response;
        }

        const data = await c.req.json();
        if (!data.id) return c.json({ error: "ID is required" }, 400);

        const key = `stock_product:${data.id}`;
        
        // Fetch existing to preserve current_qty and average_cost if not provided (safety)
        const existing = await kv.get(key);
        
        const payload = {
            ...existing, // Keep existing state
            ...data,     // Overwrite with new details
            updatedAt: new Date().toISOString()
        };

        // Ensure defaults
        if (payload.current_qty === undefined) payload.current_qty = 0;
        if (payload.average_cost === undefined) payload.average_cost = 0;

        await kv.set(key, payload);
        
        const actor = auth.requester?.actorName || "System";
        const action = existing ? "Update Product" : "Create Product";
        await logActivity(actor, action, `${action}: ${data.name}`, "System");

        return c.json(payload);
    } catch (err: any) {
        return c.json({ error: err.message }, 500);
    }
});

// 5. Delete Product
app.delete("/make-server-f781cd00/stock/products/:id", async (c) => {
    const id = c.req.param("id");
    try {
        const auth = await requireAuthorizedRequester(c, ["inventory.delete"]);
        if (auth.response) {
          return auth.response;
        }

        const key = `stock_product:${id}`;
        await kv.del(key);
        
        const actor = auth.requester?.actorName || "System";
        await logActivity(actor, "Delete Product", `Deleted product ${id}`, "System");
        
        return c.json({ success: true });
    } catch (err: any) {
        return c.json({ error: err.message }, 500);
    }
});

// 6. Stock Transaction (IN/OUT/ADJUST) - The Core Logic for HPP
app.post("/make-server-f781cd00/stock/transactions", async (c) => {
    try {
        const auth = await requireAuthorizedRequester(c, ["stock.transaction.create"]);
        if (auth.response) {
          return auth.response;
        }

        const { type, productId, quantity, unitPrice, notes, date, relatedId } = await c.req.json();
        
        if (!productId || !quantity || !type) {
            return c.json({ error: "Missing required fields" }, 400);
        }

        const productKey = `stock_product:${productId}`;
        const product = await kv.get(productKey);

        if (!product) {
            return c.json({ error: "Product not found" }, 404);
        }

        const qtyNum = Number(quantity);
        const priceNum = Number(unitPrice || 0);
        let newQty = Number(product.current_qty || 0);
        let newAvgCost = Number(product.average_cost || 0);
        let totalValue = 0;

        // Validation
        if (type === 'OUT' && newQty < qtyNum) {
            // Optional: Allow negative stock? Usually no for accurate HPP.
            // Let's allow it but warn, or block. For now, let's block strict mode.
            // return c.json({ error: "Insufficient stock" }, 400);
        }

        // --- HPP CALCULATION LOGIC ---
        if (type === 'IN') {
            // Weighted Average Cost Formula
            // New Avg = ((Old Qty * Old Avg) + (New Qty * New Price)) / (Old Qty + New Qty)
            
            const oldTotalValue = newQty * newAvgCost;
            const newStockValue = qtyNum * priceNum;
            
            newQty += qtyNum;
            
            if (newQty > 0) {
                newAvgCost = (oldTotalValue + newStockValue) / newQty;
            }
            
            totalValue = newStockValue; // Value of this transaction

        } else if (type === 'OUT') {
            // OUT uses current Average Cost
            totalValue = qtyNum * newAvgCost; // Cost of Goods Sold (COGS)
            newQty -= qtyNum;
            // Average Cost DOES NOT CHANGE on OUT (mathematically)
        } else if (type === 'ADJUST') {
            // Adjustment (Opname) - distinct from IN/OUT
            // If quantity is positive, treated like IN but maybe with 0 cost or current cost?
            // Usually Adjust uses current cost to just fix Qty, OR specific cost if found.
            // Let's assume Adjust updates Qty to a specific value or adds/subtracts?
            // Convention: 'quantity' is the DELTA.
            
            // If we are "finding" items (positive adjust), and we don't know price, we might keep avg cost same?
            // Or if we know the price, we treat like IN.
            // Let's keep Avg Cost same for simplicity unless specified.
            newQty += qtyNum;
            totalValue = qtyNum * newAvgCost;
        }

        // Update Product
        const updatedProduct = {
            ...product,
            current_qty: newQty,
            average_cost: newAvgCost,
            last_updated: new Date().toISOString()
        };

        await kv.set(productKey, updatedProduct);

        // Record Transaction
        const trxId = crypto.randomUUID();
        const trxKey = `stock_trx:${trxId}`;
        const transaction = {
            id: trxId,
            productId,
            productName: product.name, // Snapshot name
            type,
            quantity: qtyNum,
            unitPrice: type === 'IN' ? priceNum : newAvgCost, // Record cost at moment of transaction
            totalValue,
            notes,
            date: date || new Date().toISOString(),
            createdAt: new Date().toISOString(),
            relatedId // Link to Order ID or Invoice ID
        };

        await kv.set(trxKey, transaction);

        const actor = auth.requester?.actorName || "System";
        await logActivity(actor, `Stock ${type}`, `${type} ${qtyNum} ${product.unit || 'pcs'} of ${product.name}`, "System");

        return c.json({ success: true, product: updatedProduct, transaction });

    } catch (err: any) {
        return c.json({ error: err.message }, 500);
    }
});

// 7. Get Stock Transactions
app.get("/make-server-f781cd00/stock/transactions", async (c) => {
    try {
        const auth = await requireAuthorizedRequester(c, ["stock.transaction.view"]);
        if (auth.response) {
          return auth.response;
        }

        const trxs = await kv.getByPrefix("stock_trx:");
        // Sort by date desc
        trxs.sort((a: any, b: any) => new Date(b.date || b.createdAt).getTime() - new Date(a.date || a.createdAt).getTime());
        // Limit to last 500 for performance? Or pagination?
        // Let's return all for now, filter on client
        return c.json(trxs);
    } catch (err: any) {
        return c.json({ error: err.message }, 500);
    }
});

Deno.serve(app.fetch);
