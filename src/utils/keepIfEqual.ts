/** Returns `previous` when `next` serializes the same, so a reload that
 * brings back identical data keeps object identity and React skips the
 * memos, effects and redraws that depend on it. */
export function keepIfEqual<T>(previous: T, next: T): T {
  if (previous === next) return previous;
  try {
    return JSON.stringify(previous) === JSON.stringify(next) ? previous : next;
  } catch {
    return next;
  }
}
