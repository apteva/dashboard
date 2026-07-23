// All REST/JSON API endpoints live under /api/ on the server. The SPA owns
// every other path (refresh on /instances/42 no longer collides with the
// server's /instances/ prefix match). Static assets and the SPA catchall
// route through `/` on the server.
export const BASE = "/api";

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

const inFlightGETs = new Map<string, Promise<unknown>>();
const API_DEBUG = process.env.NODE_ENV !== "production";

function request<T>(
  method: string,
  path: string,
  body?: any,
  extraHeaders?: Record<string, string>,
  signal?: AbortSignal,
): Promise<T> {
  const headers: Record<string, string> = { ...(extraHeaders || {}) };
  if (body) headers["Content-Type"] = "application/json";

  const url = `${BASE}${path}`;
  const execute = async (): Promise<T> => {
    if (API_DEBUG) console.debug(`[api] → ${method} ${url}`);
    const res = await fetch(url, {
      method,
      headers,
      credentials: "same-origin",
      body: body ? JSON.stringify(body) : undefined,
      signal,
    });
    if (API_DEBUG) console.debug(`[api] ← ${res.status} ${method} ${url}`);
    if (res.status === 401) {
      // Soft signal only — no hard window.location.href redirect. Let
      // AuthProvider flip its state so React Router handles navigation
      // through the normal component tree. Skip the signal for /auth/
      // paths themselves (so auth.me() returning 401 during initial
      // load doesn't double-fire through the provider).
      if (!path.startsWith("/auth/") && onAuthInvalid) {
        if (API_DEBUG) console.debug(`[api] 401 on ${path} → notifying AuthProvider`);
        onAuthInvalid();
      }
      throw new Error("unauthorized");
    }
    if (!res.ok) {
      const text = await res.text();
      // Surface a structured error field when the server returned JSON
      // on the 4xx/5xx. Two shapes the server actually emits:
      //
      //   { error: "..." }                                  (most handlers)
      //   { ok:false, status_code, error, latency_ms, ... } (ProviderTestResult,
      //                                                      ConnectionTestResult)
      //
      // Falling through to the raw text means a non-JSON 4xx (a 5xx
      // body that's "internal error") still renders cleanly. The parsed
      // object is attached on the thrown Error so callers that want
      // richer detail (an inline test-result component) read it
      // without re-parsing.
      let msg = text || `${res.status}`;
      let parsed: any = undefined;
      if (text) {
        try {
          const obj = JSON.parse(text);
          parsed = obj;
          if (obj && typeof obj === "object") {
            if (obj.health_check && typeof obj.detail === "string" && obj.detail.trim() !== "") {
              msg = `${obj.error || "Credential check failed"} — ${obj.detail}`;
            } else if (typeof obj.error === "string" && obj.error.trim() !== "") {
              msg = obj.error;
            } else if (typeof obj.message === "string" && obj.message.trim() !== "") {
              msg = obj.message;
            }
          }
        } catch {
          // not JSON — leave msg as the raw text.
        }
      }
      const err: any = new Error(msg);
      if (parsed !== undefined) err.body = parsed;
      err.status = res.status;
      throw err;
    }
    if (res.status === 204) return undefined as T;
    return await res.json() as T;
  };

  // Dashboard panels often request the same read model in the same render
  // pass (the root page previously fired five identical /agents calls).
  // Share only truly concurrent GETs; there is no stale cache after settle,
  // so mutation-driven refreshes still see fresh data immediately.
  if (method === "GET" && body === undefined) {
    const headerKey = JSON.stringify(Object.entries(headers).sort(([a], [b]) => a.localeCompare(b)));
    const key = `${url}|${headerKey}`;
    const existing = inFlightGETs.get(key);
    if (existing) return existing as Promise<T>;
    const pending = execute();
    inFlightGETs.set(key, pending);
    const cleanup = () => {
      if (inFlightGETs.get(key) === pending) inFlightGETs.delete(key);
    };
    void pending.then(cleanup, cleanup);
    return pending;
  }
  return execute();
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
  agent_lifecycle: {
    update_policy: "restart" | "rolling" | "preserve";
    boot_resume: "auto" | "staggered" | "manual";
    boot_resume_delay: string;
    rollout_delay: string;
    legacy_detach_active: boolean;
  };
}

export const serverSettings = {
  get: () => request<ServerSettings>("GET", "/settings/server"),
  update: (patch: {
    public_url?: string;
    agent_update_policy?: "restart" | "rolling" | "preserve";
    agent_boot_resume?: "auto" | "staggered" | "manual";
    agent_boot_resume_delay?: string;
    agent_rollout_delay?: string;
  }) =>
    request<ServerSettings>("PUT", "/settings/server", patch),
};

export interface AgentCoreRollout {
  id?: string;
  state: "idle" | "running" | "completed" | "cancelled";
  scope?: string;
  project_id?: string;
  total: number;
  completed: number;
  failed: number;
  current_agent_id?: number;
  current_agent_name?: string;
  delay_seconds: number;
  errors?: Record<string, string>;
  started_at?: string;
  finished_at?: string;
  target_core_version?: string;
}

export const agentCoreRollouts = {
  get: () => request<AgentCoreRollout>("GET", "/agents/core-rollout"),
  startAgent: (agentId: number) =>
    request<AgentCoreRollout>("POST", `/agents/${agentId}/core-update`),
  startProject: (projectId: string, delaySeconds?: number) =>
    request<AgentCoreRollout>("POST", "/agents/core-rollout", {
      project_id: projectId,
      ...(delaySeconds !== undefined ? { delay_seconds: delaySeconds } : {}),
    }),
  startAll: (delaySeconds?: number) =>
    request<AgentCoreRollout>("POST", "/agents/core-rollout", {
      all: true,
      ...(delaySeconds !== undefined ? { delay_seconds: delaySeconds } : {}),
    }),
  cancel: () => request<{ cancel_requested: boolean }>("DELETE", "/agents/core-rollout"),
};

// Auth
export const auth = {
  status: () =>
    request<{ reg_mode: string; needs_setup: boolean }>("GET", "/auth/status"),

  register: (email: string, password: string, setupToken?: string, inviteToken?: string) => {
    const headers: Record<string, string> = {};
    if (setupToken) headers["X-Setup-Token"] = setupToken;
    if (inviteToken) headers["X-Invite-Token"] = inviteToken;
    return request<{ id: number; email: string }>(
      "POST",
      "/auth/register",
      { email, password },
      Object.keys(headers).length > 0 ? headers : undefined,
    );
  },

  login: (email: string, password: string) =>
    request<{ user_id: number; email: string }>("POST", "/auth/login", { email, password }),

  logout: () =>
    request<any>("POST", "/auth/logout").then(() => {
      window.location.href = "/login";
    }),

  me: () =>
    request<{ user_id: number; email: string; role: PlatformRole; created_at: string; onboarded: boolean; onboarded_at?: string; language?: string }>("GET", "/auth/me"),

  updatePreferences: (patch: { language?: string }) =>
    request<{ language: string }>("PUT", "/auth/preferences", patch),

  completeOnboarding: () =>
    request<{ status: string }>("POST", "/auth/onboarding/complete"),

  // POST /auth/password — change the logged-in user's password. The
  // server revokes every OTHER active session for this user on
  // success so a leaked cookie on another device stops working
  // immediately. The cookie making the change keeps working.
  changePassword: (currentPassword: string, newPassword: string) =>
    request<{ status: string }>(
      "POST",
      "/auth/password",
      { current_password: currentPassword, new_password: newPassword },
    ),

  // Personal API keys for this user. Backed by /auth/keys — server scopes
  // each key to the calling user via the session cookie. The raw key is
  // only returned by createKey; subsequent listKeys only exposes the prefix.
  createKey: (
    name: string,
    options?: {
      kind?: "private" | "public_client";
      project_id?: string;
      scopes?: unknown;
      allowed_origins?: string[];
      rate_limit_per_minute?: number;
      expires_at?: string;
    },
  ) =>
    request<{ id: number; key: string; prefix: string; kind: string }>("POST", "/auth/keys", {
      name,
      ...(options || {}),
    }),

  listKeys: () =>
    request<Array<{
      id: number;
      name: string;
      key_prefix: string;
      kind?: "private" | "public_client";
      project_id?: string;
      scopes?: string;
      allowed_origins?: string;
      rate_limit_per_minute?: number;
      expires_at?: string;
      revoked_at?: string;
      last_used?: string;
      last_used_ip?: string;
      created_at: string;
    }>>("GET", "/auth/keys"),

  deleteKey: (id: number) =>
    request<any>("DELETE", `/auth/keys/${id}`),
};

// --- User administration ------------------------------------------------
//
// Admin-facing CRUD on the users table. Backing endpoints live at
// /api/users; access is gated server-side (admin = user_id 1 today).
// Non-admins calling list/create/delete get 403; GET /users/:id works
// for self too, so the same API object serves the "view my profile"
// surface.

export interface UserRow {
  id: number;
  email: string;
  created_at: string;
  agents: number;
  keys: number;
  projects: number;
  providers?: number;
  connections?: number;
  mcp_servers?: number;
  subscriptions?: number;
  channels?: number;
  is_admin: boolean;
  is_self: boolean;
}

export interface UserDeletePreview {
  user: { id: number; email: string };
  would_delete: {
    agents: number;
    keys: number;
    projects: number;
    providers: number;
    connections: number;
    mcp_servers: number;
    subscriptions: number;
    channels: number;
  };
}

export const users = {
  list: () => request<UserRow[]>("GET", "/users"),
  create: (email: string, password: string) =>
    request<{ id: number; email: string; created_at: string }>(
      "POST",
      "/users",
      { email, password },
    ),
  get: (id: number) => request<UserRow>("GET", `/users/${id}`),
  // dry_run=true returns the blast-radius preview without deleting.
  preview: (id: number) =>
    request<UserDeletePreview>("DELETE", `/users/${id}?dry_run=1`),
  remove: (id: number) => request<{ status: string }>("DELETE", `/users/${id}`),
  // Admin-side password reset: no current-password check, revokes every
  // session of the target user so they must log in again.
  resetPassword: (id: number, newPassword: string) =>
    request<{ status: string }>(
      "PATCH",
      `/users/${id}/password`,
      { new_password: newPassword },
    ),

};

// Provider types (catalog)
export interface ProviderTypeInfo {
  id: number;
  type: string;
  name: string;
  description: string;
  fields: string[];
  requires_credentials: boolean;
  auth_type?: "api_key" | "oauth_device_code" | "oauth_browser" | "external_process" | "none" | string;
  auth_provider?: string;
  runtime_status?: "available" | "auth_only" | "unsupported" | string;
  capabilities?: string[];
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

// Agent templates — starter configs surfaced in /agents/new wizard.
// Builtin rows are seeded by the server, app-contributed rows arrive
// on app install, user rows are created here via .create() or
// .saveFromAgent (TBD).
export interface Requirement {
  // One entry on a template's setup checklist. kind drives which
  // wizard step satisfies it: app=install via apps.install,
  // integration=create/select a connection, channel=bind a channel
  // to the agent, skill=push a markdown playbook.
  kind: "app" | "integration" | "channel" | "skill";
  slug?: string;
  role?: string;
  // For kind=channel: "email" | "slack" | "telegram" | ...
  type?: string;
  // Any of these integration slugs can satisfy the requirement.
  compatible_slugs?: string[];
  capabilities?: string[];
  bind_to?: { app: string; role: string };
  reason?: string;
  required: boolean;
  source?: string;
  config?: Record<string, unknown>;
}

export interface TemplateLogo {
  // One icon resolved server-side from a Requirement. The wizard's
  // card row renders these as a small horizontal cluster.
  kind: "app" | "integration" | "channel";
  slug: string;
  icon_url?: string;
  label: string;
  // "direct" — declared on the template itself.
  // "derived" — pulled from a required app's requires.integrations.
  source: "direct" | "derived";
  via?: string;
}

export interface AgentTemplate {
  id: string;
  user_id?: number;
  source: "builtin" | "app" | "user";
  source_ref?: string;
  name: string;
  // Short icon name resolved by the dashboard to a stroked SVG
  // (see TemplateIcon in pages/AgentNew.tsx). Empty / unknown names
  // fall back to a generic neutral glyph.
  icon?: string;
  description: string;
  directive: string;
  mode: "autonomous" | "cautious" | "learn";
  unconscious: boolean;
  recommended_apps: string[];
  // Structured setup checklist. Drives the Setup step of the wizard
  // and the card-level logo strip (after server resolution).
  requirements: Requirement[];
  // Server-resolved logos for the card. Walks requirements + the app
  // marketplace + the integrations catalog so the dashboard doesn't
  // need either of those itself to render a card.
  resolved_logos?: TemplateLogo[];
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export const agentTemplates = {
  list: () => request<AgentTemplate[]>("GET", "/agent-templates"),
  get: (id: string) => request<AgentTemplate>("GET", `/agent-templates/${encodeURIComponent(id)}`),
  create: (t: Partial<AgentTemplate>) =>
    request<AgentTemplate>("POST", "/agent-templates", t),
  update: (id: string, t: Partial<AgentTemplate>) =>
    request<AgentTemplate>("PUT", `/agent-templates/${encodeURIComponent(id)}`, t),
  delete: (id: string) =>
    request<any>("DELETE", `/agent-templates/${encodeURIComponent(id)}`),
  hide: (id: string) =>
    request<any>("POST", `/agent-templates/${encodeURIComponent(id)}/hide`, {}),
  unhide: (id: string) =>
    request<any>("POST", `/agent-templates/${encodeURIComponent(id)}/unhide`, {}),
};


export const projects = {
  list: () => request<Project[]>("GET", "/projects"),
  create: (name: string, description?: string, color?: string) =>
    request<Project>("POST", "/projects", { name, description: description || "", color: color || "" }),
  get: (id: string) => request<Project>("GET", `/projects/${id}`),
  update: (id: string, name: string, description: string, color: string) =>
    request<Project>("PUT", `/projects/${id}`, { name, description, color }),
  delete: (id: string) => request<any>("DELETE", `/projects/${id}`),
};

// ─── Multi-user + roles ────────────────────────────────────────────────

export type PlatformRole = "user" | "admin";
export type ProjectRole = "viewer" | "editor" | "owner";

export interface ProjectMember {
  project_id: string;
  user_id: number;
  email: string;
  role: ProjectRole;
  added_by?: number;
  added_at: string;
}

export interface ProjectInvite {
  id: string;
  project_id: string;
  email: string;
  role: ProjectRole;
  invited_by: number;
  expires_at: string;
  accepted_at?: string;
  created_at: string;
}

// Preview shape for /api/invites/:token — what the dashboard's invite
// banner needs to show "You've been invited to <Project> by <inviter>".
export interface InvitePreview {
  email: string;
  role: ProjectRole;
  project_id?: string;
  project_name?: string;
  inviter_email?: string;
}

// User wire shape returned from /api/admin/users (admin-only listing).
// AuthUser in useAuth.ts is the same minus password_hash; this carries
// the role explicitly because the admin UI is the place it's edited.
export interface AdminUser {
  id: number;
  email: string;
  role: PlatformRole;
  created_at: string;
}

export const projectMembers = {
  list: (projectID: string) =>
    request<ProjectMember[]>("GET", `/projects/${projectID}/members`),
  updateRole: (projectID: string, userID: number, role: ProjectRole) =>
    request<{ status: string }>(
      "PATCH",
      `/projects/${projectID}/members/${userID}`,
      { role },
    ),
  remove: (projectID: string, userID: number) =>
    request<{ status: string }>(
      "DELETE",
      `/projects/${projectID}/members/${userID}`,
    ),
};

export const projectInvites = {
  list: (projectID: string) =>
    request<ProjectInvite[]>("GET", `/projects/${projectID}/members/invites`),
  // Returns one of two shapes:
  //   {kind:"added",   user_id, email, role}      — existing user
  //   {kind:"invited", invite: ProjectInvite}     — new email, link minted
  // Lets the dashboard show the right confirmation without a second
  // round-trip ("Added Alice to the project" vs "Invite link ready
  // to copy").
  create: (projectID: string, email: string, role: ProjectRole) =>
    request<
      | { kind: "added"; user_id: number; email: string; role: ProjectRole }
      | { kind: "invited"; invite: ProjectInvite }
    >("POST", `/projects/${projectID}/members/invites`, { email, role }),
  revoke: (projectID: string, token: string) =>
    request<{ status: string }>(
      "DELETE",
      `/projects/${projectID}/members/invites/${token}`,
    ),
  // Public-ish preview — fetched from the /login banner.
  preview: (token: string) => request<InvitePreview>("GET", `/invites/${token}`),
  // Accept requires a logged-in user whose email matches the invite.
  accept: (token: string) =>
    request<{ status: string; project_id: string; role: ProjectRole }>(
      "POST",
      `/invites/${token}/accept`,
    ),
};

export const adminUsers = {
  list: () => request<AdminUser[]>("GET", "/admin/users"),
  setRole: (userID: number, role: PlatformRole) =>
    request<{ status: string }>("PATCH", `/admin/users/${userID}`, { role }),
};

// Agents
// Agent safety mode. Source of truth: core/config.go.
export type RunMode = "autonomous" | "cautious" | "learn";

export interface Agent {
  id: number;
  user_id: number;
  name: string;
  directive: string;
  mode: RunMode;
  config: string;
  port: number;
  pid: number;
  status: string;
  project_id?: string;
  kind?: string;
  core_version?: string;
  core_build_time?: string;
  core_started_at?: string;
  target_core_version?: string;
  core_update_available?: boolean;
  created_at: string;
}

export interface BackgroundMemoryState {
  enabled: boolean;
  previous?: boolean;
  running: boolean;
  restarted?: boolean;
  restart_required: boolean;
  memory_preserved?: boolean;
}

export interface PlatformHelperCapabilities {
  selected_mcp_server_ids: number[];
  applied: boolean;
  reset_threads?: number;
}

export const platformHelper = {
  get: () => request<Agent>("GET", "/platform/helper"),
  capabilities: () =>
    request<PlatformHelperCapabilities>("GET", "/platform/helper/capabilities"),
  updateCapabilities: (mcpServerIds: number[]) =>
    request<PlatformHelperCapabilities>("PUT", "/platform/helper/capabilities", {
      mcp_server_ids: mcpServerIds,
    }),
};

export const instances = {
  list: (projectId?: string) => {
    const params = projectId ? `?project_id=${encodeURIComponent(projectId)}` : "";
    return request<Agent[]>("GET", `/agents${params}`);
  },

  create: (
    name: string,
    directive?: string,
    mode?: string,
    projectId?: string,
    start?: boolean,
    opts?: {
      includeChannels?: boolean;
      unconscious?: boolean;
      // Setup-step selections — explicit lists of apps + integration
      // connections the operator wants attached as MCP servers on
      // this new agent. Server writes app_agent_bindings rows for
      // the apps and appends per-connection /mcp/<id> URLs to the
      // agent's config.json mcp_servers list. Missing = "default
      // behaviour" (all project-visible apps reachable through the
      // gateway, no extra explicit MCP rows).
      boundAppInstallIDs?: number[];
      boundConnectionIDs?: number[];
      boundAppGrants?: AppGrantPolicy[];
    },
  ) =>
    request<Agent & { warning?: string }>("POST", "/agents", {
      name,
      directive: directive || "",
      mode: mode || "autonomous",
      project_id: projectId || "",
      // Server default is start=true; pass explicit false to create stopped.
      ...(start === false ? { start: false } : {}),
      ...(opts?.includeChannels !== undefined
        ? { include_channels: opts.includeChannels }
        : {}),
      // Unconscious: when set, spawns the background memory-consolidation
      // thread (core/thinker.go). Per-agent so a personal-assistant
      // template can enable it while a fast/stateless agent stays out.
      ...(opts?.unconscious !== undefined ? { unconscious: opts.unconscious } : {}),
      ...(opts?.boundAppInstallIDs && opts.boundAppInstallIDs.length > 0
        ? { bound_app_install_ids: opts.boundAppInstallIDs }
        : {}),
      ...(opts?.boundConnectionIDs && opts.boundConnectionIDs.length > 0
        ? { bound_connection_ids: opts.boundConnectionIDs }
        : {}),
      ...(opts?.boundAppGrants && opts.boundAppGrants.length > 0
        ? { bound_app_grants: opts.boundAppGrants }
        : {}),
    }),

  get: (id: number) => request<Agent>("GET", `/agents/${id}`),

  rename: (id: number, name: string) =>
    request<Agent>("PUT", `/agents/${id}`, { name }),

  delete: (id: number) => request<any>("DELETE", `/agents/${id}`),

  stop: (id: number) => request<Agent>("POST", `/agents/${id}/stop`),

  start: (id: number) => request<Agent>("POST", `/agents/${id}/start`),

  pause: (id: number) => request<{ paused: boolean }>("POST", `/agents/${id}/pause`),

  backgroundMemory: {
    get: (id: number) =>
      request<BackgroundMemoryState>("GET", `/agents/${id}/background-memory`),
    set: (id: number, enabled: boolean, restart = false) =>
      request<BackgroundMemoryState>("PUT", `/agents/${id}/background-memory`, {
        enabled,
        restart,
      }),
  },

  sendEvent: (id: number, message: string | Array<{ type: string; text?: string; image_url?: { url: string }; audio_url?: { url: string; mime_type?: string } }>, threadId?: string) =>
    request<any>("POST", `/agents/${id}/event`, { message, ...(threadId ? { thread_id: threadId } : {}) }),

  updateConfig: (id: number, opts: {
    directive?: string;
    mode?: string;
    providers?: Array<{ name: string; default: boolean }>;
    modelOverride?: string;
    realtimeEnabled?: boolean;
    realtimeVoice?: string;
    realtimeVoiceMCP?: string[];
  }) =>
    request<Agent>("PUT", `/agents/${id}/config`, {
      ...(opts.directive ? { directive: opts.directive } : {}),
      ...(opts.mode ? { mode: opts.mode } : {}),
      ...(opts.providers ? { providers: opts.providers } : {}),
      ...(opts.modelOverride !== undefined ? { model_override: opts.modelOverride } : {}),
      ...(opts.realtimeEnabled !== undefined ? { realtime_enabled: opts.realtimeEnabled } : {}),
      ...(opts.realtimeVoice !== undefined ? { realtime_voice: opts.realtimeVoice } : {}),
      ...(opts.realtimeVoiceMCP !== undefined ? { realtime_voice_mcp: opts.realtimeVoiceMCP } : {}),
    }),

  chatHistory: (id: number, limit?: number) =>
    request<ChatHistoryMessage[]>("GET", `/agents/${id}/chat-history${limit ? `?limit=${limit}` : ""}`),
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
  auth_status?: string;
  runtime_status?: string;
  project_id?: string;
  created_at: string;
  updated_at: string;
}

export interface ProviderDetail extends Provider {
  data: Record<string, string>;
}

export interface ProviderUsageWindow {
  id: string;
  used_percent: number;
  duration_minutes?: number;
  resets_at?: string;
}

export interface ProviderUsageLimit {
  id: string;
  label: string;
  reached?: boolean;
  windows?: ProviderUsageWindow[];
}

export interface ProviderUsageSnapshot {
  supported: boolean;
  provider_id: number;
  kind?: "subscription_quota" | string;
  plan?: string;
  fetched_at?: string;
  stale?: boolean;
  limits?: ProviderUsageLimit[];
  credits?: {
    has_credits: boolean;
    unlimited: boolean;
    balance?: string;
  };
  rate_limit_reached_type?: string;
}

export interface ModelInfo {
  id: string;
  name: string;
  description?: string;
  context_size?: number;
  priority?: number;
  supported_in_api?: boolean;
  capabilities?: {
    context_window?: number;
    max_context_window?: number;
    effective_context_window_percent?: number;
    default_reasoning_level?: string;
    supported_reasoning_levels?: Array<{ effort: string; description?: string }>;
    input_modalities?: string[];
    supports_parallel_tool_calls?: boolean;
    supports_reasoning_summaries?: boolean;
    supports_image_detail_original?: boolean;
    supports_search_tool?: boolean;
  };
  input_cost?: number;
  output_cost?: number;
}

// ProviderTestResult mirrors the server's ConnectionTestResult shape
// so the dashboard's success-or-failure renderer is a single
// component across both surfaces. Returned by POST /providers/:id/test
// AND by POST /providers when a pre-flight check rejects bogus
// credentials (HTTP 400 + this body).
export interface ProviderTestResult {
  ok: boolean;
  skipped?: boolean;
  reason?: string;
  latency_ms: number;
  status_code?: number;
  error?: string;
  // model_count is set on success when the probe can extract a count
  // from the upstream's listing endpoint (OpenAI/Anthropic/Fireworks
  // /v1/models → data.length, ElevenLabs voices, Ollama models).
  // Lets the dashboard render "12 models available" as a small
  // confirmation that the probe actually saw the upstream's
  // catalog and not a cached 200.
  model_count?: number;
  model?: string;
  response_text?: string;
  prompt_tokens?: number;
  completion_tokens?: number;
  cached_tokens?: number;
  tool_call_count?: number;
  tool_name?: string;
  tool_arguments?: string;
}

export interface ProviderAuthStart {
  session_id: string;
  provider: string;
  method: string;
  verification_uri?: string;
  user_code?: string;
  expires_at?: string;
  interval_seconds?: number;
  runtime_status?: string;
  provider_type_id?: number;
  provider_type_name?: string;
}

export interface ProviderAuthStatus {
  status?: string;
  auth_status?: string;
  provider?: string;
  auth_type?: string;
  runtime_status?: string;
  expires_at?: string;
  last_refresh?: string;
  next_poll_seconds?: number;
  error?: string;
  account?: Record<string, any>;
}

export const providers = {
  // If projectId is passed, the response includes providers scoped to that
  // project PLUS any unscoped "global" ones (project_id = '').
  list: (projectId?: string) => {
    const params = projectId ? `?project_id=${encodeURIComponent(projectId)}` : "";
    return request<Provider[]>("GET", `/providers${params}`);
  },

  get: (id: number) => request<ProviderDetail>("GET", `/providers/${id}`),

  models: (id: number, refresh = false) =>
    request<ModelInfo[]>("GET", `/providers/${id}/models${refresh ? "?refresh=1" : ""}`),

  usage: (id: number, refresh = false) =>
    request<ProviderUsageSnapshot>("GET", `/providers/${id}/usage${refresh ? "?refresh=1" : ""}`),

  updateModels: (id: number, models: { large: string; medium: string; small: string }) =>
    request<{ status: string; large: string; medium: string; small: string }>(
      "PUT",
      `/providers/${id}/models`,
      models,
    ),

  create: (type: string, name: string, data: Record<string, string>, providerTypeId?: number, projectId?: string) =>
    request<Provider>("POST", "/providers", {
      type,
      name,
      data,
      provider_type_id: providerTypeId || 0,
      project_id: projectId || "",
    }),

  // Test an already-saved provider's credentials. Used by the "Test"
  // button on each row in the Settings page providers section.
  test: (id: number) =>
    request<ProviderTestResult>("POST", `/providers/${id}/test`, {}),

  authStart: (providerTypeId: number, projectId?: string) =>
    request<ProviderAuthStart>("POST", "/providers/auth/start", {
      provider_type_id: providerTypeId,
      project_id: projectId || "",
    }),

  authPoll: (sessionId: string) =>
    request<ProviderAuthStatus>("GET", `/providers/auth/${encodeURIComponent(sessionId)}`),

  authStatus: (id: number) =>
    request<ProviderAuthStatus>("GET", `/providers/${id}/auth/status`),

  authRefresh: (id: number) =>
    request<ProviderAuthStatus>("POST", `/providers/${id}/auth/refresh`, {}),

  authLogout: (id: number) =>
    request<ProviderAuthStatus>("POST", `/providers/${id}/auth/logout`, {}),

  authSmokeTest: (id: number) =>
    request<ProviderTestResult>("POST", `/providers/${id}/auth/smoke-test`, {}),

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
  explorer?: IntegrationExplorerConfig;
}

export interface IntegrationExplorerConfig {
  resources: IntegrationExplorerResource[];
}

export interface IntegrationExplorerResource {
  id: string;
  label: string;
  description?: string;
  list_tool: string;
  list_input?: Record<string, any>;
  response_path?: string;
  item_id_path?: string;
  item_label_path?: string;
  item_subtitle_path?: string;
  detail_tool?: string;
  detail_input?: Record<string, any>;
  actions?: IntegrationExplorerAction[];
}

export interface IntegrationExplorerAction {
  label: string;
  tool: string;
  input?: Record<string, any>;
  destructive?: boolean;
  description?: string;
}

export interface ConnectionInfo {
  id: number;
  app_slug: string;
  app_name: string;
  name: string;
  logo?: string;
  auth_type: string;
  status: string;
  source: string;                // 'local' | 'composio'
  provider_id?: number;
  external_id?: string;
  project_id?: string;
  created_via?: "integration" | "app_install" | string;
  owner_app_install_id?: number;
  auto_mcp?: boolean;
  tool_count: number;
  created_at: string;
  // Populated server-side when this connection is a member of a
  // credential-group suite. `is_group_child` means its credentials
  // live on a sibling master row; `external_project_id` is the id of
  // the upstream project the child is pinned to (e.g. OmniKit project
  // id). Both are absent for legacy single-key connections.
  group_id?: string;
  is_group_child?: boolean;
  external_project_id?: string;
}

export interface DeviceAuthStart {
  session_id: string;
  provider: string;
  method: "oauth_device_code" | string;
  verification_uri: string;
  user_code: string;
  expires_at: string;
  interval_seconds: number;
}

export interface DeviceAuthStatus {
  status: "pending" | "connected" | "expired" | "failed" | string;
  next_poll_seconds?: number;
  error?: string;
  connection?: ConnectionInfo;
  account?: { id?: string; email?: string };
}

// Response shape when a connection create kicks off an OAuth flow (local
// oauth2/composio) or an oauth_device_code flow.
export interface ConnectCreateResponse {
  connection: ConnectionInfo;
  redirect_url?: string;
  device_auth?: DeviceAuthStart;
}

/** Result of running the catalog-declared health_check probe
 *  against a connection's stored credentials. The server returns
 *  this either via POST /connections/:id/test (manual button) or
 *  inline in POST /connections's 400 body when the pre-flight
 *  check rejects newly-entered credentials.
 *
 *  ok=true with skipped=true means the catalog has no health_check
 *  for this app — the dashboard should render a neutral state
 *  ("Test not available") rather than green/red. */
export interface ConnectionTestResult {
  ok: boolean;
  skipped?: boolean;
  reason?: string;
  latency_ms: number;
  status_code?: number;
  error?: string;
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

export interface IntegrationUsageRow {
  app_slug: string;
  tool: string;
  unit: string;
  direction: string;
  grant_id?: string;
  grant_resource?: string;
  connection_id?: number;
  parent_connection_id?: number;
  child_install_id?: number;
  child_connection_id?: number;
  caller_install_id?: number;
  caller_app_name?: string;
  quantity: number;
  calls: number;
  errors: number;
  last_used_at?: string;
}

export interface IntegrationUsageTotal {
  app_slug: string;
  unit: string;
  quantity: number;
  calls: number;
  errors: number;
}

export interface IntegrationUsageSummary {
  since: string;
  rows: IntegrationUsageRow[];
  totals: IntegrationUsageTotal[];
}

export const integrations = {
  catalog: (q?: string, opts?: { collapseGroups?: boolean }) => {
    const qs = new URLSearchParams();
    if (q) qs.set("q", q);
    // When collapseGroups is true the server hides apps that are
    // members of a credential group — the UI shows one suite card
    // instead of the per-app cards. Use listGroups() to fetch the
    // group metadata alongside.
    if (opts?.collapseGroups) qs.set("group", "1");
    const params = qs.toString() ? `?${qs.toString()}` : "";
    return request<AppSummary[]>("GET", `/integrations/catalog${params}`);
  },

  // Credential-group (suite) catalog — OmniKit, SocialCast, ...
  listGroups: () =>
    request<Array<{
      id: string;
      name: string;
      logo?: string | null;
      description?: string;
      members: Array<{ slug: string; name: string; tool_count: number; logo?: string | null }>;
      has_account_scope: boolean;
      has_project_scope: boolean;
    }>>("GET", "/integrations/groups"),

  getGroup: (id: string) =>
    request<{
      summary: {
        id: string;
        name: string;
        logo?: string | null;
        description?: string;
        members: Array<{ slug: string; name: string; tool_count: number; logo?: string | null }>;
        has_account_scope: boolean;
        has_project_scope: boolean;
      };
      discovery?: unknown;
      account_scope?: { credential_fields: Array<{ name: string; label: string; description?: string; type?: string }> };
      project_scope?: { credential_fields: Array<{ name: string; label: string; description?: string; type?: string }> };
    }>("GET", `/integrations/groups/${id}`),

  // Add or replace an account-wide credential for a suite. Runs
  // discovery and returns the cached project list; UI shows a matrix.
  addGroupMaster: (groupId: string, credentials: Record<string, string>, projectId?: string) =>
    request<{ master_id: number; projects: Array<{ id: string; label: string }> }>(
      "POST",
      `/integrations/groups/${groupId}/master`,
      { credentials, project_id: projectId || "" },
    ),

  getGroupMaster: (groupId: string, projectId?: string) => {
    const params = projectId ? `?project_id=${projectId}` : "";
    return request<{
      master: { id: number; project_id: string; name: string; credentials_masked: Record<string, string> } | null;
      projects?: Array<{ id: string; label: string }>;
      children?: Array<{ id: number; app_slug: string; name: string; project_id: string }>;
    }>("GET", `/integrations/groups/${groupId}/master${params}`);
  },

  refreshGroupProjects: (groupId: string, projectId?: string) =>
    request<{ projects: Array<{ id: string; label: string }> }>(
      "POST",
      `/integrations/groups/${groupId}/master/refresh`,
      { project_id: projectId || "" },
    ),

  // Fan out the suite credential into project-scoped connections.
  // Each selection creates one child connections row bound to the
  // (app, external project) pair.
  enableGroupApps: (
    groupId: string,
    selections: Array<{ app_slug: string; external_project_id: string; label?: string }>,
    opts?: { projectId?: string; replace?: boolean },
  ) =>
    request<{
      created: Array<{ id: number; app_slug: string; project_id: string; name: string }>;
      already_exists: number;
      removed: number[];
    }>("POST", `/integrations/groups/${groupId}/master/enable`, {
      project_id: opts?.projectId || "",
      selections,
      replace: !!opts?.replace,
    }),

  // Cascade-delete master + every child bound to it.
  deleteGroupMaster: (groupId: string, projectId?: string) => {
    const params = projectId ? `?project_id=${projectId}` : "";
    return request<{ removed: number }>("DELETE", `/integrations/groups/${groupId}/master${params}`);
  },

  catalogStatus: () => request<CatalogStatus>("GET", "/integrations/catalog/status"),

  downloadCatalog: () => request<{ status: string; count: number }>("POST", "/integrations/catalog/download"),

  usage: (opts?: { projectId?: string; period?: string }) => {
    const params = new URLSearchParams();
    if (opts?.projectId) params.set("project_id", opts.projectId);
    if (opts?.period) params.set("period", opts.period);
    const qs = params.toString();
    return request<IntegrationUsageSummary>("GET", `/integrations/usage${qs ? `?${qs}` : ""}`);
  },

  app: (slug: string) => request<AppDetail>("GET", `/integrations/catalog/${slug}`),

  connections: (projectId?: string, opts?: { includeAppOwned?: boolean }) => {
    const params = new URLSearchParams();
    if (projectId) params.set("project_id", projectId);
    if (opts?.includeAppOwned) params.set("include_app_owned", "1");
    const qs = params.toString();
    return request<ConnectionInfo[]>("GET", `/connections${qs ? `?${qs}` : ""}`);
  },

  // Owner-only credential reveal. Returns the decrypted token map for
  // the connection. Server logs each call for audit; the dashboard
  // gates this behind an explicit "Reveal" click in the row's modal.
  credentials: (connectionId: number) =>
    request<{ credentials: Record<string, string> }>(
      "GET",
      `/connections/${connectionId}/credentials`,
    ),

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
    createdVia?: "integration" | "app_install",
    autoMCP?: boolean,
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
      ...(createdVia ? { created_via: createdVia } : {}),
      // Pass through whatever the caller said. Server default is
      // OFF (no MCP) when the field is omitted, so callers that
      // want exposure (the Integrations connect form, the wizard's
      // ConnectIntegrationModal) must send auto_mcp=true
      // explicitly. The old wrapper only forwarded the false
      // value, which silently broke auto-MCP for every dashboard
      // caller passing autoMCP=true.
      ...(autoMCP !== undefined ? { auto_mcp: autoMCP } : {}),
    }),

  // Run the per-app health_check probe against the stored
  // credentials of an existing connection. The server replies
  // with { ok, latency_ms, status_code?, error?, skipped?,
  // reason? } either way; OK=false is normal payload not an
  // HTTP error so callers don't need a try/catch around the
  // failure case. Apps without a health_check declared in their
  // catalog return { ok: true, skipped: true, reason: "..." }
  // — render those as a neutral state rather than success.
  testConnection: (connectionId: number) =>
    request<ConnectionTestResult>("POST", `/connections/${connectionId}/test`, {}),

  /** Move a connection between project and global scope. project_id=""
   *  → global; an id → that project. Mirror of apps.setScope (v0.14.5)
   *  but for connections. Returns a summary of what moved (the row
   *  + its auto-MCP). Refuses for composio-source connections —
   *  Composio's hosted connected_account is bound to a project on
   *  their side too. */
  setConnectionScope: (connectionId: number, projectId: string) =>
    request<{
      connection_id: number;
      old_project_id: string;
      new_project_id: string;
      mcp_servers_migrated: number;
    }>("PATCH", `/connections/${connectionId}/scope`, { project_id: projectId }),

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

  deviceAuthPoll: (sessionId: string) =>
    request<DeviceAuthStatus>("GET", `/connections/auth/${encodeURIComponent(sessionId)}`),

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

  reauth: (id: number) =>
    request<ConnectCreateResponse>("POST", `/connections/${id}/oauth/reauth`, {}),

  disconnect: (id: number) => request<any>("DELETE", `/connections/${id}`),

  rename: (id: number, name: string) =>
    request<ConnectionInfo>("PATCH", `/connections/${id}`, { name }),

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
    request<Array<{ name: string; description: string; method: string; path: string; input_schema: Record<string, any> }>>("GET", `/connections/${id}/tools`),

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
  source: string;          // 'custom' | 'managed' | 'local' | 'remote' | 'app'
  transport?: string;      // 'stdio' | 'http'
  url?: string;
  provider_id?: number;
  connection_id: number;
  created_via?: "integration" | "app_install" | string;
  owner_app_install_id?: number;
  upstream_id?: string;
  // allowed_tools is the persisted tool filter. Empty/null means "all tools
  // exposed" (legacy). A populated array means only those tools are served
  // by this MCP server row — enforced server-side for local rows and
  // forwarded to Composio as `actions` for remote rows.
  allowed_tools?: string[] | null;
  project_id?: string;
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

export interface ManagedMCPTool {
  name: string;
  description: string;
  inputSchema: Record<string, any>;
  outputSchema?: Record<string, any>;
  handler: string;
  code: string;
}

export interface ManagedMCPDefinition {
  version: number;
  tools: ManagedMCPTool[];
}

export interface ManagedMCPBindings {
  integrations: Record<string, number>;
  apps: Record<string, number>;
}

export interface ManagedMCPDetails {
  server: MCPServer;
  definition: ManagedMCPDefinition;
  bindings: ManagedMCPBindings;
  env_keys: string[];
  warning?: string;
}

export interface ManagedMCPCreateInput {
  name: string;
  description: string;
  project_id: string;
  definition: ManagedMCPDefinition;
  bindings: ManagedMCPBindings;
  env?: Record<string, string>;
  start?: boolean;
}

export interface ManagedMCPUpdateInput {
  description?: string;
  definition?: ManagedMCPDefinition;
  bindings?: ManagedMCPBindings;
  env?: Record<string, string>;
  delete_env?: string[];
}

export const mcpServers = {
  list: (projectId?: string, opts?: { includeAppOwned?: boolean }) => {
    const params = new URLSearchParams();
    if (projectId) params.set("project_id", projectId);
    if (opts?.includeAppOwned) params.set("include_app_owned", "1");
    const qs = params.toString();
    return request<MCPServer[]>("GET", `/mcp-servers${qs ? `?${qs}` : ""}`);
  },

  create: (name: string, command: string, args: string[], env: Record<string, string>, description: string, projectId?: string) =>
    request<MCPServer>("POST", "/mcp-servers", { name, command, args, env, description, project_id: projectId || "" }),

  createManaged: (input: ManagedMCPCreateInput) =>
    request<ManagedMCPDetails>("POST", "/mcp-servers/managed", input),

  managed: (id: number) =>
    request<ManagedMCPDetails>("GET", `/mcp-servers/${id}/managed`),

  updateManaged: (id: number, input: ManagedMCPUpdateInput) =>
    request<ManagedMCPDetails>("PUT", `/mcp-servers/${id}/managed`, input),

  validateManaged: (id: number, definition: ManagedMCPDefinition, bindings?: ManagedMCPBindings) =>
    request<{ valid: boolean; tool_count?: number; error?: string }>(
      "POST",
      `/mcp-servers/${id}/validate`,
      { definition, ...(bindings ? { bindings } : {}) },
    ),

  managedLogs: (id: number) =>
    request<{ logs: string }>("GET", `/mcp-servers/${id}/logs`),

  delete: (id: number) => request<any>("DELETE", `/mcp-servers/${id}`),

  // Update the display name (description) of an MCP server row. The
  // canonical slug (MCPServer.name) is NOT touched — it's used as the
  // tool-name prefix and mcp= spawn argument, so changing it would
  // break already-running agents. This is a cosmetic label change only.
  rename: (id: number, description: string) =>
    request<MCPServer>("PATCH", `/mcp-servers/${id}`, { description }),

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
  callTool: (id: number, tool: string, args: Record<string, any>, projectId?: string) =>
    request<{ success: boolean; status: number; data: any }>(
      "POST",
      `/mcp-servers/${id}/call-tool${projectId ? `?project_id=${encodeURIComponent(projectId)}` : ""}`,
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
  notify_agent: boolean;
  events: string[];
  thread_id?: string;
  project_id?: string;
  external_webhook_id?: string;
  source?: "webhook" | "app_event" | string;
  last_seq_delivered?: number;
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
      // 'webhook' (default) or 'app_event'. For 'app_event', `slug`
      // must be '<app>:<topic_pattern>' (e.g. 'tables:*') and events
      // can carry one or more app topics/patterns for the same row.
      source?: "webhook" | "app_event";
      // Composio-source only: which trigger template to instantiate
      // and its config fields (varies per trigger template).
      triggerSlug?: string;
      triggerConfig?: Record<string, any>;
      notifyAgent?: boolean;
    },
  ) =>
    request<{ subscription: SubscriptionInfo; webhook_url: string; auto_registered: boolean; trigger_id?: string; trigger_slug?: string }>(
      "POST",
      "/subscriptions",
      {
        name,
        slug,
        agent_id: instanceId,
        connection_id: opts?.connectionId || 0,
        description: opts?.description || "",
        hmac_secret: opts?.hmacSecret || "",
        events: opts?.events || [],
        thread_id: opts?.threadId || "",
        project_id: opts?.projectId || "",
        source: opts?.source || "webhook",
        trigger_slug: opts?.triggerSlug || "",
        trigger_config: opts?.triggerConfig || {},
        notify_agent: opts?.notifyAgent || false,
      },
    ),

  delete: (id: string) => request<any>("DELETE", `/subscriptions/${id}`),

  enable: (id: string) => request<any>("POST", `/subscriptions/${id}/enable`),

  disable: (id: string) => request<any>("POST", `/subscriptions/${id}/disable`),

  setNotifyAgent: (id: string, notifyAgent: boolean) =>
    request<any>("POST", `/subscriptions/${id}/notify-agent`, { notify_agent: notifyAgent }),

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
  mode: RunMode;
  pending_approval: PendingApproval | null;
  execution_control?: ExecutionControlStatus;
  execution_checkpoints?: ExecutionCheckpointMeta[];
  sleep_state?: SleepState;
  sleep_thread_id?: string;
  sleep_started_at?: string;
  next_wake_at?: string;
  sleep_total_ms?: number;
  sleep_remaining_ms?: number;
  sleep_iteration?: number;
}

export type SleepState = "active" | "sleeping" | "overdue" | "unknown" | "paused" | "stopped" | string;

export interface ExecutionControlStatus {
  mode: "auto" | "paused" | "step";
  scope?: string;
  breakpoints?: string[];
  follow?: string;
  waiting?: boolean;
  phase?: string;
  active_thread_id?: string;
  iteration?: number;
  tool?: string;
  call_id?: string;
  summary?: string;
  args?: Record<string, string>;
  waiting_count?: number;
  can_restore?: boolean;
  restore_checkpoint_id?: string;
  restore_summary?: string;
  restore_phase?: string;
}

export interface ExecutionCheckpointMeta {
  id: string;
  thread_id: string;
  iteration: number;
  phase: string;
  tool?: string;
  call_id?: string;
  summary?: string;
  args?: Record<string, string>;
  created_at: string;
}

export interface Thread {
  id: string;
  name?: string; // human-readable label, separate from id; empty = render id
  parent_id?: string;
  depth?: number;
  directive: string;
  tools: string[];
  mcp_names?: string[];
  iteration: number;
  rate: string;
  model: string;
  age: string;
  realtime?: boolean;
  voice?: string;
  provider?: string;
  sleep_state?: SleepState;
  sleep_thread_id?: string;
  sleep_started_at?: string;
  next_wake_at?: string;
  sleep_total_ms?: number;
  sleep_remaining_ms?: number;
  sleep_iteration?: number;
}

export interface RealtimeThreadResponse {
  status: "created" | "exists" | "renewed";
  id: string;
  audio_token: string;
  format?: {
    encoding: "pcm16";
    sample_rate: number;
    channels: number;
  };
}

export interface RealtimeAvailability {
  enabled: boolean;
  available: boolean;
  voice: string;
  mcp: string[];
  provider: string;
}

const REALTIME_DASHBOARD_DIRECTIVE = `

[LIVE VOICE SESSION]
You are speaking with the operator in a temporary dashboard voice session.
- Be concise and conversational. Do not narrate internal reasoning.
- Use only the capabilities attached to this thread.
- Send important decisions, actionable requests, and confirmed work to main as they happen.
- Do not claim that an external action succeeded until its tool result confirms it.
- When you receive a session-ending instruction, send main one concise handoff containing decisions, completed actions, and pending work, then call done.`;

// One message in a thread's live context window, as exposed by
// GET /threads/:id/context. Mirrors core's Message struct — assistant
// turns may carry tool_calls, user turns may carry tool_results. `parts`
// appears on multimodal turns (image/audio). Everything optional so we
// don't choke on shape drift from core.
export interface ThreadContextMessage {
  role: string;
  content?: string;
  parts?: Array<{
    type: string;
    text?: string;
    image_url?: { url: string; detail?: string };
    input_audio?: { data: string; format: string };
    audio_url?: { url: string; mime_type?: string };
  }>;
  tool_calls?: Array<{ id?: string; name?: string; arguments?: any }>;
  tool_results?: Array<{ id?: string; content?: string; image?: any }>;
}

// Bytes-per-section of the system prompt (messages[0].Content). "Other"
// catches any text between markers we don't recognise so the total
// always reconciles. Numbers are raw character counts, not tokens —
// token-exact counts require a per-model tokenizer.
export interface SystemBreakdown {
  base: number;
  core_tools: number;
  retrieved_tools: number;
  mcp_servers: number;
  mcp_tool_docs: number;
  providers: number;
  active_threads: number;
  safety_mode: number;
  skills: number;
  blob_hint: number;
  previous_context: number;
  directive: number;
  other: number;
  total: number;
}

// One entry in the tools[] payload the provider receives. `kind`
// separates core loop tools from MCP tools and locals so the user
// can see which category is costing them bytes.
export interface NativeToolSize {
  name: string;
  kind: "core" | "mcp" | "local";
  bytes: number;
}

// A role=system message that lives AFTER messages[0]. The canonical
// case is the [memories] block appended each iteration; any other
// per-turn system injection shows up here too.
export interface ExtraSystemBlock {
  preview: string;
  bytes: number;
}

export interface PromptComposition {
  system: SystemBreakdown;
  native_tools: NativeToolSize[];
  native_bytes: number;
  extra_system: ExtraSystemBlock[];
  extra_bytes: number;
  conv_bytes: number;
  grand_total: number;
  model_max_tokens?: number;
}

// Telemetry event — unified format from core
export interface TelemetryEvent {
  id: string;
  instance_id: number;
  thread_id: string;
  type: string;
  time: string;
  data: Record<string, any>;
  seq?: number;
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
  // no_spawn restricts an MCP to the main thread: sub-threads can't
  // see its tools in search_tools results or attach it via
  // spawn(mcps=[...]). The host sets this on infrastructure servers
  // (gateways, outbound bridges) that shouldn't be reachable from a
  // worker — the privilege boundary in the discovery model.
  no_spawn?: boolean;
  connected?: boolean;     // present on GET, absent on PUT
}

export interface ContextResetResult {
  status: string;
  id: string;
  before_count: number;
  after_count: number;
  removed_count: number;
  before_chars: number;
  after_chars: number;
  removed_chars: number;
  threads_removed?: number;
  memory_removed?: number;
}

export const core = {
  status: (instanceId: number) => request<Status>("GET", `/agents/${instanceId}/status`),
  threads: (instanceId: number) => request<Thread[]>("GET", `/agents/${instanceId}/threads`),

  // Kill a sub-thread by ID. Core stops its goroutine + removes it
  // from the persisted config so it won't respawn next boot. Rejected
  // server-side for id="main" — operators can't kill the root thread.
  killThread: (instanceId: number, threadId: string) =>
    request<{ status: string; id: string }>(
      "DELETE",
      `/agents/${instanceId}/threads/${encodeURIComponent(threadId)}`,
    ),

  spawnRealtimeThread: (
    instanceId: number,
    threadId: string,
    opts: { voice?: string; provider?: string; mcp?: string[]; tools?: string[] },
  ) => request<RealtimeThreadResponse>(
    "POST",
    `/agents/${instanceId}/threads/${encodeURIComponent(threadId)}`,
    {
      realtime: true,
      ephemeral: true,
      voice: opts.voice || undefined,
      provider: opts.provider || undefined,
      mcp: opts.mcp || [],
      tools: opts.tools || [],
      bridge_disconnect_ttl_seconds: 45,
      directive_suffix: REALTIME_DASHBOARD_DIRECTIVE,
    },
  ),

  renewRealtimeAudioToken: (instanceId: number, threadId: string) =>
    request<RealtimeThreadResponse>(
      "POST",
      `/agents/${instanceId}/threads/${encodeURIComponent(threadId)}/audio-token`,
    ),

  // Clear the thread's history without killing it: wipes session.jsonl,
  // resets in-memory messages to just the system prompt, preserves the
  // thread's iteration counter + identity. Works for main as well — the
  // only way to unstick main short of a full instance reset.
  resetThread: (instanceId: number, threadId: string) =>
    request<ContextResetResult>(
      "POST",
      `/agents/${instanceId}/threads/${encodeURIComponent(threadId)}/reset`,
    ),

  // Reset agent state — any combination of history (session.jsonl + in-memory
  // messages + history/ dir), threads (kill all sub-threads + clear from
  // config), or memory. history+threads is the "unstick everything" option.
  resetInstance: (
    instanceId: number,
    opts: { history?: boolean; threads?: boolean; memory?: boolean },
  ) =>
    request<{ status: string; reset?: ContextResetResult }>(
      "PUT",
      `/agents/${instanceId}/config`,
      { reset: {
        ...(opts.history ? { history: true } : {}),
        ...(opts.threads ? { threads: true } : {}),
        ...(opts.memory ? { memory: true } : {}),
      } },
    ),

  // Fetch the live context window of a thread — the exact messages array
  // that will be sent to the LLM on the next iteration. Useful for
  // understanding token pressure and debugging why the model said what
  // it said. The slice is copied server-side so repeated calls are
  // cheap; individual message fields are a live snapshot (may change on
  // the next iteration). Also includes a `composition` breakdown —
  // bytes per section of the system prompt + per-tool sizes of the
  // tools[] payload + rolled-up conversation bytes — so the UI can
  // show "where the 12k comes from" at a glance.
  threadContext: (instanceId: number, threadId: string) =>
    request<{
      id: string;
      iteration: number;
      model: string;
      count: number;
      total_chars: number;
      messages: ThreadContextMessage[];
      composition: PromptComposition;
    }>(
      "GET",
      `/agents/${instanceId}/threads/${encodeURIComponent(threadId)}/context`,
    ),
  // GET /instances/:id/config — proxied to the core. The core responds with
  // the current in-memory config including the live mcp_servers list (each
  // entry annotated with `connected: true`).
  config: (instanceId: number) =>
    request<{
      directive: string;
      mode: string;
      provider?: {
        name: string;
        models?: Partial<Record<"large" | "medium" | "small", string>>;
      };
      execution_control?: ExecutionControlStatus;
      execution_checkpoints?: ExecutionCheckpointMeta[];
      auto_approve?: string[];
      mcp_servers?: MCPServerConfig[];
      providers?: Array<{
        name: string;
        default?: boolean;
        models?: Partial<Record<"large" | "medium" | "small", string>>;
        realtime_voice?: string;
      }>;
      realtime_enabled?: boolean;
      realtime_voice?: string;
      realtime_voice_mcp?: string[];
    }>("GET", `/agents/${instanceId}/config`),
  setMode: (instanceId: number, mode: RunMode) =>
    request<{ status: string }>("PUT", `/agents/${instanceId}/config`, { mode }),
  control: (instanceId: number, action: "run" | "pause" | "step", threadId?: string) =>
    request<{ status: string; execution_control: ExecutionControlStatus }>(
      "POST",
      `/agents/${instanceId}/control`,
      { action, ...(threadId ? { thread_id: threadId } : {}) },
    ),
  restoreCheckpoint: (instanceId: number, checkpointId: string) =>
    request<{ status: string; execution_control: ExecutionControlStatus; checkpoint?: ExecutionCheckpointMeta }>(
      "POST",
      `/agents/${instanceId}/control`,
      { action: "restore_checkpoint", checkpoint_id: checkpointId, mode: "step" },
    ),
  // Replace the full mcp_servers list on a running instance. The core
  // runs reconcileMCP against the list: names present get attached /
  // kept, names absent get disconnected. Always send the complete
  // desired list — a partial write will disconnect anything missing.
  setMCPServers: (instanceId: number, servers: MCPServerConfig[]) =>
    request<{ status: string }>("PUT", `/agents/${instanceId}/config`, {
      mcp_servers: servers,
    }),
  // Flip the include_channels flag on an instance. Use this to re-enable
  // channels when they were previously detached. Takes effect on the
  // next start of the instance — the response's restart_required field
  // indicates whether the caller needs to prompt for a restart to apply it.
  toggleSystemMCP: (
    instanceId: number,
    name: "channels",
    enable: boolean,
  ) =>
    request<{
      name: string;
      enable: boolean;
      previous: boolean;
      restart_required: boolean;
    }>("POST", `/agents/${instanceId}/system-mcp`, { name, enable }),
  approve: (instanceId: number, approved: boolean) =>
    request<{ status: string }>("POST", `/agents/${instanceId}/approve`, { approved }),

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
    request<{ status: string; reset?: ContextResetResult }>("PUT", `/agents/${instanceId}/config`, {
      reset: {
        history: opts?.history ?? true,
        memory: opts?.memory ?? false,
        threads: opts?.threads ?? false,
      },
    }),

  // Memory — what the agent has remembered. Auto-recalled by vector
  // similarity, so fixing or pruning a bad memory immediately changes
  // what gets surfaced on future turns. `tag` is the bracketed prefix
  // the remember-tool guidance asks the agent to use ([preference],
  // [correction], …) — the UI uses it for coloring/filtering.
  listMemory: (instanceId: number) =>
    request<MemoryItem[]>("GET", `/agents/${instanceId}/memory`),
  updateMemory: (instanceId: number, index: number, text: string) =>
    request<{ ok: boolean }>("PUT", `/agents/${instanceId}/memory/${index}`, { text }),
  deleteMemory: (instanceId: number, index: number) =>
    request<{ ok: boolean; count: number }>("DELETE", `/agents/${instanceId}/memory/${index}`),
};

export interface MemoryItem {
  index: number;
  text: string;
  tag?: string;
  namespace?: string;
  session?: string;
  time: string;
}

// Connection invites — operator mints a stateless signed link a client can
// use to complete an integration (new connection OR credential swap on an
// existing one) without a dashboard login.
export interface InviteResponse {
  token: string;
  url: string;
  expires_at: string;
}
export interface PublicInviteInfo {
  source: string;
  app_slug: string;
  app_name?: string;
  project_id: string;
  connection_id?: number;
  connection_name?: string;
  name?: string;
  allowed_tools?: string;
  auth_types?: string[];
  credential_fields?: Array<{
    name: string;
    label: string;
    description?: string;
    required?: boolean;
    type?: string;
  }>;
  has_oauth2?: boolean;
  expires_at: string;
}
export interface FulfillResponse {
  status: "connected" | "updated" | "redirect";
  connection_id?: number;
  redirect_url?: string;
}

export const invites = {
  create: (body: {
    app_slug: string;
    source?: string;
    project_id?: string;
    connection_id?: number;
    provider_id?: number;
    allowed_tools?: string;
    name?: string;
    ttl_seconds?: number;
  }) => request<InviteResponse>("POST", "/invites", body),
  // Public (no-auth) fetch — used by the /connect/:token page.
  get: (token: string) =>
    request<PublicInviteInfo>("GET", `/public/invites/${encodeURIComponent(token)}`),
  fulfill: (token: string, body: { credentials?: Record<string, string>; name?: string }) =>
    request<FulfillResponse>("POST", `/public/invites/${encodeURIComponent(token)}/fulfill`, body),
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
      "POST", "/channels/connect", { agent_id: instanceId, type, ...config },
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
  query: (instanceId: number, type?: string, limit?: number, threadId?: string, since?: string) => {
    const params = new URLSearchParams({ agent_id: String(instanceId) });
    if (type) params.set("type", type);
    if (limit) params.set("limit", String(limit));
    if (threadId) params.set("thread_id", threadId);
    if (since) params.set("since", since);
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

  // Project-scoped aggregate — ranks every instance in the project by
  // cost/tokens/errors over the period. Empty projectId scopes to every
  // instance the current user owns.
  projectStats: (projectId: string | undefined, period: string = "24h") => {
    const params = new URLSearchParams({ period });
    if (projectId) params.set("project_id", projectId);
    return request<InstanceStats[]>("GET", `/telemetry/project-stats?${params}`);
  },

  // Project-scoped timeline — buckets of cost with a per-instance
  // breakdown keyed by stringified instance id.
  projectTimeline: (projectId: string | undefined, period: string = "24h") => {
    const params = new URLSearchParams({ period });
    if (projectId) params.set("project_id", projectId);
    return request<ProjectTimelineBucket[]>("GET", `/telemetry/project-timeline?${params}`);
  },

  // Project-scoped tool breakdown — top-N tools by call count over
  // the period, with success/error split. Sorted by calls desc.
  projectTools: (projectId: string | undefined, period: string = "24h") => {
    const params = new URLSearchParams({ period });
    if (projectId) params.set("project_id", projectId);
    return request<ProjectToolStat[]>("GET", `/telemetry/project-tools?${params}`);
  },
};

export interface ProjectToolStat {
  name: string;
  calls: number;
  errors: number;
  agents: number;
}

// Per-instance aggregate over a period. Sorted by cost desc on the
// server. Agents with zero events in the window are omitted.
export interface InstanceStats {
  instance_id: number;
  name: string;
  status: string;
  llm_calls: number;
  tokens_in: number;
  tokens_out: number;
  tokens_cached: number;
  cost: number;
  errors: number;
  tool_calls: number;
  avg_duration_ms: number;
  distinct_threads: number;
}

// One bucket of the project timeline. cost_by_instance / calls_by_instance
// are keyed by stringified instance_id (JSON object keys must be strings).
export interface ProjectTimelineBucket {
  time: string;
  cost: number;
  tokens_in: number;
  tokens_out: number;
  llm_calls: number;
  errors: number;
  cost_by_instance: Record<string, number>;
  calls_by_instance: Record<string, number>;
}

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

  // --- v2 Apps system (sidecar-based, see github.com/apteva/app-sdk) ---

  list: (projectId?: string) => {
    const q = projectId ? `?project_id=${encodeURIComponent(projectId)}` : "";
    return request<AppRow[]>("GET", `/apps${q}`);
  },

  preview: (manifestUrl?: string, manifestYaml?: string) =>
    request<AppPreview>("POST", "/apps/preview", {
      ...(manifestUrl ? { manifest_url: manifestUrl } : {}),
      ...(manifestYaml ? { manifest_yaml: manifestYaml } : {}),
    }),

  // preflight returns the same manifest as preview() plus the role
  // breakdown for requires.integrations: which connections / installed
  // apps are compatible candidates per role. The dashboard's install
  // modal renders one picker per role and submits the resulting
  // bindings JSON to install().
  preflight: (
    manifestUrl?: string,
    manifestYaml?: string,
    projectId?: string,
  ) =>
    request<AppPreflight>("POST", "/apps/install/preflight", {
      ...(manifestUrl ? { manifest_url: manifestUrl } : {}),
      ...(manifestYaml ? { manifest_yaml: manifestYaml } : {}),
      project_id: projectId || "",
    }),

  install: (opts: AppInstallOptions) =>
    request<{ install_id: number; app_id: number; status: string; next_step: string }>(
      "POST",
      "/apps/install",
      {
        ...(opts.manifestUrl ? { manifest_url: opts.manifestUrl } : {}),
        ...(opts.manifestYaml ? { manifest_yaml: opts.manifestYaml } : {}),
        ...(opts.repo ? { repo: opts.repo } : {}),
        ...(opts.ref ? { ref: opts.ref } : {}),
        project_id: opts.projectId || "",
        config: opts.config || {},
        upgrade_policy: opts.upgradePolicy || "manual",
        ...(opts.bindings ? { bindings: opts.bindings } : {}),
      },
    ),

  uninstall: (installId: number) =>
    request<{ status: string }>("DELETE", `/apps/installs/${installId}`),

  upgrade: (installId: number, opts?: { approveNewPermissions?: boolean }) =>
    request<AppUpgradeResponse>(
      "POST",
      `/apps/installs/${installId}/upgrade`,
      opts?.approveNewPermissions ? { approve_new_permissions: true } : undefined,
    ),

  /** Move an install between project and global scope without
   *  destroying its data. project_id="" → global; any string id →
   *  that project. Returns a summary of what moved (rows
   *  migrated, whether the sidecar restarted). Refuses with 400
   *  if the manifest doesn't list the target scope, and 409 if a
   *  conflicting install of the same app already occupies it. */
  setScope: (installId: number, projectId: string) =>
    request<{
      install_id: number;
      old_project_id: string;
      new_project_id: string;
      connections_migrated: number;
      sidecar_restarted: boolean;
    }>("PATCH", `/apps/installs/${installId}/scope`, { project_id: projectId }),

  setStatus: (
    installId: number,
    status: "running" | "disabled" | "error",
    opts?: { serviceName?: string; sidecarUrl?: string },
  ) =>
    request<{ status: string }>("PUT", `/apps/installs/${installId}/status`, {
      status,
      ...(opts?.serviceName ? { service_name: opts.serviceName } : {}),
      ...(opts?.sidecarUrl ? { sidecar_url: opts.sidecarUrl } : {}),
    }),

  bindInstances: (installId: number, instanceIds: number[]) =>
    request<{ status: string; bound: number[] }>(
      "PUT",
      `/apps/installs/${installId}/instances`,
      { instance_ids: instanceIds },
    ),

  // setBindings updates an existing install's integration_bindings.
  // Pass a partial object — keys you don't include are preserved
  // (MERGE semantics on the server). Pass `null` for a key to
  // unbind that role. Server bounces the sidecar so OnMount picks
  // up the new bindings; respawned=true confirms the new process is
  // healthy. Required roles can't be unbound (server 400s).
  setBindings: (installId: number, bindings: Record<string, AppBindingValue>) =>
    request<{ ok: boolean; bindings: Record<string, any>; respawned: boolean; respawn_err: string }>(
      "PUT",
      `/apps/installs/${installId}/bindings`,
      bindings,
    ),

  // preflightInstalled — same shape as preflight() but for an
  // already-installed app, so the dashboard can render the role
  // pickers in the install detail panel without re-fetching the
  // upstream manifest. Reuses the preflight endpoint by passing the
  // install's own manifest_url + project_id.
  preflightInstalled: (installId: number) =>
    request<AppPreflight>("GET", `/apps/installs/${installId}/preflight`),

  tools: (installId: number) =>
    request<AppMCPTool[]>("GET", `/apps/installs/${installId}/tools`),

  imports: (installId: number) =>
    request<{ imports?: AppImports }>("GET", `/apps/installs/${installId}/imports`),

  permissions: (installId: number) =>
    request<AppPermissionCatalog>("GET", `/apps/installs/${installId}/permissions`),

  setGrantsForAgent: (installId: number, agentId: number, policy: Omit<AppGrantPolicy, "install_id">) =>
    request<AppGrantsResponse>(
      "PUT",
      `/apps/installs/${installId}/grants/by-instance/${agentId}`,
      {
        default_effect: policy.default_effect,
        rules: policy.rules,
      },
    ),

  marketplace: (
    projectId?: string,
    registryUrl?: string,
    opts?: { query?: string; category?: string; page?: number; pageSize?: number },
  ) => {
    // Pass project_id so the server filters the "is installed" check
    // to project-visible installs (own + globals). Without this an
    // install in another project marks the marketplace entry as
    // installed everywhere and blocks per-project install.
    const params = new URLSearchParams();
    if (projectId) params.set("project_id", projectId);
    if (registryUrl) params.set("registry_url", registryUrl);
    if (opts?.query) params.set("q", opts.query);
    if (opts?.category && opts.category !== "all") params.set("category", opts.category);
    if (opts?.page) params.set("page", String(opts.page));
    if (opts?.pageSize) params.set("page_size", String(opts.pageSize));
    const q = params.toString();
    return request<{
      registry_url: string;
      apps: MarketplaceEntry[];
      total?: number;
      page?: number;
      page_size?: number;
      categories?: Record<string, number>;
    }>(
      "GET",
      `/apps/marketplace${q ? `?${q}` : ""}`,
    );
  },
};

export interface AppResourceDecl {
  name: string;
  label?: string;
  list_endpoint?: string;
  matcher: string;
  picker?: string;
  listing_visibility?: string;
}

export interface AppProvidedPermission {
  name: string;
  resource?: string;
  description?: string;
}

export interface AppPermissionTool {
  name: string;
  description?: string;
  requires?: string;
  resource_from?: string;
}

export interface AppPermissionCatalog {
  resources: AppResourceDecl[];
  permissions: AppProvidedPermission[];
  tools: AppPermissionTool[];
}

export interface AppUpgradeResponse {
  status: string;
  version: string;
}

export interface AppGrantRule {
  effect: "allow" | "deny";
  permission: string;
  resource: string;
}

export interface AppGrantPolicy {
  install_id: number;
  default_effect: "allow" | "deny";
  rules: AppGrantRule[];
}

export interface AppGrantsResponse {
  default_effect: "allow" | "deny";
  grants: AppGrantRule[];
}

export interface MarketplaceEntry {
  name: string;
  display_name: string;
  version: string;
  description: string;
  author: string;
  repo: string;
  manifest_url: string;
  icon: string;
  tags: string[];
  official: boolean;
  category: string;
  installed: boolean;
  builtin: boolean;
  deprecated?: boolean;
  deprecation?: string;
  replacement?: string;
  // Surfaces are server-resolved by fetching manifest_url with a 1h
  // cache. Empty / zero values are normal for offline runs or apps
  // whose manifests can't be fetched — the dashboard treats missing
  // counts as "unknown" rather than "zero".
  surfaces: AppSurfaces;
}

export interface AppRow {
  install_id: number;
  app_id: number;
  name: string;
  display_name: string;
  version: string;
  available_version?: string;
  description: string;
  icon: string;
  project_id: string;
  status: "pending" | "running" | "error" | "disabled";
  status_message?: string;  // live phase string while pending — "Cloning…", "Building…", etc.
  error_message?: string;
  source: "git" | "registry" | "builtin" | "manual" | "integration";
  upgrade_policy: "manual" | "auto-patch" | "auto-minor";
  permissions: string[];
  surfaces: AppSurfaces;
  deprecated?: boolean;
  deprecation?: string;
  replacement?: string;
  ui_panels?: AppUIPanel[];
  ui_components?: AppUIComponent[];
  // Events the app's manifest declares it emits on the AppBus.
  // Populated by the server from manifest.Provides.Publishes when
  // present. Drives the subscription form's event dropdown.
  publishes?: EventDecl[];
  imports?: AppImports;
  bindings?: Record<string, AppBindingValue>;
}

export interface AppImports {
  sources?: AppImportSource[];
}

export interface AppImportSource {
  id: string;
  label?: string;
  description?: string;
  kind?: string;
  integration?: string;
  scope?: string;
  [key: string]: unknown;
}

// EventDecl — one topic the app's manifest declares it emits via
// ctx.Emit. Mirrors sdk.EventDecl.
export interface EventDecl {
  name: string;                       // e.g. "media.indexed"
  description?: string;               // human prose for the dropdown
  dynamic?: boolean;                  // name ends with ".*"
  payload?: Record<string, string>;   // doc-only field → type label map
}

export interface AppUIPanel {
  slot: string;   // "instance.tab" | "instance.status" | "settings.app" | "sidebar.widget"
  label: string;
  icon: string;
  entry: string;  // path served by sidecar (e.g. "/ui/StatusPanel.html")
}

// Manifest entry — what the app declared. Mirrors sdk.UIComponent.
export interface AppUIComponent {
  name: string;
  entry: string;
  slots: string[];
  props_schema?: Record<string, unknown>;
  preview_props?: Record<string, unknown>;
}

export interface AppSurfaces {
  kind: string;                    // service | source | static
  mcp_tool_count: number;
  mcp_tool_names?: string[];
  skill_count: number;             // playbooks the app ships (inherited on bind)
  http_route_count: number;
  http_routes?: string[];
  ui_panel_count: number;
  ui_app: boolean;
  ui_app_mount?: string;
  channel_count: number;
  channel_names?: string[];
  worker_count: number;
  prompt_fragment_count: number;
  permissions?: string[];
  config_keys?: string[];
  required_apps?: AppDependency[];
}

export interface AppMCPTool {
  name: string;
  description?: string;
  inputSchema?: Record<string, any>;
}

export interface AppDependency {
  name: string;
  version?: string;
  reason?: string;
  optional?: boolean;
  manifest_url?: string;
  installed?: boolean;
}

export interface AppPreview {
  manifest: AppManifestV2;
  surfaces: AppSurfaces;
}

export interface AppManifestV2 {
  schema: string;
  name: string;
  display_name: string;
  version: string;
  description: string;
  author: string;
  homepage?: string;
  icon?: string;
  tags?: string[];
  scopes: string[];
  requires: { permissions: string[]; mcp_tools_at_runtime?: string[] };
  provides: {
    http_routes?: { prefix: string }[];
    mcp_tools?: { name: string; description: string }[];
    prompt_fragments?: { file: string; position: string }[];
    ui_panels?: { slot: string; label: string; icon?: string; entry: string }[];
    ui_app?: { domain_template: string; auth: string };
    channels?: { name: string; capabilities: string[] }[];
    workers?: { name: string; schedule: string }[];
  };
  /** Install-time + post-install settings schema. Same shape feeds
   *  both InstallModal (required fields only, per v0.14 UX) and
   *  the SettingsSection panel (full set, post-install). Keeps
   *  one source of truth — manifest authors don't write the form
   *  twice. Extended in v0.14 with required_if_role_bound +
   *  select_from_integration + discovery; older renderers that
   *  ignore those fields fall back to text input gracefully. */
  config_schema?: AppConfigField[];
  upgrade_policy: string;
}

export interface AppConfigField {
  name: string;
  label?: string;
  /** text | password | toggle | select | select_from_integration |
   *  select_from_app | gdrive_sheet | gdrive_folder | …
   *  (unknown types render as text) */
  type?: string;
  description?: string;
  required?: boolean;
  default?: string;
  /** Closed enum for type=select. */
  options?: string[];
  /** Required only when the named integration role has a non-null
   *  binding. Lets the manifest mark `s3_bucket` required only
   *  when `backend` is bound. */
  required_if_role_bound?: string;
  /** For type=select_from_integration: which role to draw the list
   *  from. The dashboard reads the connection bound to that role
   *  and invokes `discovery.tool` against it to populate the
   *  dropdown. */
  integration_role?: string;
  /** For type=select_from_app: which sibling app (by name) to query.
   *  The dashboard hits /api/apps/{app}{discovery.route} and parses
   *  the response the same way as select_from_integration. The named
   *  app should appear in requires.apps so missing-dep surfaces
   *  before config time. */
  app?: string;
  discovery?: AppConfigFieldDiscovery;
  /** "text" → fall back to a manual text input when discovery
   *  fails (no binding, upstream error, empty result). Empty =
   *  show the failure and disable the field. */
  fallback?: "text" | "";
}

export interface AppConfigFieldDiscovery {
  /** Tool name (select_from_integration only). */
  tool?: string;
  /** HTTP route on the sibling app (select_from_app only). Leading
   *  slash required, e.g. "/api/instances". */
  route?: string;
  response_path?: string;
  value_field?: string;
  label_field?: string;
}

export interface AppInstallOptions {
  manifestUrl?: string;
  manifestYaml?: string;
  repo?: string;
  ref?: string;
  projectId?: string;
  config?: Record<string, string>;
  upgradePolicy?: "manual" | "auto-patch" | "auto-minor";
  // bindings: role → connection_id/install_id, a multi-binding object,
  // or null when the user opted out of an optional dep.
  // Required deps must have a non-empty target; the server validates.
  bindings?: Record<string, AppBindingValue>;
}

export type AppMultiBindingValue = {
  ids: number[];
  default_id?: number;
};

export type AppBindingValue = number | null | AppMultiBindingValue;

// Preflight response — drives the install modal's role-picker step.
// One entry per requires.integrations role in the manifest.
export interface PreflightRole {
  role: string;
  kind: "integration" | "app";
  mode?: "single" | "multiple";
  label?: string;
  required: boolean;
  hint?: string;
  capabilities?: string[];
  compatible?: string[];
  integration_candidates?: PreflightConnectionCandidate[];
  app_candidates?: PreflightAppCandidate[];
  can_create_new: boolean;
}

export interface PreflightConnectionCandidate {
  connection_id: number;
  app_slug: string;
  name: string;
  status: string;
  /** "project" or "global". Lets the install-modal role picker
   *  render a "global" badge so an operator binding the storage
   *  backend can tell at a glance whether the candidate is
   *  project-scoped or visible across every project. */
  scope?: "project" | "global";
}

export interface PreflightAppCandidate {
  install_id: number;
  app_name: string;
  display_name: string;
}

export interface AppPreflight {
  manifest: AppManifestV2;
  roles: PreflightRole[];
}

// --- channel-chat app ---
//
// DB-backed chat as a first-class Apteva App. Messages live in the
// server's DB with a monotonic autoincrement id — ordering is free,
// dedup is trivial (just check id before insert). Reconnect uses
// `since=<last_id>` to fetch the exact gap.

export interface ChatRow {
  id: string;
  instance_id: number;
  agent_ids: number[];
  project_id: string;
  owner_user_id?: number;
  kind: "direct" | "room";
  title: string;
  created_at: string;
  updated_at: string;
  archived_at?: string;
  thread_id?: string;
}

// ChatComponent — a render hint the agent attached via the
// chat MCP's respond(components=…) arg. The dashboard mounts each
// entry as a UIComponent declared in the named app's manifest.
export interface ChatComponent {
  app: string;             // "storage"
  name: string;            // "file-card"
  props?: Record<string, unknown>;
}

export interface ChatAttachment {
  id?: string;
  type: "image";
  data_url?: string;
  name?: string;
  mime_type?: string;
  size?: number;
  ephemeral?: boolean;
}

export interface ChatMessageRow {
  id: number;
  chat_id: string;
  role: "user" | "agent" | "system";
  content: string;
  user_id?: number;
  agent_id?: number;
  thread_id?: string;
  status: "streaming" | "final";
  created_at: string;
  components?: ChatComponent[];
  attachments?: ChatAttachment[];
  metadata?: Record<string, unknown>;
  client_message_id?: string;
}

export interface ApprovalMessageRow {
  message: ChatMessageRow;
  instance_id: number;
  instance_name: string;
  project_id: string;
  title: string;
  body: string;
  status: string;
  dismissed?: boolean;
}

export interface ReportMessageRow {
  message: ChatMessageRow;
  instance_id: number;
  instance_name: string;
  project_id: string;
  title: string;
  summary: string;
  period?: string;
  dismissed?: boolean;
}

export interface AlertMessageRow {
  message: ChatMessageRow;
  instance_id: number;
  instance_name: string;
  project_id: string;
  title: string;
  body: string;
  severity: string;
	dismissed?: boolean;
}

export interface CurrentStatusMessageRow {
	message: ChatMessageRow;
	instance_id: number;
	instance_name: string;
	project_id: string;
	title: string;
	detail?: string;
	state: "working" | "waiting" | "blocked" | "completed";
	progress?: number;
	next?: string;
	next_at?: string;
	stale: boolean;
}

export interface ChatMessageContext {
  source: "dashboard-floating" | "dashboard-build";
  project_id?: string;
  project_name?: string;
  route: string;
  title: string;
  detail: string;
  page_kind: string;
  chips?: string[];
}

export function chatConversationListPath(projectId: string, archived: boolean = false): string {
  return `/apps/channel-chat/conversations?project_id=${encodeURIComponent(projectId)}${archived ? "&archived=1" : ""}`;
}

export const chat = {
  // APP_PATH is the HTTP prefix the Apteva Apps framework uses for
  // this app. Keeping it as a constant here means if the slug changes
  // upstream we only touch one line.
  APP_PATH: "/apps/channel-chat",

  listChats: (instanceId: number) =>
    request<ChatRow[]>("GET", `/apps/channel-chat/chats?instance_id=${instanceId}`),

  createChat: (instanceId: number, title?: string) =>
    request<ChatRow>("POST", "/apps/channel-chat/chats", { agent_id: instanceId, title }),

  listConversations: (projectId: string, archived: boolean = false) =>
    request<ChatRow[]>("GET", chatConversationListPath(projectId, archived)),

  createConversation: async (projectId: string, agentIds: number[], title?: string, leadAgentId?: number) => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    try {
      return await request<ChatRow>("POST", "/apps/channel-chat/conversations", {
        project_id: projectId,
        agent_ids: agentIds,
        ...(title ? { title } : {}),
        ...(leadAgentId ? { lead_agent_id: leadAgentId } : {}),
      }, undefined, controller.signal);
    } catch (error) {
      if (controller.signal.aborted) {
        throw new Error("Conversation creation timed out. Refresh the conversation list before trying again.");
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  },

  updateConversation: (chatId: string, update: { title?: string; archived?: boolean }) =>
    request<ChatRow>("PATCH", `/apps/channel-chat/conversation?id=${encodeURIComponent(chatId)}`, update),

  deleteConversation: (chatId: string) =>
    request<{ deleted: boolean }>("DELETE", `/apps/channel-chat/conversation?id=${encodeURIComponent(chatId)}`),

  addParticipant: (chatId: string, agentId: number) =>
    request<ChatRow>("POST", `/apps/channel-chat/participants?id=${encodeURIComponent(chatId)}`, { agent_id: agentId }),

  removeParticipant: (chatId: string, agentId: number) =>
    request<ChatRow>("DELETE", `/apps/channel-chat/participants?id=${encodeURIComponent(chatId)}&agent_id=${agentId}`),

  messages: (chatId: string, since: number = 0, limit: number = 500) =>
    request<ChatMessageRow[]>(
      "GET",
      `/apps/channel-chat/messages?chat_id=${encodeURIComponent(chatId)}&since=${since}&limit=${limit}`,
    ),

  post: (chatId: string, content: string, context?: ChatMessageContext, attachments?: ChatAttachment[], clientMessageId?: string) =>
    request<ChatMessageRow>(
      "POST",
      `/apps/channel-chat/messages?chat_id=${encodeURIComponent(chatId)}`,
      {
        content,
        ...(attachments && attachments.length > 0 ? { attachments } : {}),
        ...(context ? { context } : {}),
        ...(clientMessageId ? { client_message_id: clientMessageId } : {}),
      },
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

  // streamUser opens the wildcard SSE that emits every message for any
  // chat the authenticated user owns. Drives the global notifications
  // tray; not used by per-chat panels.
  streamUser: (): EventSource => {
    return new EventSource(`${BASE}/apps/channel-chat/stream?scope=user`);
  },

  // unreadSummary seeds the notifications tray on dashboard mount so
  // badges show up before the SSE has a chance to fire its first event.
  unreadSummary: (): Promise<UnreadSummaryRow[]> =>
    request<UnreadSummaryRow[]>("GET", "/apps/channel-chat/unread-summary"),

  approvalMessages: (projectId?: string, status: "pending" | "all" = "pending", limit: number = 20) => {
    const qs = new URLSearchParams();
    if (projectId) qs.set("project_id", projectId);
    if (status) qs.set("status", status);
    qs.set("limit", String(limit));
    return request<ApprovalMessageRow[]>("GET", `/apps/channel-chat/approval-messages?${qs.toString()}`);
  },

  reportMessages: (projectId?: string, limit: number = 20) => {
    const qs = new URLSearchParams();
    if (projectId) qs.set("project_id", projectId);
    qs.set("limit", String(limit));
    return request<ReportMessageRow[]>("GET", `/apps/channel-chat/report-messages?${qs.toString()}`);
  },

	alertMessages: (projectId?: string, limit: number = 20) => {
    const qs = new URLSearchParams();
    if (projectId) qs.set("project_id", projectId);
    qs.set("limit", String(limit));
		return request<AlertMessageRow[]>("GET", `/apps/channel-chat/alert-messages?${qs.toString()}`);
	},

	currentStatuses: (projectId?: string) => {
		const qs = new URLSearchParams();
		if (projectId) qs.set("project_id", projectId);
		const suffix = qs.toString() ? `?${qs.toString()}` : "";
		return request<CurrentStatusMessageRow[]>("GET", `/apps/channel-chat/current-statuses${suffix}`);
	},

  messageAction: (messageId: number, actionId: string, note?: string) =>
    request<{ message: ChatMessageRow; status: string; forwarded: boolean; delivery_error?: string }>(
      "POST",
      "/apps/channel-chat/message-action",
      {
        message_id: messageId,
        action_id: actionId,
        ...(note ? { note } : {}),
      },
    ),

  messageDismiss: (messageId: number) =>
    request<{ message: ChatMessageRow; dismissed: boolean }>(
      "POST",
      "/apps/channel-chat/message-dismiss",
      { message_id: messageId },
    ),

  // markSeen advances the persistent per-chat read watermark. Server
  // is monotonic, so it's safe to fire from many tabs at once. Returns
  // the watermark in effect after the call so the client can reconcile.
  markSeen: (chatId: string, lastSeenId: number): Promise<{ last_seen_id: number }> =>
    request<{ last_seen_id: number }>("POST", "/apps/channel-chat/seen", {
      chat_id: chatId,
      last_seen_id: lastSeenId,
    }),

  // presence forwards "[chat] user connected/disconnected" through
  // channelchat so the same per-chat thread resolution applies as for
  // messages. Used to bypass channelchat and hit /agents/:id/event
  // with thread_id="main" hardcoded — that's why presence events
  // landed on main even when CHANNELCHAT_PER_THREAD was on.
  presence: (chatId: string, action: "connected" | "disconnected"): Promise<{ status: string; thread_id: string }> =>
    request<{ status: string; thread_id: string }>("POST", "/apps/channel-chat/presence", {
      chat_id: chatId,
      action,
    }),
};

export interface UnreadSummaryRow {
  chat_id: string;
  instance_id: number;
  instance_name: string;
  title: string;
  latest_id: number;
  latest_role: string;     // user | agent | system | "" if no messages
  latest_preview: string;
  latest_at: string;
  last_seen_id: number;
}

// --- Skills -----------------------------------------------------------

export interface Skill {
  id: number;
  slug: string;
  name: string;
  description: string;
  body: string;
  source: "app" | "user" | "builtin";
  install_id?: number;
  project_id: string;
  command?: string;
  metadata?: Record<string, unknown>;
  enabled: boolean;
  version: string;
  created_at: string;
  updated_at: string;
  app_name?: string;
}

export const skills = {
  list: (projectId?: string) => {
    const q = projectId ? `?project_id=${encodeURIComponent(projectId)}` : "";
    return request<Skill[]>("GET", `/skills${q}`);
  },
  get: (id: number) => request<Skill>("GET", `/skills/${id}`),
  create: (input: {
    name: string;
    description: string;
    body: string;
    command?: string;
    project_id: string;
    metadata?: Record<string, unknown>;
  }) => request<{ id: number }>("POST", "/skills", input),
  update: (
    id: number,
    patch: Partial<Pick<Skill, "name" | "description" | "body" | "command" | "metadata">>,
  ) => request<{ updated: number }>("PUT", `/skills/${id}`, patch),
  remove: (id: number) => request<{ deleted: number }>("DELETE", `/skills/${id}`),
  setEnabled: (id: number, enabled: boolean) =>
    request<{ enabled: boolean }>("PUT", `/skills/${id}/enabled`, { enabled }),
};

// --- Per-instance skill assignment ------------------------------------
//
// The journal is the source of truth for "which skills are loaded on
// which agent". The list endpoint returns per-skill drift status:
//   synced   — record present and matches catalog body hash
//   stale    — record present but body changed in the catalog
//   missing  — catalog row exists, no record on this agent
//   orphaned — record on this agent, no matching catalog row

export type InstanceSkillStatus = "synced" | "stale" | "missing" | "orphaned";

export interface InstanceSkill {
  skill_id: number;            // 0 for orphaned journal entries
  slug: string;
  name: string;
  description?: string;
  source: "app" | "user" | "builtin" | "";
  app_name?: string;
  memory_id?: string;
  pushed_at?: string;
  status: InstanceSkillStatus;
}

export const instanceSkills = {
  list: (instanceId: number) =>
    request<InstanceSkill[]>("GET", `/agents/${instanceId}/skills`),
  assign: (instanceId: number, skillId: number) =>
    request<{ ok: boolean; memory_id: string; slug: string }>(
      "POST",
      `/agents/${instanceId}/skills/${skillId}`,
    ),
  unassign: (instanceId: number, skillId: number) =>
    request<{ ok: boolean }>("DELETE", `/agents/${instanceId}/skills/${skillId}`),
};

// --- Platform self-update status (apteva CLI / server / core / dashboard
// / integrations). The action itself lives in the `apteva update` CLI
// subcommand; the dashboard surface here is purely informational. ---

export interface PlatformComponentStatus {
  name: string;
  current: string;
  latest: string;
  update_available: boolean;
}

/** Server-side detection of how apteva-server got onto disk. The
 *  banner copy adapts so e.g. systemd users see the right command
 *  ("apteva update" since the supervisor handles the restart through
 *  the symlink flip), Docker users see `docker pull && compose up`,
 *  source builds see `git pull && build-local.sh`. See
 *  server/install_method.go for the canonical list of values. */
export type PlatformInstallMethod =
  | "foreground"
  | "systemd-user"
  | "systemd-system"
  | "launchd-user"
  | "launchd-system"
  | "docker"
  | "source"
  | "packaged";

export interface PlatformStatus {
  polled_at: string;
  bundle_version?: string;
  release_notes_url?: string;
  components: PlatformComponentStatus[];
  update_available: boolean;
  install_method?: PlatformInstallMethod;
  error?: string;
}

export const platform = {
  status:  () => request<PlatformStatus>("GET", "/platform-status"),
  refresh: () => request<PlatformStatus>("POST", "/platform-status/refresh"),
};
