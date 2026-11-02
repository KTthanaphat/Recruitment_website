/** Reject a cursor page that claims another page exists after returning fewer than the requested limit. */
export function assertFullContinuationPage(hasMore: boolean, rowCount: number, pageSize: number, label: string) {
  if (hasMore && rowCount !== pageSize) throw new Error(`${label} export is incomplete; retry`);
}
