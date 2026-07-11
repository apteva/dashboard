import { useEffect, useState } from "react";

/** Reactive media-query match used when responsive behavior must affect work,
 * not just presentation (for example, whether an SSE-backed panel mounts). */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => (
    typeof window !== "undefined" ? window.matchMedia(query).matches : false
  ));

  useEffect(() => {
    const media = window.matchMedia(query);
    const update = () => setMatches(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, [query]);

  return matches;
}
