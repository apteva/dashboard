import { useEffect, useSyncExternalStore } from "react";
import { useLocation } from "react-router-dom";

export interface AssistantPageContext {
  version: 1;
  page: "dashboard" | "app" | "agent" | "apps" | "settings";
  project_id: string;
  project_name?: string;
  app?: string;
  installation_id?: number;
  panel?: string;
  viewed_agent_id?: number;
  viewed_agent_name?: string;
  thread_id?: string;
  tab?: string;
}
type Details = Pick<AssistantPageContext, "app" | "installation_id" | "panel" | "viewed_agent_id" | "viewed_agent_name" | "thread_id" | "tab">;
let selection: { project: string; route: string; details: Details } | null = null;
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };

// Only first-party page components publish an explicit allowlist of identifiers.
// No DOM scraping, arbitrary app props, form state, or raw URL/query is copied.
export function useAssistantPageDetails(project: string, details: Details) {
  const { pathname } = useLocation();
  const signature = JSON.stringify(details);
  useEffect(() => {
    const value = { project, route: pathname, details: JSON.parse(signature) };
    selection = value; listeners.forEach(fn => fn());
    return () => { if (selection === value) { selection = null; listeners.forEach(fn => fn()); } };
  }, [project, pathname, signature]);
}
const safe = (value?: string) => value && value.length <= 200 && !/[\u0000-\u001f\u007f]/.test(value) ? value : undefined;
export function describeAssistantPage(pathname: string, search: string, projectId: string, projectName?: string, details: Details = {}): AssistantPageContext | undefined {
  if (!projectId) return;
  const base = { version: 1 as const, project_id: projectId, project_name: safe(projectName) };
  if (pathname === "/") return { ...base, page: "dashboard" };
  const app = pathname.match(/^\/apps\/([a-z0-9-]+)\/page\/?$/);
  if (app) return { ...base, page: "app", app: app[1], ...(details.app === app[1] ? { installation_id: details.installation_id, panel: safe(details.panel) } : {}) };
  const agent = pathname.match(/^\/(?:agents|instances)\/(\d+)\/?$/);
  if (agent) {
    const id = Number(agent[1]);
    return { ...base, page: "agent", viewed_agent_id: id, ...(details.viewed_agent_id === id ? { viewed_agent_name: safe(details.viewed_agent_name), thread_id: safe(details.thread_id), tab: safe(details.tab) } : {}) };
  }
  if (pathname === "/apps") return { ...base, page: "apps", app: safe(details.app), installation_id: details.installation_id };
  if (pathname === "/settings") {
    const tab = details.tab || new URLSearchParams(search).get("tab") || "projects";
    // Only known section identifiers, never arbitrary query values.
    const allowed = ["projects","presets","chat-assistant","helper","interface","appearance","providers","mcp","subscriptions","api-keys","data","account","server","users"];
    return { ...base, page: "settings", tab: allowed.includes(tab) ? tab : undefined };
  }
}
export function useAssistantPageContext(projectId: string, projectName?: string) {
  const location = useLocation();
  const current = useSyncExternalStore(subscribe, () => selection, () => null);
  const details = current?.project === projectId && current.route === location.pathname ? current.details : {};
  return describeAssistantPage(location.pathname, location.search, projectId, projectName, details);
}

export type SetupCategory = "personal" | "business" | "work" | "development";
export type SetupInterfaceLevel = "personal" | "business" | "developer";
const SETUP_CATEGORIES: SetupCategory[] = ["personal", "business", "work", "development"];
const SETUP_INTERFACE_LEVELS: SetupInterfaceLevel[] = ["personal", "business", "developer"];
const SETUP_PANEL_LIMIT = 200;

// PROBE — carries workspace-setup context using only fields the Conversations
// app already accepts, so nothing there has to change to try this.
//
// cleanPageContext restricts `page` to a closed set but validates the string
// fields only for length and control characters. On page="app" the fields
// app/installation_id/panel survive stripping, so `panel` is the carrier.
// This is a stand-in, not a design: it is capped at 200 characters and the
// context chip reads "workspace-setup app". A real `setup` page with typed
// fields requires the change in apps/mcp/conversations.
export function describeSetupPage(
  projectId: string,
  draft: { category?: string; preset_id?: string; description?: string; interface_level?: string },
  projectName?: string,
): AssistantPageContext | undefined {
  if (!projectId) return;
  const category = SETUP_CATEGORIES.includes(draft.category as SetupCategory) ? draft.category : undefined;
  const level = SETUP_INTERFACE_LEVELS.includes(draft.interface_level as SetupInterfaceLevel) ? draft.interface_level : undefined;
  const parts = [
    "stage=workspace_setup",
    category && `category=${category}`,
    draft.preset_id && `preset=${draft.preset_id}`,
    level && `level=${level}`,
    draft.description?.trim() && `goal=${draft.description.trim()}`,
  ].filter(Boolean) as string[];
  const panel = parts.join("; ").replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, SETUP_PANEL_LIMIT);
  return { version: 1, page: "app", project_id: projectId, project_name: safe(projectName), app: "workspace-setup", panel };
}
