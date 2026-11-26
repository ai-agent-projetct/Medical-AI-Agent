// Field-level diff of a document write, for the change history in auditLogs (pure, unit-tested).
const IGNORE = new Set(['updatedBy', 'updatedAt', 'createdAt', 'callKey', 'whatsappSentAt', 'whatsappMessageId', 'whatsappError']);

/** Printable value: timestamps as ISO, objects as JSON, long values cut to 120 chars. */
export function show(v) {
  if (v === undefined || v === null) return '';
  if (typeof v?.toDate === 'function') return v.toDate().toISOString();
  const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
  return s.length > 120 ? `${s.slice(0, 117)}…` : s;
}

/**
 * Audit entry for before → after (either may be undefined), or null when nothing that matters changed
 * (bookkeeping fields only). The actor is the writer's updatedBy, which firestore.rules force to be the writer.
 */
export function auditEntry(before, after, module, docPath) {
  const changes = {};
  for (const k of new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})])) {
    if (IGNORE.has(k)) continue;
    const from = show(before?.[k]);
    const to = show(after?.[k]);
    if (from !== to) changes[k] = { from, to };
  }
  const keys = Object.keys(changes);
  if (!keys.length) return null;
  const action = !before ? 'Created' : !after ? 'Deleted' : 'Updated';
  const label = after?.name ?? after?.patient ?? after?.number ?? before?.name ?? before?.patient ?? before?.number ?? docPath.split('/').pop();
  const details = action === 'Updated'
    ? `${label}: ${keys.slice(0, 6).map((k) => `${k} "${changes[k].from}" → "${changes[k].to}"`).join('; ')}${keys.length > 6 ? ` (+${keys.length - 6} more)` : ''}`
    : `${action} ${label}`;
  return {
    uid: (after ? after.updatedBy : null) ?? (after ? 'system' : 'unknown'),
    action, module, docPath, details, changes,
    hospitalId: after?.hospitalId ?? before?.hospitalId ?? undefined,
  };
}
