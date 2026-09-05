export async function pagedRows(db, req, sql, args, columns, { key = 'list', size = 50 } = {}) {
  const url = new URL(req.url, 'http://local'),
    queryKey = key + '_q',
    pageKey = key + '_page';
  const query = String(url.searchParams.get(queryKey) || '')
      .trim()
      .slice(0, 150),
    raw = Number(url.searchParams.get(pageKey) || 1),
    page = Number.isInteger(raw) ? Math.max(1, Math.min(raw, 100000)) : 1;
  const like = '%' + query.replace(/[\\%_]/g, '\\$&') + '%';
  const where =
    query && columns.length
      ? ' WHERE ' +
        columns.map((column) => `CAST("${column}" AS TEXT) ILIKE ? ESCAPE '\\'`).join(' OR ')
      : '';
  const rows = await db
    .prepare(`SELECT * FROM (${sql})${where} LIMIT ? OFFSET ?`)
    .all(...args, ...(where ? columns.map(() => like) : []), size + 1, (page - 1) * size);
  const next = rows.length > size;
  if (next) rows.pop();
  const pageUrl = (value) => {
    const copy = new URL(url);
    copy.searchParams.set(pageKey, String(value));
    return copy.pathname + copy.search;
  };
  rows.pagination = {
    query,
    queryKey,
    pageKey,
    page,
    next,
    previousUrl: pageUrl(page - 1),
    nextUrl: pageUrl(page + 1),
    path: url.pathname,
  };
  return rows;
}
