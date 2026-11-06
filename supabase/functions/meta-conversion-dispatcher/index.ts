const supabaseUrl = Deno.env.get("SUPABASE_URL")?.replace(/\/$/, "") || "";
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const dispatchToken = Deno.env.get("META_CONVERSION_DISPATCH_TOKEN") || "";
const capiAccessToken =
  Deno.env.get("META_CAPI_ACCESS_TOKEN") || Deno.env.get("META_ACCESS_TOKEN") || "";
const graphVersion = Deno.env.get("META_GRAPH_VERSION") || "v25.0";
const appSecret = Deno.env.get("META_APP_SECRET") || "";

type JsonRecord = Record<string, unknown>;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function configured(): JsonRecord {
  return {
    supabase: Boolean(supabaseUrl && serviceRoleKey),
    dispatchToken: Boolean(dispatchToken),
    capiAccessToken: Boolean(capiAccessToken),
    appSecretProof: Boolean(appSecret),
    graphVersion,
  };
}

async function rpc<T>(name: string, body: JsonRecord): Promise<T> {
  const response = await fetch(`${supabaseUrl}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: {
      apikey: serviceRoleKey,
      authorization: `Bearer ${serviceRoleKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`RPC ${name} failed (${response.status}): ${text.slice(0, 500)}`);
  }
  return (text ? JSON.parse(text) : null) as T;
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function hmacSha256Hex(secret: string, value: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
  return Array.from(new Uint8Array(signature), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function normalizePhone(raw: unknown): string | null {
  let digits = String(raw || "").replace(/\D/g, "");
  if (!digits) return null;
  if (digits.startsWith("0")) digits = `62${digits.slice(1)}`;
  else if (digits.startsWith("8")) digits = `62${digits}`;
  return digits.startsWith("62") && digits.length >= 10 ? digits : null;
}

function normalizeMatchText(raw: unknown): string | null {
  const value = String(raw || "")
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-z0-9]/g, "");
  return value || null;
}

function splitCustomerName(raw: unknown): { first: string | null; last: string | null } {
  const parts = String(raw || "").trim().split(/\s+/).filter(Boolean);
  return {
    first: normalizeMatchText(parts[0]),
    last: parts.length > 1 ? normalizeMatchText(parts[parts.length - 1]) : null,
  };
}

function eventTimestamp(row: JsonRecord): number | null {
  const raw = row.finished_at || row.event_created_at;
  const millis = Date.parse(String(raw || ""));
  if (!Number.isFinite(millis)) return null;
  return Math.min(Math.floor(millis / 1000), Math.floor(Date.now() / 1000));
}

function transientMetaFailure(httpStatus: number, response: JsonRecord): boolean {
  const error = response.error && typeof response.error === "object"
    ? response.error as JsonRecord
    : {};
  const code = Number(error.code || 0);
  return httpStatus === 429 || httpStatus >= 500 || error.is_transient === true ||
    [1, 2, 4, 17, 32, 613].includes(code);
}

async function finalize(
  id: string,
  status: "sent" | "failed" | "blocked" | "skipped",
  payload: JsonRecord | null,
  metaResponse: JsonRecord | null,
  errorMessage: string | null,
  retryDelaySeconds = 0,
): Promise<void> {
  await rpc("finalize_meta_conversion_event", {
    p_id: id,
    p_status: status,
    p_payload: payload,
    p_meta_response: metaResponse,
    p_error_message: errorMessage,
    p_retry_delay_seconds: retryDelaySeconds,
  });
}

async function sendEvent(row: JsonRecord): Promise<JsonRecord> {
  const id = String(row.event_row_id);
  const eventTime = eventTimestamp(row);
  const eventAgeSeconds = eventTime ? Math.floor(Date.now() / 1000) - eventTime : null;
  if (!eventTime || eventAgeSeconds === null || eventAgeSeconds < -300 || eventAgeSeconds > 601200) {
    await finalize(id, "skipped", null, null, "expired_or_invalid_event_time");
    return { id, eventId: row.event_id, status: "skipped", reason: "event_time" };
  }

  const wabaId = String(row.waba_id || "");
  const ctwaClid = String(row.ctwa_clid || "");
  const datasetId = String(row.dataset_id || "");
  const matchMode = String(row.match_mode || "ctwa");
  const phone = normalizePhone(row.customer_phone);
  const isPhoneOnly = matchMode === "phone_only";
  if (!datasetId || (isPhoneOnly ? !phone : (!wabaId || !ctwaClid))) {
    await finalize(id, "blocked", null, null, "missing_attribution_or_dataset");
    return { id, eventId: row.event_id, status: "blocked", reason: "mapping" };
  }

  const userData: JsonRecord = {};
  if (!isPhoneOnly) {
    userData.ctwa_clid = ctwaClid;
    userData.whatsapp_business_account_id = wabaId;
  }
  if (phone) userData.ph = [await sha256(phone)];
  const customerName = splitCustomerName(row.customer_name);
  if (customerName.first) userData.fn = [await sha256(customerName.first)];
  if (customerName.last) userData.ln = [await sha256(customerName.last)];
  const customerCity = normalizeMatchText(row.customer_city);
  if (customerCity) userData.ct = [await sha256(customerCity)];
  userData.country = [await sha256("id")];
  const leadId = String(row.lead_id || "").trim();
  if (leadId) userData.external_id = [await sha256(leadId.toLowerCase())];

  const event: JsonRecord = {
    event_name: String(row.event_name || "Purchase"),
    event_time: eventTime,
    event_id: String(row.event_id),
    action_source: isPhoneOnly ? "chat" : "business_messaging",
    ...(!isPhoneOnly ? { messaging_channel: "whatsapp" } : {}),
    user_data: userData,
    custom_data: {
      currency: String(row.currency || "IDR"),
      value: Number(row.value || 0),
      order_id: String(row.order_id || ""),
      lead_id: leadId || undefined,
      branch_id: row.branch_id ? String(row.branch_id) : undefined,
      attribution_mode: matchMode,
      content_name: "Polesheadlamp.id - Nano Burn Coating",
    },
  };
  const payload: JsonRecord = { data: [event] };

  const url = new URL(`https://graph.facebook.com/${graphVersion}/${datasetId}/events`);
  if (appSecret) {
    url.searchParams.set("appsecret_proof", await hmacSha256Hex(appSecret, capiAccessToken));
  }
  const response = await fetch(url, {
    method: "POST",
    headers: {
      authorization: `Bearer ${capiAccessToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  const text = await response.text();
  let metaResponse: JsonRecord;
  try {
    metaResponse = text ? JSON.parse(text) : {};
  } catch {
    metaResponse = { unparsed_response: text.slice(0, 1000) };
  }

  if (response.ok && Number(metaResponse.events_received || 0) >= 1) {
    await finalize(id, "sent", payload, metaResponse, null);
    return {
      id,
      eventId: row.event_id,
      datasetId,
      matchMode,
      status: "sent",
      eventsReceived: Number(metaResponse.events_received),
    };
  }

  const error = metaResponse.error && typeof metaResponse.error === "object"
    ? metaResponse.error as JsonRecord
    : {};
  const errorMessage = String(error.message || `Meta HTTP ${response.status}`).slice(0, 500);
  const attempts = Number(row.attempts || 1);
  if (transientMetaFailure(response.status, metaResponse) && attempts < 6) {
    const retryDelay = Math.min(3600, 60 * 2 ** Math.max(0, attempts - 1));
    await finalize(id, "failed", payload, metaResponse, errorMessage, retryDelay);
    return { id, eventId: row.event_id, status: "retry", retryDelay };
  }

  await finalize(id, "blocked", payload, metaResponse, errorMessage);
  return { id, eventId: row.event_id, status: "blocked", reason: errorMessage };
}

Deno.serve(async (request) => {
  if (request.method !== "POST") return jsonResponse({ error: "method_not_allowed" }, 405);

  const suppliedToken = request.headers.get("x-dispatch-token") || "";
  if (!dispatchToken || suppliedToken !== dispatchToken) {
    return jsonResponse({ error: "unauthorized" }, 401);
  }

  if (!supabaseUrl || !serviceRoleKey || !capiAccessToken) {
    return jsonResponse({ error: "missing_runtime_configuration", configured: configured() }, 503);
  }

  let input: JsonRecord = {};
  try {
    input = await request.json();
  } catch {
    input = {};
  }

  if (input.mode === "health") {
    const queue = await rpc<JsonRecord>("meta_conversion_queue_health", {});
    return jsonResponse({ ok: true, configured: configured(), queue });
  }

  const requestedLimit = Math.floor(Number(input.limit || 20));
  const limit = Math.max(1, Math.min(50, Number.isFinite(requestedLimit) ? requestedLimit : 20));
  const maintenance = await rpc<JsonRecord>("prepare_meta_conversion_queue", {});
  const requestedAdAccountId = String(input.ad_account_id || "").trim();
  const rows = await rpc<JsonRecord[]>("claim_meta_conversion_events", {
    p_limit: limit,
    p_ad_account_id: requestedAdAccountId || null,
  });
  const results: JsonRecord[] = [];
  for (const row of rows || []) {
    try {
      results.push(await sendEvent(row));
    } catch (error) {
      const id = String(row.event_row_id || "");
      const message = error instanceof Error ? error.message.slice(0, 500) : "unexpected_dispatch_error";
      if (id) {
        try {
          await finalize(id, "failed", null, null, message, 300);
        } catch {
          // A stale processing row is recovered by prepare_meta_conversion_queue.
        }
      }
      results.push({ id, eventId: row.event_id, status: "error", reason: message });
    }
  }

  return jsonResponse({
    ok: true,
    maintenance,
    claimed: rows?.length || 0,
    results,
  });
});
