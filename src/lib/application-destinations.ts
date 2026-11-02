import type { SupabaseClient } from "@supabase/supabase-js";

export type ApplicationDestination = { group_id: string; group_position: string; sites: string[]; owners: string[]; doc_ids: string[] };
export type ApplicationDestinationPage = { items: ApplicationDestination[]; has_more: boolean; next_cursor: { group_id: string } | null };

/** Loads only destinations admitted by the existing guarded destination RPC. */
export async function fetchApplicationDestinations(client: SupabaseClient, input: { search?: string; afterGroupId?: string | null; limit?: 50 | 100 }): Promise<ApplicationDestinationPage> {
  const limit = input.limit ?? 50;
  const { data, error } = await client.rpc("app_application_destinations_page_v1", {
    p_search: input.search ?? "", p_after_group_id: input.afterGroupId ?? null, p_limit: limit
  });
  if (error) throw new Error(error.message);
  const result = data as Partial<ApplicationDestinationPage> | null;
  if (!result || !Array.isArray(result.items) || result.items.length > limit || typeof result.has_more !== "boolean") throw new Error("Application destinations returned an invalid response");
  if (result.items.some(row => !row || typeof row.group_id !== "string" || typeof row.group_position !== "string" || !Array.isArray(row.sites) || !Array.isArray(row.owners) || !Array.isArray(row.doc_ids))) throw new Error("Application destinations returned an invalid row");
  if (result.has_more && (!result.next_cursor || typeof result.next_cursor.group_id !== "string")) throw new Error("Application destinations returned an invalid cursor");
  if (!result.has_more && result.next_cursor !== null) throw new Error("Application destinations returned an invalid terminal cursor");
  return result as ApplicationDestinationPage;
}
