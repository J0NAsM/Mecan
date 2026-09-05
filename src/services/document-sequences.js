// Must run inside the same write transaction as the document insertion.
export async function allocateNumber(db, tenantId, kind, legacyTable = null) {
  if (legacyTable && !['work_orders', 'workshop_invoices'].includes(legacyTable))
    throw new Error('Numerador no permitido');
  if (
    !(await db
      .prepare('SELECT 1 FROM document_sequences WHERE tenant_id=? AND kind=?')
      .get(tenantId, kind))
  ) {
    const initial = legacyTable
      ? Number(
          (
            await db
              .prepare(
                `SELECT COALESCE(MAX(number),0)+1 value FROM ${legacyTable} WHERE tenant_id=?`,
              )
              .get(tenantId)
          ).value,
        )
      : 1;
    await db
      .prepare('INSERT INTO document_sequences (tenant_id,kind,next_value) VALUES (?,?,?)')
      .run(tenantId, kind, initial);
  }
  return Number(
    (
      await db
        .prepare(
          'UPDATE document_sequences SET next_value=next_value+1 WHERE tenant_id=? AND kind=? RETURNING next_value-1 value',
        )
        .get(tenantId, kind)
    ).value,
  );
}
