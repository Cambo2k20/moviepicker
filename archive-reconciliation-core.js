const PAGE_SIZE = 500;

async function fetchAllRpcRows(client, functionName, args, order) {
  const rows = [];
  for (let start = 0; ; start += PAGE_SIZE) {
    let query = client.rpc(functionName, args);
    for (const [column, ascending] of order) {
      query = query.order(column, { ascending });
    }
    const { data, error } = await query.range(start, start + PAGE_SIZE - 1);
    if (error) throw error;
    if (!Array.isArray(data)) throw new Error(`${functionName} returned an invalid page.`);
    rows.push(...data);
    if (data.length < PAGE_SIZE) return rows;
  }
}

export function fetchArchiveHistoryPreview(client, groupId) {
  return fetchAllRpcRows(client, "preview_archive_history_reconciliation", { p_group_id: groupId }, [
    ["entry_label", false],
    ["archive_entry_id", true],
  ]);
}

export function fetchArchiveHistoryCandidates(client, groupId) {
  return fetchAllRpcRows(client, "get_archive_history_match_candidates", {
    p_group_id: groupId,
    p_archive_entry_ids: null,
  }, [
    ["archive_entry_id", true],
    ["candidate_rank", true],
    ["tmdb_id", true],
  ]);
}
