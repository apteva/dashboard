function parseJSONIfPossible(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  if (!trimmed || !["{", "["].includes(trimmed[0])) return value;
  try {
    return JSON.parse(trimmed);
  } catch {
    return value;
  }
}

function sanitizeToolPayload(value: unknown, depth = 0): unknown {
  const parsed = parseJSONIfPossible(value);
  if (parsed == null) return parsed;
  if (typeof parsed === "string") {
    if (parsed.length > 400) return `${parsed.slice(0, 400)}… (${parsed.length.toLocaleString()} chars)`;
    return parsed;
  }
  if (typeof parsed !== "object") return parsed;
  if (depth > 5) return "[nested object]";
  if (Array.isArray(parsed)) {
    const items = parsed.slice(0, 20).map((item) => sanitizeToolPayload(item, depth + 1));
    return parsed.length > 20 ? [...items, `… ${parsed.length - 20} more items`] : items;
  }

  const obj = parsed as Record<string, unknown>;
  if (obj._binary === true) return "[binary payload]";
  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(obj)) {
    const lower = key.toLowerCase();
    if (
      lower.includes("base64") ||
      lower.includes("screenshot") ||
      lower.includes("image") ||
      lower.includes("audio") ||
      lower.includes("blob")
    ) {
      if (typeof val === "string") {
        out[key] = `[${val.length.toLocaleString()} chars omitted]`;
      } else if (val && typeof val === "object") {
        out[key] = sanitizeToolPayload(val, depth + 1);
      } else {
        out[key] = val;
      }
      continue;
    }
    out[key] = sanitizeToolPayload(val, depth + 1);
  }
  return out;
}

export function formatToolPayload(value: unknown, max = 5000): string {
  if (value === undefined) return "";
  let text: string;
  const sanitized = sanitizeToolPayload(value);
  if (typeof sanitized === "string") {
    text = sanitized;
  } else {
    try {
      text = JSON.stringify(sanitized, null, 2);
    } catch {
      text = String(sanitized);
    }
  }
  if (text.length > max) return `${text.slice(0, max)}\n… (${text.length.toLocaleString()} chars total)`;
  return text;
}
