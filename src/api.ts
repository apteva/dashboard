// All REST/JSON API endpoints live under /api/ on the server. The SPA owns
// every other path (refresh on /instances/42 no longer collides with the
// server's /instances/ prefix match). Static assets and the SPA catchall
// route through `/` on the server.
const BASE = "/api";

// Soft auth-invalidation signal. AuthProvider registers a callback at
// mount that flips its context state to `authenticated = false`. When
// any authenticated API call gets a 401, we fire the callback instead
// of doing `window.location.href = "/login"`, which would hard-reload
// and recreate every context, destroying React Router history and
// causing feedback loops between Login's "redirect if authenticated"
// useEffect and the failing call. With the soft signal:
//   401 → callback → setAuthenticated(false) → ProtectedRoute renders
//   <Navigate to="/login"> via React Router → Login mounts, Login sees
//   authenticated=false, stays put. No reload, no loop.
let onAuthInvalid: (() => void) | null = null;
export function setAuthInvalidHandler(fn: (() => void) | null) {
  onAuthInvalid = fn;
}

async function request<T>(
  method: string,
  path: string,
  body?: any,
  extraHeaders?: Record<string, string>,
): Promise<T> {
  const headers: Record<string, string> = { ...(extraHeaders || {}) };
  if (body) headers["Content-Type"] = "application/json";

  const url = `${BASE}${path}`;
  console.log(`[api] → ${method} ${url}`);
  const res = await fetch(url, {
    method,
    headers,
    credentials: "same-origin",
    body: body ? JSON.stringify(body) : undefined,
  });
  console.log(`[api] ← ${res.status} ${method} ${url}`);
  if (res.status === 401) {
    // Soft signal only — no hard window.location.href redirect. Let
    // AuthProvider flip its state so React Router handles navigation
    // through the normal component tree. Skip the signal for /auth/
    // paths themselves (so auth.me() returning 401 during initial
    // load doesn't double-fire through the provider).
    if (!path.startsWith("/auth/") && onAuthInvalid) {
      console.log(`[api] 401 on ${path} → notifying AuthProvider`);
      onAuthInvalid();
    }
    throw new Error("unauthorized");
  }
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `${res.status}`);
  }
  return res.json();
}

// Server-wide settings (admin-editable, lives in server_settings table).
export interface ServerSettings {
  public_url: {
    value: string;        // raw DB value (empty if not set)
    env_value: string;    // raw env var value (empty if not set)
    effective: string;    // what the server is actually using
    source: "db" | "env" | "unset";
    oauth_callback: string; // computed: <effective>/oauth/local/callback
  };
}

export const serverSettings = {
  get: () => request<ServerSettings>("GET", "/settings/server"),
  update: (patch: { public_url?: string }) =>
    request<ServerSettings>("PUT", "/settings/server", patch),
};

// Auth
export const auth = {
  status: () =>
    request<{ reg_mode: string; needs_setup: boolean }>("GET", "/auth/status"),

  register: (email: string, password: string, setupToken?: string) =>
    request<{ id: number; email: string }>(
      "POST",
      "/auth/register",
      { email, password },
      setupToken ? { "X-Setup-Token": setupToken } : undefined,
    ),

  login: (email: string, password: string) =>
    request<{ user_id: number; email: string }>("POST", "/auth/login", { email, password }),

  logout: () =>
    request<any>("POST", "/auth/logout").then(() => {
      window.location.href = "/login";
    }),

  me: () => request<{ user_id: number }>("GET", "/auth/me"),

  createKey: (name: string) =>
    request<{ id: number; key: string; prefix: string }>("POST", "/auth/keys", { name }),

  listKeys: () =>
    request<Array<{ id: number; name: string; key_prefix: string; created_at: string }>>("GET", "/auth/keys"),

  deleteKey: (id: number) =>
    request<any>("DELETE", `/auth/keys/${id}`),
};

// Provider types (catalog)
export interface ProviderTypeInfo {
  id: number;
  type: string;
  name: string;
  description: string;
  fields: string[];
  requires_credentials: boolean;
  sort_order: number;
}

export const providerTypes = {
  list: () => request<ProviderTypeInfo[]>("GET", "/provider-types"),
};

// Projects
export interface Project {
  id: string;
  user_id: number;
  name: string;
  description: string;
  color: string;
  created_at: string;
}

export const projects = {
  list: () => request<Project[]>("GET", "/projects"),
  create: (name: string, description?: string, color?: string) =>
    request<Project>("POST", "/projects", { name, description: description || "", color: color || "" }),
  get: (id: string) => request<Project>("GET", `/projects/${id}`),
  update: (id: string, name: string, description: string, color: string) =>
    request<Project>("PUT", `/projects/${id}`, { name, description, color }),
  delete: (id: string) => request<any>("DELETE", `/projects/${id}`),
};

// Instances
export interface Instance {
  id: number;
  user_id: number;
  name: string;
  directive: string;
  mode: string; // "autonomous" or "supervised"
  config: string;
  port: number;
  pid: number;
  status: string;
  project_id?: string;
  created_at: string;
}

export const instances = {
  list: (projectId?: string) => {
    const params = projectId ? `?project_id=${projectId}` : "";
    return request<Instance[]>("GET", `/instances${params}`);
  },

  create: (
    name: string,
    directive?: string,
    mode?: string,
    projectId?: string,
    start?: boolean,
    opts?: { includeAptevaServer?: boolean; includeChannels?: boolean },
  ) =>
    request<Instance>("POST", "/instances", {
      name,
      directive: directive || "",
      mode: mode || "autonomous",
      project_id: projectId || "",
      // Server default is start=true; pass explicit false to create stopped.
      ...(start === false ? { start: false } : {}),
      // Server defaults both system-MCP flags to true. Only send them
      // when the caller wants a non-default value so the wire payload
      // stays minimal in the common case.
      ...(opts?.includeAptevaServer === false ? { include_apteva_server: false } : {}),
      ...(opts?.includeChannels === false ? { include_channels: false } : {}),
    }),

  get: (id: number) => request<Instance>("GET", `/instances/${id}`),

  rename: (id: number, name: string) =>
    request<Instance>("PUT", `/instances/${id}`, { name }),

  delete: (id: number) => request<any>("DELETE", `/instances/${id}`),

  stop: (id: number) => request<Instance>("POST", `/instances/${id}/stop`),

  start: (id: number) => request<Instance>("POST", `/instances/${id}/start`),

  pause: (id: number) => request<{ paused: boolean }>("POST", `/instances/${id}/pause`),

  sendEvent: (id: number, message: string | Array<{ type: string; text?: string; image_url?: { url: string }; audio_url?: { url: string; mime_type?: string } }>, threadId?: string) =>
    request<any>("POST", `/instances/${id}/event`, { message, ...(threadId ? { thread_id: threadId } : {}) }),

  updateConfig: (id: number, opts: { directive?: string; mode?: string; providers?: Array<{ name: string; default: boolean }> }) =>
    request<Instance>("PUT", `/instances/${id}/config`, {
      ...(opts.directive ? { directive: opts.directive } : {}),
      ...(opts.mode ? { mode: opts.mode } : {}),
      ...(opts.providers ? { providers: opts.providers } : {}),
    }),

  chatHistory: (id: number, limit?: number) =>
    request<ChatHistoryMessage[]>("GET", `/instances/${id}/chat-history${limit ? `?limit=${limit}` : ""}`),
};

export interface ChatHistoryMessage {
  id: string;
  role: "user" | "agent" | "tool" | "status";
  text: string;
  time: string;
  tool_name?: string;
  tool_done?: boolean;
  tool_duration_ms?: number;
  tool_success?: boolean;
}

// Providers
export interface Provider {
  id: number;
  provider_type_id?: number;
  type: string;
  name: string;
  project_id?: string;
  created_at: string;
  updated_at: string;
}

export interface ProviderDetail extends Provider {
  data: Record<string, string>;
}

export interface ModelInfo {
  id: string;
  name: string;
  context_size?: number;
  input_cost?: number;
  output_cost?: number;
}

export const providers = {
  // If projectId is passed, the response includes providers scoped to that
  // project PLUS any unscoped "global" ones (project_id = '').
  list: (projectId?: string) => {
    const params = projectId ? `?project_id=${encodeURIComponent(projectId)}` : "";
    return request<Provider[]>("GET", `/providers${params}`);
  },

  get: (id: number) => request<ProviderDetail>("GET", `/providers/${id}`),

  models: (id: number) => request<ModelInfo[]>("GET", `/providers/${id}/models`),

  create: (type: string, name: string, data: Record<string, string>, providerTypeId?: number, projectId?: string) =>
    request<Provider>("POST", "/providers", {
      type,
      name,
      data,
      provider_type_id: providerTypeId || 0,
      project_id: projectId || "",
    }),

  update: (id: number, type: string, name: string, data: Record<string, string>) =>
    request<any>("PUT", `/providers/${id}`, { type, name, data }),

  delete: (id: number) => request<any>("DELETE", `/providers/${id}`),
};

// Integrations catalog + connections
export interface AppSummary {
  slug: string;
  name: string;
  description: string;
  logo: string | null;
  categories: string[];
  auth_types: string[];
  tool_count: number;
  has_webhooks: boolean;
  webhook_events?: Array<{ name: string; description: string }>;
}

export interface CredentialField {
  name: string;
  label: string;
  description?: string;
  required?: boolean;
  type?: string;
}

export interface AppDetail extends AppSummary {
  base_url: string;
  auth: {
    types: string[];
    headers?: Record<string, string>;
    query_params?: Record<string, string>;
    credential_fields?: CredentialField[];
    oauth2?: any;
  };
  tools: Array<{
    name: string;
    description: string;
    method: string;
    path: string;
    input_schema: Record<string, any>;
  }>;
}

export interface ConnectionInfo {
  id: number;
  app_slug: string;
  app_name: string;
  name: string;
  auth_type: string;
  status: string;
  source: string;                // 'local' | 'composio'
  provider_id?: number;
  external_id?: string;
  tool_count: number;
  created_at: string;
}

// Response shape when a connection create kicks off an OAuth flow (local
// oauth2 or composio). `redirect_url` is what the popup should open.
export interface ConnectCreateResponse {
  connection: ConnectionInfo;
  redirect_url: string;
}

export interface ComposioApp {
  slug: string;
  name: string;
  description?: string;
  logo?: string;
  categories?: string[];
  no_auth?: boolean;
  composio_managed?: boolean;
}

export interface ComposioCredField {
  name: string;
  display_name: string;
  description?: string;
  type: string;
  required: boolean;
  default?: string;
}

export interface ComposioToolkitDetails {
  slug: string;
  name: string;
  composio_managed_auth_schemes: string[];
  auth_mode: string;              // lowercase: oauth2 / api_key / basic / ...
  auth_mode_display: string;
  auth_guide_url?: string;
  config_fields: ComposioCredField[];
  init_fields: ComposioCredField[];
  is_composio_managed: boolean;
}

export interface CatalogStatus {
  count: number;
  installed: boolean;
  last_updated: string | null;
}

export const integrations = {
  catalog: (q?: string) => {
    const params = q ? `?q=${encodeURIComponent(q)}` : "";
    return request<AppSummary[]>("GET", `/integrations/catalog${params}`);
  },

  catalogStatus: () => request<CatalogStatus>("GET", "/integrations/catalog/status"),

  downloadCatalog: () => request<{ status: string; count: number }>("POST", "/integrations/catalog/download"),

  app: (slug: string) => request<AppDetail>("GET", `/integrations/catalog/${slug}`),

  connections: (projectId?: string) => {
    const params = projectId ? `?project_id=${projectId}` : "";
    return request<ConnectionInfo[]>("GET", `/connections${params}`);
  },

  // Local non-OAuth: stores credentials immediately, returns ConnectionInfo.
  // Local OAuth2: returns ConnectCreateResponse with an authorize URL.
  // For OAuth2 apps, the caller may pass the user's own OAuth client_id /
  // client_secret — these get folded into the connection's encrypted blob so
  // subsequent connects to the same app+project skip the form.
  connect: (
    appSlug: string,
    name: string,
    credentials: Record<string, string>,
    authType?: string,
    projectId?: string,
    oauth?: { client_id?: string; client_secret?: string },
  ) =>
    request<ConnectionInfo | ConnectCreateResponse>("POST", "/connections", {
      source: "local",
      app_slug: appSlug,
      name,
      credentials,
      auth_type: authType,
      project_id: projectId || "",
      ...(oauth?.client_id ? { client_id: oauth.client_id } : {}),
      ...(oauth?.client_secret ? { client_secret: oauth.client_secret } : {}),
    }),

  // Create an additional MCP server row over an existing connection
  // with a specific tool subset. Lets the user attach two distinct
  // scoped MCPs (e.g. google-sheets-readonly + google-sheets-rw) from
  // the same OAuth credentials and route them to different sub-threads.
  // Returns the new MCP row id + URL.
  createScopedMCP: (
    connectionId: number,
    name: string,
    allowedTools: string[],
  ) =>
    request<{
      id: number;
      name: string;
      connection_id: number;
      app_slug: string;
      allowed_tools: string[];
      url: string;
    }>("POST", `/connections/${connectionId}/mcp`, {
      name,
      allowed_tools: allowedTools,
    }),

  // Look up whether an OAuth client is already registered for an app+project.
  // Used by the dashboard to hide the client_id/secret form when the user
  // has already gone through it once for this app in this project.
  oauthClientStatus: (appSlug: string, projectId?: string) => {
    const params = new URLSearchParams({ app_slug: appSlug });
    if (projectId) params.set("project_id", projectId);
    return request<{
      has_client_id: boolean;
      has_client_secret: boolean;
      client_id: string;
      source: "stored" | "env" | "";
      resolved: boolean;
      callback_url: string;
    }>("GET", `/oauth/local/client?${params}`);
  },

  // Hosted Composio connection — server calls Composio, returns a redirect URL
  // the dashboard must open in a popup. The connection row is pending until
  // the user finishes OAuth on Composio's side; poll /connections/:id to flip.
  connectComposio: (
    providerId: number,
    appSlug: string,
    opts?: {
      name?: string;
      projectId?: string;
      authMode?: string;                           // API_KEY / OAUTH2 / BASIC ...
      configCreds?: Record<string, string>;        // fields for auth_config creation
      initCreds?: Record<string, string>;          // fields for per-connection init
    },
  ) =>
    request<ConnectCreateResponse>("POST", "/connections", {
      source: "composio",
      provider_id: providerId,
      app_slug: appSlug,
      name: opts?.name || appSlug,
      project_id: opts?.projectId || "",
      composio_auth_mode: opts?.authMode || "",
      composio_config_creds: opts?.configCreds || {},
      composio_init_creds: opts?.initCreds || {},
    }),

  // Per-toolkit detail fetch — returns the credential field schema so the
  // dashboard can render a form before initiating the connection. Proxied
  // through apteva-server so the Composio API key never leaves the server.
  composioToolkit: (providerId: number, slug: string) =>
    request<ComposioToolkitDetails>("GET", `/composio/toolkit/${encodeURIComponent(slug)}?provider_id=${providerId}`),

  // Manual trigger for Composio MCP server reconciliation. Recreates the
  // aggregate remote mcp_servers row for a (project, provider) tuple from
  // the current set of active composio connections. Use this after a
  // reconcile failure during connection creation.
  composioReconcile: (providerId: number, projectId?: string) =>
    request<{ status: string; mcp_server: MCPServer | null }>(
      "POST",
      `/composio/reconcile?provider_id=${providerId}${projectId ? `&project_id=${encodeURIComponent(projectId)}` : ""}`,
    ),

  // Single-connection fetch — used by OAuth-flow polling.
  get: (id: number) => request<ConnectionInfo>("GET", `/connections/${id}`),

  disconnect: (id: number) => request<any>("DELETE", `/connections/${id}`),

  // Composio app catalog (proxied via apteva-server using the user's API key).
  // Pass a non-empty `search` to use Composio's server-side search instead of
  // paging through the full catalog.
  composioApps: (providerId: number, search?: string) => {
    const q = `?provider_id=${providerId}${search ? `&search=${encodeURIComponent(search)}` : ""}`;
    return request<ComposioApp[]>("GET", `/composio/apps${q}`);
  },

  // List every action (tool) a Composio toolkit exposes. Used by the
  // tool-scope picker so the user can narrow an MCP server row to a
  // subset. Auto-picks the user's first Composio provider on the server
  // side — no provider_id needed.
  composioToolkitActions: (slug: string) =>
    request<Array<{ slug: string; name: string; description: string; toolkit: string }>>(
      "GET",
      `/composio/toolkits/${encodeURIComponent(slug)}/actions`,
    ),

  tools: (id: number) =>
    request<Array<{ name: string; description: string; method: string; path: string }>>("GET", `/connections/${id}/tools`),

  execute: (id: number, tool: string, input: Record<string, any>) =>
    request<{ success: boolean; status: number; data: any }>("POST", `/connections/${id}/execute`, { tool, input }),

  // List Composio trigger templates for this connection's toolkit.
  // Returns [] for local-source connections (server responds 404 there,
  // we fall back to empty in the caller). The trigger config schema is
  // untyped because it varies per-trigger — the UI renders a dynamic
  // form from it.
  triggers: (id: number) =>
    request<{ connection_id: number; toolkit: string; triggers: Array<{
      slug: string;
      name: string;
      description: string;
      instructions?: string;
      type: string;      // "webhook" | "poll"
      toolkit: string;
      config: Record<string, any>;
    }> }>("GET", `/connections/${id}/triggers`),
};

// MCP Servers
export interface MCPServer {
  id: number;
  name: string;
  command: string;
  args: string;
  description: string;
  status: string;          // 'running' | 'stopped' | 'reachable' | 'unprobed'
  tool_count: number;
  pid: number;
  source: string;          // 'custom' | 'local' | 'remote'
  transport?: string;      // 'stdio' | 'http'
  url?: string;
  provider_id?: number;
  connection_id: number;
  // allowed_tools is the persisted tool filter. Empty/null means "all tools
  // exposed" (legacy). A populated array means only those tools are served
  // by this MCP server row — enforced server-side for local rows and
  // forwarded to Composio as `actions` for remote rows.
  allowed_tools?: string[] | null;
  proxy_config?: { name: string; transport: string; url?: string; command?: string; args?: string[] };
  created_at: string;
}

export interface MCPTool {
  name: string;
  description: string;
  inputSchema?: Record<string, any>;
}

// Shape returned by GET /mcp-servers/:id/tools: the full catalog of tools
// that row can expose, plus the currently-persisted allowed_tools filter
// (may be empty = all tools enabled).
export interface MCPServerToolsResponse {
  tools: MCPTool[];
  allowed_tools: string[] | null;
}

export const mcpServers = {
  list: (projectId?: string) => {
    const params = projectId ? `?project_id=${projectId}` : "";
    return request<MCPServer[]>("GET", `/mcp-servers${params}`);
  },

  create: (name: string, command: string, args: string[], env: Record<string, string>, description: string, projectId?: string) =>
    request<MCPServer>("POST", "/mcp-servers", { name, command, args, env, description, project_id: projectId || "" }),

  delete: (id: number) => request<any>("DELETE", `/mcp-servers/${id}`),

  start: (id: number) =>
    request<{ status: string; tool_count: number; tools: MCPTool[] }>("POST", `/mcp-servers/${id}/start`),

  stop: (id: number) => request<any>("POST", `/mcp-servers/${id}/stop`),

  // Fetch the tool catalog for an MCP server row. Response now includes
  // `allowed_tools` so callers rendering a picker can pre-tick the current
  // filter. Legacy callers that typed this as `MCPTool[]` get the .tools
  // field — they keep working by accessing response.tools.
  tools: (id: number) => request<MCPServerToolsResponse>("GET", `/mcp-servers/${id}/tools`),

  // Overwrite the allowed_tools filter. Pass an empty array to clear
  // (re-enable all tools). Takes effect immediately for source=local
  // rows; source=remote (Composio) needs a subsequent /composio/reconcile.
  setAllowedTools: (id: number, allowed: string[]) =>
    request<{ status: string; allowed_tools: string[] }>(
      "PUT",
      `/mcp-servers/${id}/tools`,
      { allowed_tools: allowed },
    ),

  // Invoke a tool on an MCP server. Works for source=remote (HTTP MCP) and
  // source=custom (stdio subprocess). Local catalog rows must use
  // integrations.execute(connection_id, ...) instead.
  //
  // Response shape mirrors integrations.execute for dashboard uniformity:
  //   { success: boolean, status: number, data: any }
  callTool: (id: number, tool: string, args: Record<string, any>) =>
    request<{ success: boolean; status: number; data: any }>(
      "POST",
      `/mcp-servers/${id}/call-tool`,
      { tool, args },
    ),
};

// Subscriptions
export interface SubscriptionInfo {
  id: string;
  instance_id: number;
  connection_id: number;
  name: string;
  slug: string;
  description: string;
  webhook_path: string;
  webhook_url: string;
  enabled: boolean;
  events: string[];
  thread_id?: string;
  created_at: string;
}

export const subscriptions = {
  list: (projectId?: string) => {
    const params = projectId ? `?project_id=${projectId}` : "";
    return request<SubscriptionInfo[]>("GET", `/subscriptions${params}`);
  },

  create: (
    name: string,
    slug: string,
    instanceId: number,
    opts?: {
      connectionId?: number;
      description?: string;
      hmacSecret?: string;
      events?: string[];
      threadId?: string;
      projectId?: string;
      // Composio-source only: which trigger template to instantiate
      // and its config fields (varies per trigger template).
      triggerSlug?: string;
      triggerConfig?: Record<string, any>;
    },
  ) =>
    request<{ subscription: SubscriptionInfo; webhook_url: string; auto_registered: boolean; trigger_id?: string; trigger_slug?: string }>(
      "POST",
      "/subscriptions",
      {
        name,
        slug,
        instance_id: instanceId,
        connection_id: opts?.connectionId || 0,
        description: opts?.description || "",
        hmac_secret: opts?.hmacSecret || "",
        events: opts?.events || [],
        thread_id: opts?.threadId || "",
        project_id: opts?.projectId || "",
        trigger_slug: opts?.triggerSlug || "",
        trigger_config: opts?.triggerConfig || {},
      },
    ),

  delete: (id: string) => request<any>("DELETE", `/subscriptions/${id}`),

  enable: (id: string) => request<any>("POST", `/subscriptions/${id}/enable`),

  disable: (id: string) => request<any>("POST", `/subscriptions/${id}/disable`),

  test: (id: string, opts?: { event?: string; payload?: Record<string, any> }) =>
    request<{ status: string; event: string; payload: any }>("POST", `/subscriptions/${id}/test`, opts || {}),
};

// Core per-instance API (proxied through server)
export interface PendingApproval {
  id?: string;
  name: string;
  args: Record<string, string>;
}

// Legacy event format from core /events SSE (used by Events page)
export interface APIEvent {
  type: string;
  thread_id: string;
  message: string;
  iteration: number;
  duration: string;
  time: string;
}

export interface Status {
  uptime_seconds: number;
  iteration: number;
  rate: string;
  model: string;
  threads: number;
  memories: number;
  paused: boolean;
  mode: "autonomous" | "supervised";
  pending_approval: PendingApproval | null;
}

export interface Thread {
  id: string;
  parent_id?: string;
  depth?: number;
  directive: string;
  tools: string[];
  mcp_names?: string[];
  iteration: number;
  rate: string;
  model: string;
  age: string;
}

// Telemetry event — unified format from core
export interface TelemetryEvent {
  id: string;
  instance_id: number;
  thread_id: string;
  type: string;
  time: string;
  data: Record<string, any>;
}

// Telemetry stats from server
export interface TelemetryStats {
  total_events: number;
  llm_calls: number;
  total_tokens_in: number;
  total_tokens_out: number;
  total_cost: number;
  avg_duration_ms: number;
  threads_spawned: number;
  threads_done: number;
  tool_calls: number;
  errors: number;
}

// MCPServerConfig is the shape cores consume for each entry in their
// mcp_servers config list. Matches both stdio entries (command+args) and
// streamable HTTP entries (url). Used when reading the current config and
// when pushing a new desired list via setMCPServers.
export interface MCPServerConfig {
  name: string;
  transport?: string;      // 'http' | 'stdio'
  url?: string;
  command?: string;
  args?: string[];
  main_access?: boolean;
  connected?: boolean;     // present on GET, absent on PUT
}

export const core = {
  status: (instanceId: number) => request<Status>("GET", `/instances/${instanceId}/status`),
  threads: (instanceId: number) => request<Thread[]>("GET", `/instances/${instanceId}/threads`),
  // GET /instances/:id/config — proxied to the core. The core responds with
  // the current in-memory config including the live mcp_servers list (each
  // entry annotated with `connected: true`).
  config: (instanceId: number) =>
    request<{
      directive: string;
      mode: string;
      auto_approve?: string[];
      mcp_servers?: MCPServerConfig[];
      computer?: {
        connected: boolean;
        type?: string;
        display?: { width: number; height: number };
      } | null;
    }>("GET", `/instances/${instanceId}/config`),

  // Hot-attach or detach the browser/computer environment on a running
  // instance. The server fills in credentials from the saved browser
  // provider when the type needs them, so the dashboard only sends the
  // mode (and an optional URL for the "service" CDP type).
  setComputer: (
    instanceId: number,
    computer:
      | { type: "" }
      | { type: "local"; width?: number; height?: number }
      | { type: "browserbase"; width?: number; height?: number }
      | { type: "service"; url?: string; width?: number; height?: number },
  ) =>
    request<{ status: string }>("PUT", `/instances/${instanceId}/config`, {
      computer,
    }),
  setMode: (instanceId: number, mode: "autonomous" | "supervised") =>
    request<{ status: string }>("PUT", `/instances/${instanceId}/config`, { mode }),
  // Replace the full mcp_servers list on a running instance. The core runs
  // reconcileMCP against the new list — servers in the list but not
  // currently connected are connected, servers currently connected but not
  // in the list are disconnected. System entries (apteva-server / channels)
  // must be included in `servers` or they will be reaped by reconcile.
  setMCPServers: (instanceId: number, servers: MCPServerConfig[]) =>
    request<{ status: string }>("PUT", `/instances/${instanceId}/config`, { mcp_servers: servers }),
  approve: (instanceId: number, approved: boolean) =>
    request<{ status: string }>("POST", `/instances/${instanceId}/approve`, { approved }),

  // Reset the main thread's conversation context. Mirrors the CLI's
  // /clear command. Choose any combination of:
  //   history — wipe the LLM message history (the agent forgets the
  //             back-and-forth, but keeps remembered facts)
  //   memory  — wipe the persistent memory (forget learned facts)
  //   threads — kill all sub-threads (does NOT touch main)
  // Default is { history: true } which is the equivalent of /clear.
  reset: (
    instanceId: number,
    opts?: { history?: boolean; memory?: boolean; threads?: boolean },
  ) =>
    request<{ status: string }>("PUT", `/instances/${instanceId}/config`, {
      reset: {
        history: opts?.history ?? true,
        memory: opts?.memory ?? false,
        threads: opts?.threads ?? false,
      },
    }),
};

// Channels
export interface ChannelInfo {
  id: number;
  instance_id: number;
  type: string;
  name: string;
  status: string;
}

export interface SlackChannelInfo {
  id: string;
  name: string;
  is_member: boolean;
  is_private: boolean;
  num_members: number;
}

export const channels = {
  list: (opts: { instanceId?: number; projectId?: string }) => {
    const params = new URLSearchParams();
    if (opts.instanceId) params.set("instance_id", String(opts.instanceId));
    if (opts.projectId) params.set("project_id", opts.projectId);
    return request<ChannelInfo[]>("GET", `/channels?${params}`);
  },
  connect: (instanceId: number, type: string, config: Record<string, string>) =>
    request<{ status: string; type: string; bot_name?: string; channel?: string }>(
      "POST", "/channels/connect", { instance_id: instanceId, type, ...config },
    ),
  disconnect: (channelId: number) =>
    request<{ status: string }>("DELETE", `/channels/disconnect/${channelId}`),
};

export const slack = {
  configure: (projectId: string, botToken: string, appToken: string) =>
    request<{ status: string }>("POST", "/slack/configure", { project_id: projectId, bot_token: botToken, app_token: appToken }),
  status: (projectId: string) =>
    request<{ connected: boolean }>("GET", `/slack/status?project_id=${encodeURIComponent(projectId)}`),
  listChannels: (projectId: string) =>
    request<SlackChannelInfo[]>("GET", `/slack/channels?project_id=${encodeURIComponent(projectId)}`),
};

export const email = {
  configure: (projectId: string, apiKey: string) =>
    request<{ status: string }>("POST", "/email/configure", { project_id: projectId, api_key: apiKey }),
  status: (projectId: string) =>
    request<{ connected: boolean }>("GET", `/email/status?project_id=${encodeURIComponent(projectId)}`),
};

export const telemetry = {
  query: (instanceId: number, type?: string, limit?: number, threadId?: string) => {
    const params = new URLSearchParams({ instance_id: String(instanceId) });
    if (type) params.set("type", type);
    if (limit) params.set("limit", String(limit));
    if (threadId) params.set("thread_id", threadId);
    return request<TelemetryEvent[]>("GET", `/telemetry?${params}`);
  },
  stats: (instanceId: number, period: string = "24h") =>
    request<TelemetryStats>("GET", `/telemetry/stats?instance_id=${instanceId}&period=${period}`),

  wipe: () => request<{ deleted: number }>("DELETE", "/telemetry"),

  timeline: (instanceId: number, period: string = "24h") =>
    request<Array<{
      time: string;
      llm_calls: number;
      tokens_in: number;
      tokens_out: number;
      cost: number;
      tool_calls: number;
      errors: number;
      threads: Record<string, number>;
    }>>("GET", `/telemetry/timeline?instance_id=${instanceId}&period=${period}`),

  stream: (instanceId: number): EventSource => {
    return new EventSource(`${BASE}/telemetry/stream?instance_id=${instanceId}`);
  },
};

// --- Apteva Apps framework ---

export interface AppManifest {
  slug: string;
  name: string;
  version: string;
  description?: string;
  ui_slots?: Array<{ slot: string; title?: string; entry?: string }>;
  publishes?: string[];
  subscribes?: string[];
}

export const apps = {
  manifest: () => request<AppManifest[]>("GET", "/apps/manifest"),
};

// --- channel-chat app ---
//
// DB-backed chat as a first-class Apteva App. Messages live in the
// server's DB with a monotonic autoincrement id — ordering is free,
// dedup is trivial (just check id before insert). Reconnect uses
// `since=<last_id>` to fetch the exact gap.

export interface ChatRow {
  id: string;
  instance_id: number;
  title: string;
  created_at: string;
  updated_at: string;
}

export interface ChatMessageRow {
  id: number;
  chat_id: string;
  role: "user" | "agent" | "system";
  content: string;
  user_id?: number;
  thread_id?: string;
  status: "streaming" | "final";
  created_at: string;
}

export const chat = {
  // APP_PATH is the HTTP prefix the Apteva Apps framework uses for
  // this app. Keeping it as a constant here means if the slug changes
  // upstream we only touch one line.
  APP_PATH: "/apps/channel-chat",

  listChats: (instanceId: number) =>
    request<ChatRow[]>("GET", `/apps/channel-chat/chats?instance_id=${instanceId}`),

  createChat: (instanceId: number, title?: string) =>
    request<ChatRow>("POST", "/apps/channel-chat/chats", { instance_id: instanceId, title }),

  messages: (chatId: string, since: number = 0, limit: number = 500) =>
    request<ChatMessageRow[]>(
      "GET",
      `/apps/channel-chat/messages?chat_id=${encodeURIComponent(chatId)}&since=${since}&limit=${limit}`,
    ),

  post: (chatId: string, content: string) =>
    request<ChatMessageRow>(
      "POST",
      `/apps/channel-chat/messages?chat_id=${encodeURIComponent(chatId)}`,
      { content },
    ),

  clear: (chatId: string) =>
    request<{ deleted: number }>(
      "DELETE",
      `/apps/channel-chat/messages?chat_id=${encodeURIComponent(chatId)}`,
    ),

  // stream returns an EventSource for live messages. Pass the last
  // seen id as `since` so the server can backfill the gap before
  // live delivery starts — the caller doesn't need a separate
  // "catch up" path.
  stream: (chatId: string, since: number = 0): EventSource => {
    const qs = `chat_id=${encodeURIComponent(chatId)}&since=${since}`;
    return new EventSource(`${BASE}/apps/channel-chat/stream?${qs}`);
  },
};
