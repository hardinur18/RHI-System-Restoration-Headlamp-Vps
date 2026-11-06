// Rule-based approved case retrieval.
// Source of truth: AI_CS_SYSTEM_BLUEPRINT.md §7.3, §13, §30 task 20.

import type { SalesStage } from "./lead_completeness.ts";
import { normalizeStage } from "./next_best_close.ts";

export interface RetrieveApprovedCasesRequest {
  stage: SalesStage | string;
  objection_id?: string | null;
  vehicle_type?: string | null;
  area_tier?: "core_full" | "workshop_plus_mobile" | "conditional" | string | null;
  top_k?: number | null;
}

export interface ApprovedCaseSnippet {
  snippet_id: string;
  content: string;
  stage: SalesStage | string;
  objection_id: string | null;
  vehicle_type?: string | null;
  area_tier?: string | null;
  approved_by: string;
  approved_at: string;
  source_conversation_hash: string;
  revoked_at: string | null;
}

export interface RetrieveApprovedCasesOutput {
  snippets: ApprovedCaseSnippet[];
  total_candidates_before_cap: number;
}

const MAX_TOP_K = 3;
const MAX_CONTENT_CHARS = 400;

export function retrieveApprovedSimilarCases(
  request: RetrieveApprovedCasesRequest,
  library: ApprovedCaseSnippet[],
): RetrieveApprovedCasesOutput {
  const topK = Math.min(Math.max(Number(request.top_k || 2), 1), MAX_TOP_K);
  const stage = normalizeStage(request.stage);
  const candidates = library
    .filter((snippet) => !snippet.revoked_at)
    .filter((snippet) => normalizeStage(snippet.stage) === stage)
    .filter((snippet) =>
      !request.objection_id || snippet.objection_id === request.objection_id
    )
    .filter((snippet) =>
      !request.vehicle_type ||
      !snippet.vehicle_type ||
      snippet.vehicle_type === request.vehicle_type
    )
    .filter((snippet) =>
      !request.area_tier || !snippet.area_tier ||
      snippet.area_tier === request.area_tier
    )
    .sort((a, b) => Date.parse(b.approved_at) - Date.parse(a.approved_at));

  return {
    snippets: candidates.slice(0, topK).map(scrubSnippet),
    total_candidates_before_cap: candidates.length,
  };
}

export function scrubApprovedCaseContent(content: string): string {
  return content
    .replace(/\+?62[\d\s-]{7,}\d/g, "[nomor disamarkan]")
    .replace(/\b0\d[\d\s-]{7,}\d\b/g, "[nomor disamarkan]")
    .replace(/\b[A-Z]{1,2}\s?\d{1,4}\s?[A-Z]{1,3}\b/gi, "[plat disamarkan]")
    .replace(/\b(?:Jl\.?|Jalan|Gang|Gg\.?|Cluster|Blok)\s+[^,.]{3,80}/gi, "[alamat disamarkan]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_CONTENT_CHARS);
}

function scrubSnippet(snippet: ApprovedCaseSnippet): ApprovedCaseSnippet {
  return {
    ...snippet,
    content: scrubApprovedCaseContent(snippet.content),
  };
}
