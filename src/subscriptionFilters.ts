export interface SubscriptionFilterDraft {
  field: string;
  value: string;
}

export type SubscriptionFilterValue = string | number | boolean | null;

function parseValue(raw: string, declaredType?: string): SubscriptionFilterValue {
  const value = raw.trim();
  const type = (declaredType || "").toLowerCase();

  if (type === "boolean" || type === "bool") {
    if (value === "true") return true;
    if (value === "false") return false;
  }
  if (type === "integer" || type === "number" || type === "float") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  // Array declarations generally do not carry an item type in current app
  // manifests. Parse obvious primitive identifiers so list_ids=2 is sent as a
  // number, while ordinary slugs remain strings.
  if (type === "array") {
    if (/^-?(?:\d+|\d*\.\d+)$/.test(value)) return Number(value);
    if (value === "true") return true;
    if (value === "false") return false;
    if (value === "null") return null;
  }
  return value;
}

export function serializeSubscriptionFilters(
  drafts: SubscriptionFilterDraft[],
  declaredTypes: Record<string, string> = {},
): Record<string, SubscriptionFilterValue> {
  const filters: Record<string, SubscriptionFilterValue> = {};
  for (const draft of drafts) {
    const field = draft.field.trim();
    if (!field || !draft.value.trim()) continue;
    filters[field] = parseValue(draft.value, declaredTypes[field]);
  }
  return filters;
}
