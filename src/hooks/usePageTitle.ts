import { useEffect, useMemo, useRef } from "react";
import {
  clearPageTitleForToken,
  formatPageTitle,
  setPageTitleForToken,
} from "../state/documentTitle";

type TitleInput = string | Array<string | number | null | undefined | false>;

export function usePageTitle(input: TitleInput): void {
  const tokenRef = useRef<symbol | null>(null);
  if (!tokenRef.current) tokenRef.current = Symbol("page-title");

  const title = useMemo(() => formatPageTitle(input), [input]);

  useEffect(() => {
    const token = tokenRef.current!;
    setPageTitleForToken(token, title);
    return () => clearPageTitleForToken(token);
  }, [title]);
}
