/**
 * A project's colour as lower-case #rgb or #rrggbb, or "" when none was
 * chosen or the stored value is anything else. The server stores the colour
 * as given, so it is checked before it reaches a style.
 */
export function normalizeProjectColor(raw: unknown): string {
  if (typeof raw !== "string") return "";
  const color = raw.trim().toLowerCase();
  return /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/.test(color) ? color : "";
}
