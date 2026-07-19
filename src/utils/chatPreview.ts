/** Convert a Markdown chat message into compact, readable plain text for
 * sidebars, switchers, notifications, and other one-line previews. The full
 * transcript remains Markdown-rendered; previews intentionally avoid HTML. */
export function chatPreviewText(markdown: string): string {
  return markdown
    .replace(/```(?:[^\n]*)\n?/g, " ")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/^\s*>\s?/gm, "")
    .replace(/^\s*(?:[-+*]|\d+[.)])\s+/gm, "")
    .replace(/(?:\*\*|__|~~)/g, "")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/(^|[^\w])_([^_\n]+)_(?!\w)/g, "$1$2")
    .replace(/\\([\\`*_[\]{}()#+\-.!>])/g, "$1")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
