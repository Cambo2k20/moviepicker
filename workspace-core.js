function asError(value) {
  if (value instanceof Error) return value;
  if (value && typeof value.message === "string") return value;
  return new Error(String(value || "Unknown optional workspace error"));
}

/**
 * Resolve data that is useful to one feature but must not abort the shared
 * workspace. Supabase normally resolves query failures as `{ data, error }`,
 * but the extra catch also contains transport and client failures.
 */
export async function settleOptionalQuery(query, mapData = (data) => data) {
  try {
    const result = await query;
    if (result?.error) return { data: [], error: asError(result.error) };
    return { data: mapData(result?.data || []), error: null };
  } catch (error) {
    return { data: [], error: asError(error) };
  }
}
