import type { SupabaseClient } from "@supabase/supabase-js";

export type OfferCandidateOption = { candidate_id: string; application_id: string; name: string; group_position: string; doc_ids: string[] };
export type OfferCandidateCursor = { candidate_id: string; application_id: string };
export type OfferCandidatePage = { items: OfferCandidateOption[]; has_more: boolean; next_cursor: OfferCandidateCursor | null };

export async function fetchOfferCandidates(client: SupabaseClient, input: { search?: string; cursor?: OfferCandidateCursor | null; limit?: 50 | 100 }): Promise<OfferCandidatePage> {
  const limit = input.limit ?? 50;
  const { data, error } = await client.rpc("app_offer_candidates_page_v1", {
    p_search: input.search ?? "",
    p_after_candidate_id: input.cursor?.candidate_id ?? null,
    p_after_application_id: input.cursor?.application_id ?? null,
    p_limit: limit,
  });
  if (error) throw new Error(error.message);
  const result = data as Partial<OfferCandidatePage> | null;
  if (!result || !Array.isArray(result.items) || result.items.length > limit || typeof result.has_more !== "boolean") throw new Error("Offer candidate options returned an invalid response");
  if (result.items.some(row => !row || typeof row.candidate_id !== "string" || typeof row.application_id !== "string" || typeof row.name !== "string" || typeof row.group_position !== "string" || !Array.isArray(row.doc_ids) || row.doc_ids.some(id => typeof id !== "string"))) throw new Error("Offer candidate options returned an invalid row");
  if (result.has_more && (!result.next_cursor || typeof result.next_cursor.candidate_id !== "string" || typeof result.next_cursor.application_id !== "string")) throw new Error("Offer candidate options returned an invalid cursor");
  if (!result.has_more && result.next_cursor !== null) throw new Error("Offer candidate options returned an invalid terminal cursor");
  return result as OfferCandidatePage;
}
