import { useCallback, useState } from "react";

/** Canvas reports are scoped during render, never reset by a parent effect.
 * A parent reset would overwrite the child's initial effect on cached layouts. */
export function useWidgetVisibility(scope: string) {
  const [report, setReport] = useState<{ scope: string; components: string[] }>();
  const onVisibleChange = useCallback((components: string[]) => {
    setReport(current => current?.scope === scope && current.components.length === components.length && current.components.every((key, i) => key === components[i])
      ? current : { scope, components });
  }, [scope]);
  return {
    components: report?.scope === scope ? report.components : [],
    reported: report?.scope === scope,
    onVisibleChange,
  };
}
