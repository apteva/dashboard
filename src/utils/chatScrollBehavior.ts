export function shouldPinChatBottom(
  chatId: string | null,
  historyReady: boolean,
  initiallyPinnedChatId: string | null,
  followingLatest: boolean,
): boolean {
  if (!chatId) return false;
  // The first complete history render for a selected conversation always opens
  // at the newest content. After that, normal stick-to-bottom behavior respects
  // a user who deliberately scrolls upward.
  if (historyReady && initiallyPinnedChatId !== chatId) return true;
  return followingLatest;
}

/**
 * Keep content-driven layout changes separate from user scroll intent.
 *
 * Lazy chat widgets can replace a tiny Suspense fallback with a much taller
 * card. Browser scroll anchoring may increase (or preserve) scrollTop while
 * leaving the viewport temporarily far from the new bottom. That must keep
 * follow mode enabled so the transcript ResizeObserver can finish the pin.
 *
 * A genuine upward scroll decreases scrollTop. Reaching the bottom again
 * always restores follow mode.
 */
export function nextChatBottomFollowState(
  followingLatest: boolean,
  previousScrollTop: number,
  scrollTop: number,
  distanceFromBottom: number,
  bottomThreshold = 60,
): boolean {
  if (distanceFromBottom < bottomThreshold) return true;
  if (!followingLatest) return false;
  return scrollTop >= previousScrollTop - 1;
}
