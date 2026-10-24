import { useEffect, useState } from "react";
import type { SettingValue } from "./widgetSettings";
export interface DiscoveryOption {
  value: SettingValue;
  label: string;
}
export function pluckList(data: unknown, path: string): unknown[] {
  let current = data;
  for (const part of path.split(".").filter(Boolean)) {
    if (current === null || typeof current !== "object") return [];
    current = (current as Record<string, unknown>)[part];
  }
  return current == null ? [] : Array.isArray(current) ? current : [current];
}
export function pluckField(item: unknown, field: string): string {
  const value =
    field && item !== null && typeof item === "object"
      ? (item as Record<string, unknown>)[field]
      : typeof item === "string"
        ? item
        : undefined;
  return ["string", "boolean", "number"].includes(typeof value)
    ? String(value)
    : "";
}
export function discoveryURL(
  app: string,
  route: string,
  installId?: number,
  projectId?: string,
  query: Record<string, SettingValue> = {},
) {
  if (
    !route.startsWith("/") ||
    route.startsWith("//") ||
    /[\\?#\r\n]/.test(route) ||
    route.split("/").some((p) => p === ".." || p === ".") ||
    /%/i.test(route)
  )
    throw new Error("Invalid app discovery route");
  const target = new URL(
    `/api/apps/${encodeURIComponent(app)}${route}`,
    window.location.origin,
  );
  for (const [key, value] of Object.entries(query)) {
    if (
      [
        "install_id",
        "project_id",
        "api_key",
        "file_auth",
        "file_agent",
        "mcp_token",
      ].includes(key.toLowerCase())
    )
      throw new Error("Discovery cannot override host scope");
    target.searchParams.set(key, String(value));
  }
  if (installId) target.searchParams.set("install_id", String(installId));
  if (projectId) target.searchParams.set("project_id", projectId);
  return target.pathname + target.search;
}
export function useAppDiscovery({
  app,
  route,
  installId,
  projectId,
  query = {},
  responsePath = "",
  valueField = "",
  labelField = "",
  enabled = true,
  maxOptions,
}: {
  app?: string;
  route?: string;
  installId?: number;
  projectId?: string;
  query?: Record<string, SettingValue>;
  responsePath?: string;
  valueField?: string;
  labelField?: string;
  enabled?: boolean;
  maxOptions?: number;
}) {
  const [revision, retry] = useState(0);
  const key = JSON.stringify([
    app,
    route,
    installId,
    projectId,
    query,
    responsePath,
    valueField,
    labelField,
    enabled,
    maxOptions,
    revision,
  ]);
  const [state, setState] = useState<{
    key: string;
    options: DiscoveryOption[];
    error: string;
    loading: boolean;
  }>({ key: "", options: [], error: "", loading: false });
  useEffect(() => {
    if (!enabled || !app || !route) return;
    const abort = new AbortController();
    let active = true;
    setState({ key, options: [], error: "", loading: true });
    let timeout: ReturnType<typeof setTimeout>;
    void (async () => {
      try {
        const url = discoveryURL(app, route, installId, projectId, query);
        timeout = setTimeout(() => abort.abort(), 15000);
        const response = await fetch(url, {
          credentials: "same-origin",
          signal: abort.signal,
        });
        if (!response.ok)
          throw new Error(`Could not load options (HTTP ${response.status})`);
        const data = await response.json();
        const items = pluckList(data, responsePath);
        if (maxOptions !== undefined && items.length > maxOptions)
          throw new Error("Too many options; narrow the selection first");
        const options = items.flatMap((item) => {
          const value =
            valueField && item !== null && typeof item === "object"
              ? (item as Record<string, unknown>)[valueField]
              : item;
          if (!["string", "number", "boolean"].includes(typeof value))
            return [];
          return [
            {
              value: value as SettingValue,
              label: pluckField(item, labelField) || String(value),
            },
          ];
        });
        if (active) setState({ key, options, error: "", loading: false });
      } catch (error) {
        if (active)
          setState({
            key,
            options: [],
            error: abort.signal.aborted
              ? "Option lookup timed out"
              : error instanceof Error
                ? error.message
                : "Could not load options",
            loading: false,
          });
      } finally {
        clearTimeout(timeout!);
      }
    })();
    return () => {
      active = false;
      abort.abort();
      clearTimeout(timeout!);
    };
  }, [key]);
  return {
    options: state.key === key ? state.options : [],
    error: state.key === key ? state.error : "",
    loading:
      enabled && !!app && !!route && (state.key !== key || state.loading),
    retry: () => retry((v) => v + 1),
  };
}
