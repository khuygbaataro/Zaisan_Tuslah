// Per-PSID in-memory list of pending change descriptions the trainer has accumulated.
// Cleared on apply (success) or when the trainer types "clear". Survives turns of the
// same chat but is wiped on server restart — that's fine because the trainer can
// re-issue any unsaved instructions from chat history.
export interface PendingChange {
  description: string;
  addedAt: Date;
}

const store = new Map<string, PendingChange[]>();

export function list(psid: string): PendingChange[] {
  return store.get(psid) ?? [];
}

export function add(psid: string, description: string): number {
  const existing = store.get(psid) ?? [];
  existing.push({ description, addedAt: new Date() });
  store.set(psid, existing);
  return existing.length;
}

export function clear(psid: string): void {
  store.delete(psid);
}

export function format(psid: string): string {
  const items = list(psid);
  if (!items.length) return "(хоосон — одоохондоо хүлээгдэж буй засвар алга байна)";
  return items
    .map((c, i) => `${i + 1}. ${c.description}`)
    .join("\n");
}
