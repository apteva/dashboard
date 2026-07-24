import type { ChatTimelineItem } from "./toolActivityModel";

function isToolItem(item: ChatTimelineItem | undefined): boolean {
  return item?.kind === "tool" || item?.kind === "toolGroup";
}

/**
 * Visual spacing between transcript rows.
 *
 * Agent messages reserve the same 42px minimum height as the Thinking and
 * streaming placeholders so those rows replace each other without jumping.
 * A one-line message is centered inside that slot, which creates extra visual
 * whitespace beneath the text. Tighten only the following tool row to balance
 * its perceived gap with the answer that follows it.
 */
export function chatTimelineMarginClass(
  item: ChatTimelineItem,
  previous: ChatTimelineItem | undefined,
): string {
  if (!previous) return "mt-0";

  if (item.kind === "message") {
    if (item.compactBefore) return "mt-1.5";
    return isToolItem(previous) ? "mt-2" : "mt-4";
  }

  if (isToolItem(item)) {
    if (previous.kind === "message" && previous.message.role === "user") return "mt-4";
    if (previous.kind === "message" && previous.message.role === "agent") return "mt-1";
    return "mt-2";
  }

  return "mt-0";
}
