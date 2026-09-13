import type { ComponentType } from "react";
import { usePanelEvents } from "../../hooks/usePanelEvents";
import type { NativePanelProps } from "./nativePanels";

export function LiveAppPanel({ component: Panel, ...props }: NativePanelProps & { component: ComponentType<NativePanelProps> }) {
  const events = usePanelEvents(props.appName, props.projectId, props.installId);
  return <Panel {...props} {...events} />;
}
