/**
 * Small, host-owned contract shared by native and app-provided widgets.
 *
 * This deliberately describes the current UI selection only. It is not a
 * second resource model and it does not introduce a new server-side entity.
 * App widgets may ignore it and continue using their existing props.
 */
export type WidgetResourceType = "agent" | "app" | "integration" | "skill" | "mcp" | "process" | "thread" | "page";

export interface WidgetResourceRef {
  type: WidgetResourceType;
  id: string | number;
  label?: string;
  projectId?: string;
  agentId?: number;
}

/** Transient, user-selected output. Never saved in page preferences. */
export interface WidgetPreview {
  title: string;
  text?: string;
  data?: unknown;
  resource?: WidgetResourceRef;
  component?: { app: string; name: string; props?: Record<string, unknown>; installId: number };
}

export interface WidgetContext {
  presentation?: "canvas" | "workspace";
  projectId?: string;
  pageId?: string;
  scope: "project" | "global";
  agentId?: number;
  threadId?: string;
  selected?: WidgetResourceRef;
  activityId?: string;
  preview?: WidgetPreview;
}

export type WidgetAction =
  | { type: "select"; resource: WidgetResourceRef }
  | { type: "clear_selection" }
  | { type: "select_activity"; id: string; resource: WidgetResourceRef }
  | { type: "preview"; preview: WidgetPreview }
  | { type: "open"; resource: WidgetResourceRef }
  | { type: "configure"; resource: WidgetResourceRef }
  | { type: "run"; resource?: WidgetResourceRef; input?: unknown }
  | { type: "retry"; resource?: WidgetResourceRef }
  | { type: "ask_helper"; prompt?: string };

export interface WidgetActionBridge {
  dispatch(action: WidgetAction): void;
  select(resource: WidgetResourceRef): void;
}

export interface WidgetRenderContext {
  context: WidgetContext;
  actions: WidgetActionBridge;
}

export const WIDGET_ACTION_EVENT = "apteva:widget-action";

/** Publish an action for hosts that render a widget outside WidgetCanvas. */
export function emitWidgetAction(action: WidgetAction): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(WIDGET_ACTION_EVENT, { detail: action }));
}

export function createWidgetActionBridge(
  onAction?: (action: WidgetAction) => void,
): WidgetActionBridge {
  const dispatch = (action: WidgetAction) => {
    onAction?.(action);
    emitWidgetAction(action);
  };
  return {
    dispatch,
    select: (resource) => dispatch({ type: "select", resource }),
  };
}
