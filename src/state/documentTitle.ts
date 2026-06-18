type TitleInput = string | Array<string | number | null | undefined | false>;

const BRAND = "Apteva";

let pageTitle = "";
let titleToken: symbol | null = null;
let unreadCount = 0;

function cleanPart(value: string | number | null | undefined | false): string {
  if (value === false || value == null) return "";
  return String(value).replace(/\s+/g, " ").trim();
}

export function formatPageTitle(input: TitleInput): string {
  if (Array.isArray(input)) {
    const parts = input.map(cleanPart).filter(Boolean);
    if (parts.length === 0) return "";
    if (parts.length === 1) return parts[0];
    return `${parts[0]}: ${parts.slice(1).join(" - ")}`;
  }
  return cleanPart(input);
}

function applyDocumentTitle(): void {
  const base = pageTitle ? `${pageTitle} - ${BRAND}` : BRAND;
  const prefix = unreadCount > 0 ? `(${unreadCount > 99 ? "99+" : unreadCount}) ` : "";
  document.title = `${prefix}${base}`;
}

export function setPageTitleForToken(token: symbol, input: TitleInput): void {
  titleToken = token;
  pageTitle = formatPageTitle(input);
  applyDocumentTitle();
}

export function clearPageTitleForToken(token: symbol): void {
  if (titleToken !== token) return;
  titleToken = null;
  pageTitle = "";
  applyDocumentTitle();
}

export function setUnreadTitleCount(count: number): void {
  unreadCount = Math.max(0, Math.floor(count || 0));
  applyDocumentTitle();
}
