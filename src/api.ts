const BASE = "";

async function request<T>(method: string, path: string, body?: any): Promise<T> {
  const headers: Record<string, string> = {};
  if (body) headers["Content-Type"] = "application/json";

  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    credentials: "same-origin",
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401) {
    if (!path.startsWith("/auth/")) {
      window.location.href = "/login";
    }
    throw new Error("unauthorized");
  }
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `${res.status}`);
  }
  return res.json();
}

// Auth
export const auth = {
  register: (email: string, password: string) =>
    request<{ id: number; email: string }>("POST", "/auth/register", { email, password }),

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

  create: (name: string, directive?: string, mode?: string, projectId?: string) =>
    request<Instance>("POST", "/instances", { name, directive: directive || "", mode: mode || "autonomous", project_id: projectId || "" }),

  get: (id: number) => request<Instance>("GET", `/instances/${id}`),

  delete: (id: number) => request<any>("DELETE", `/instances/${id}`),

  stop: (id: number) => request<Instance>("POST", `/instances/${id}/stop`),

  start: (id: number) => request<Instance>("POST", `/instances/${id}/start`),

  pause: (id: number) => request<{ paused: boolean }>("POST", `/instances/${id}/pause`),

  sendEvent: (id: number, message: string | Array<{ type: string; text?: string; image_url?: { url: string }; audio_url?: { url: string; mime_type?: string } }>, threadId?: string) =>
    request<any>("POST", `/instances/${id}/event`, { message, ...(threadId ? { thread_id: threadId } : {}) }),

  updateConfig: (id: number, directive?: string, mode?: string) =>
    request<Instance>("PUT", `/instances/${id}/config`, {
      ...(directive ? { directive } : {}),
      ...(mode ? { mode } : {}),
    }),
};

// Providers
export interface Provider {
  id: number;
  type: string;
  name: string;
  created_at: string;
  updated_at: string;
}

export interface ProviderDetail extends Provider {
  data: Record<string, string>;
}

export const providers = {
  list: () => request<Provider[]>("GET", "/providers"),

  get: (id: number) => request<ProviderDetail>("GET", `/providers/${id}`),

  create: (type: string, name: string, data: Record<string, string>, providerTypeId?: number) =>
    request<Provider>("POST", "/providers", { type, name, data, provider_type_id: providerTypeId || 0 }),

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
  tool_count: number;
  created_at: string;
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

  connect: (appSlug: string, name: string, credentials: Record<string, string>, authType?: string, projectId?: string) =>
    request<ConnectionInfo>("POST", "/connections", { app_slug: appSlug, name, credentials, auth_type: authType, project_id: projectId || "" }),

  disconnect: (id: number) => request<any>("DELETE", `/connections/${id}`),

  tools: (id: number) =>
    request<Array<{ name: string; description: string; method: string; path: string }>>("GET", `/connections/${id}/tools`),

  execute: (id: number, tool: string, input: Record<string, any>) =>
    request<{ success: boolean; status: number; data: any }>("POST", `/connections/${id}/execute`, { tool, input }),
};

// MCP Servers
export interface MCPServer {
  id: number;
  name: string;
  command: string;
  args: string;
  description: string;
  status: string;
  tool_count: number;
  pid: number;
  source: string;
  connection_id: number;
  proxy_config?: { name: string; transport: string; url?: string; command?: string; args?: string[] };
  created_at: string;
}

export interface MCPTool {
  name: string;
  description: string;
  inputSchema: Record<string, any>;
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

  tools: (id: number) => request<MCPTool[]>("GET", `/mcp-servers/${id}/tools`),
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
  created_at: string;
}

export const subscriptions = {
  list: (projectId?: string) => {
    const params = projectId ? `?project_id=${projectId}` : "";
    return request<SubscriptionInfo[]>("GET", `/subscriptions${params}`);
  },

  create: (name: string, slug: string, instanceId: number, opts?: { connectionId?: number; description?: string; hmacSecret?: string }) =>
    request<{ subscription: SubscriptionInfo; webhook_url: string }>("POST", "/subscriptions", {
      name, slug, instance_id: instanceId,
      connection_id: opts?.connectionId || 0,
      description: opts?.description || "",
      hmac_secret: opts?.hmacSecret || "",
    }),

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

export const core = {
  status: (instanceId: number) => request<Status>("GET", `/instances/${instanceId}/status`),
  threads: (instanceId: number) => request<Thread[]>("GET", `/instances/${instanceId}/threads`),
  config: (instanceId: number) => request<{ directive: string; mode: string; auto_approve: string[] }>("GET", `/instances/${instanceId}/config`),
  setMode: (instanceId: number, mode: "autonomous" | "supervised") =>
    request<{ status: string }>("PUT", `/instances/${instanceId}/config`, { mode }),
  approve: (instanceId: number, approved: boolean) =>
    request<{ status: string }>("POST", `/instances/${instanceId}/approve`, { approved }),
};

// Channels
export interface Channel {
  id: string;
  status: string;
  bot_name?: string;
}

export const channels = {
  list: (instanceId: number) =>
    request<Channel[]>("GET", `/instances/${instanceId}/channels`),
  submitReply: (instanceId: number, text: string) =>
    request<{ status: string }>("POST", `/instances/${instanceId}/channels/cli/reply`, { text }),
  connectTelegram: (instanceId: number, token: string) =>
    request<{ status: string; bot_name: string }>("POST", `/instances/${instanceId}/channels/telegram`, { token }),
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
