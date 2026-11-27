/**
 * Small, host-owned contract shared by native and app-provided widgets.
 *
 * This deliberately describes the current UI selection only. It is not a
 * second resource model and it does not introduce a new server-side entity.
 * App widgets may ignore it and continue using their existing props.
 */
import { normalizeProjectColor } from "../projects/projectColor";

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

/** A project as widgets see it. */
export interface WidgetProject {
  id: string;
  name: string;
  /**
   * The colour chosen in Project Settings, as lower-case #rgb or #rrggbb, or
   * "" when none. How to show it (a dot, an edge, a chart series) is up to
   * the app.
   */
  color: string;
}

export interface WidgetContext {
  /** Read-only rendering of an unsaved configuration, distinct from sample previews. */
  configurationPreview?: boolean;
  /** Host-selected foreground pane; ordinary canvas widgets are never foreground. */
  hostForeground?: boolean;
  presentation?: "canvas" | "workspace";
  projectId?: string;
  pageId?: string;
  scope: "project" | "global";
  /**
   * Projects this widget may show, with their colours. A global widget gets
   * every project the viewer can open; a project widget gets only its own.
   */
  projects?: WidgetProject[];
  agentId?: number;
  threadId?: string;
  selected?: WidgetResourceRef;
  activityId?: string;
  preview?: WidgetPreview;
}

/**
 * Projects a widget may show. A global widget sees every project the viewer
 * can open; a project widget sees only its own, matching the platform rule
 * that project-scoped installs cannot list sibling projects.
 */
export function widgetProjects(
  projects: readonly { id: string; name: string; color?: string | null }[],
  scope: WidgetContext["scope"],
  projectId?: string,
): WidgetProject[] {
  const visible = scope === "global" ? projects : projects.filter((project) => project.id === projectId);
  return visible.map((project) => ({ id: project.id, name: project.name, color: normalizeProjectColor(project.color) }));
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
