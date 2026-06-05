import { useState, useEffect, useCallback, useRef } from "react";
import {
  integrations,
  providers,
  invites,
  mcpServers,
  type AppSummary,
  type AppDetail,
  type ConnectionInfo,
  type ConnectionTestResult,
  type Provider,
  type ComposioApp,
  type ComposioToolkitDetails,
  type ConnectCreateResponse,
  type DeviceAuthStart,
  type DeviceAuthStatus,
  type InviteResponse,
} from "../api";

// AppLogo — wraps <img> with an onError that hides the element so a
// missing favicon doesn't render a broken-image glyph + fire a noisy
// React reconciler log entry. Many integration JSONs point at
// www.google.com/s2/favicons?domain=… which 404s when Google's cache
// has nothing for the host; before this component, every miss
// produced ~30 stack frames of D8/GG/F8 chatter in the console.
function AppLogo({ src, className }: { src?: string; className?: string }) {
  const [broken, setBroken] = useState(false);
  if (!src || broken) return null;
  return (
    <img
      src={src}
      alt=""
      className={className}
      onError={() => setBroken(true)}
    />
  );
}
import { Modal } from "../components/Modal";
import { SuiteConnect } from "../components/SuiteConnect";
import { IntegrationExplorerPanel } from "../components/integrations/IntegrationExplorerPanel";
import { useNavigate } from "react-router-dom";
import { useProjects } from "../hooks/useProjects";

// Credential-group suite summary — from GET /integrations/groups.
// The dashboard collapses each suite into a single catalog card.
type SuiteSummary = {
  id: string;
  name: string;
  logo?: string | null;
  description?: string;
  members: Array<{ slug: string; name: string; tool_count: number; logo?: string | null }>;
  has_account_scope: boolean;
  has_project_scope: boolean;
};

type SourceTab = "local" | "composio";

function defaultLocalAuthType(app: AppDetail | null | undefined): string {
  const types = app?.auth?.types || [];
  if (app?.slug === "google-sheets" && types.includes("oauth2")) return "oauth2";
  if (types.includes("oauth_device_code")) return "oauth_device_code";
  const nonOAuth = types.find((t) => t !== "oauth2");
  return nonOAuth || types[0] || "";
}

export function Integrations() {
  const { currentProject } = useProjects();
  const navigate = useNavigate();

  const [tab, setTab] = useState<SourceTab>("local");
  const [inviteFor, setInviteFor] = useState<ConnectionInfo | null>(null);
  const [inviteLink, setInviteLink] = useState<InviteResponse | null>(null);
  const [inviteBusy, setInviteBusy] = useState(false);
  const [inviteErr, setInviteErr] = useState("");
  const [copied, setCopied] = useState(false);
  const [renameFor, setRenameFor] = useState<ConnectionInfo | null>(null);
  const [renameText, setRenameText] = useState("");
  const [renameBusy, setRenameBusy] = useState(false);
  const [renameErr, setRenameErr] = useState("");

  // Credential reveal — operator escape hatch for debugging a stored
  // token. Each row reveals individually (mask by default, click to
  // unmask + copy). Server logs every fetch.
  const [credsFor, setCredsFor] = useState<ConnectionInfo | null>(null);
  const [credsData, setCredsData] = useState<Record<string, string> | null>(null);
  const [credsBusy, setCredsBusy] = useState(false);
  const [credsErr, setCredsErr] = useState("");
  const [credsRevealed, setCredsRevealed] = useState<Set<string>>(new Set());
  const [credsCopied, setCredsCopied] = useState<string | null>(null);

  // Per-connection health-check state. Keyed by connection.id.
  // null  → never tested in this session
  // {ok}  → last test outcome (used to render the green/red dot)
  // The map clears when the project changes; we don't persist
  // results to localStorage because freshness matters more than
  // sticky reassurance on the next session.
  const [testResults, setTestResults] = useState<Record<number, ConnectionTestResult>>({});
  const [testInFlight, setTestInFlight] = useState<Set<number>>(new Set());
  const [reauthInFlight, setReauthInFlight] = useState<Set<number>>(new Set());
  const [openMenuFor, setOpenMenuFor] = useState<number | null>(null);
  const actionMenuRef = useRef<HTMLDivElement | null>(null);

  // Scope-change state. When set, renders a small confirmation
  // modal asking "move this connection from project to global"
  // (or vice versa). Mirrors the v0.14.5 install scope-flip
  // pattern — same data-safety story: only project_id moves;
  // credentials, bindings, MCP allowed-tools, subscriptions are
  // all untouched.
  const [scopeFlipFor, setScopeFlipFor] = useState<ConnectionInfo | null>(null);
  const [scopeFlipBusy, setScopeFlipBusy] = useState(false);
  const [scopeFlipErr, setScopeFlipErr] = useState("");
  const [explorerFor, setExplorerFor] = useState<ConnectionInfo | null>(null);

  // Tool picker — after a new connection is active, present the catalog
  // of tools exposed by that integration and let the user pick which subset
  // becomes an MCP server sub-threads can spawn against.
  type ConnTool = { name: string; description: string };
  const [pickerFor, setPickerFor] = useState<ConnectionInfo | null>(null);
  const [pickerMCPId, setPickerMCPId] = useState<number | null>(null); // editing existing MCP row
  const [pickerTools, setPickerTools] = useState<ConnTool[]>([]);
  const [pickerSelected, setPickerSelected] = useState<Set<string>>(new Set());
  const [pickerLoading, setPickerLoading] = useState(false);
  const [pickerBusy, setPickerBusy] = useState(false);
  const [pickerErr, setPickerErr] = useState("");
  const [pickerFilter, setPickerFilter] = useState("");
  const [providerList, setProviderList] = useState<Provider[]>([]);
  const [connections, setConnections] = useState<ConnectionInfo[]>([]);
  const [loaded, setLoaded] = useState(false);

  // Local catalog state
  const [localSearch, setLocalSearch] = useState("");
  const [localApps, setLocalApps] = useState<AppSummary[]>([]);
  // Credential-group (suite) cards rendered above the flat catalog.
  // One card per suite (OmniKit, SocialCast, ...). Clicking opens
  // the SuiteConnect modal.
  const [suites, setSuites] = useState<SuiteSummary[]>([]);
  const [activeSuite, setActiveSuite] = useState<SuiteSummary | null>(null);
  const [selectedLocalApp, setSelectedLocalApp] = useState<AppDetail | null>(null);
  const [credentials, setCredentials] = useState<Record<string, string>>({});
  const [connName, setConnName] = useState("");
  // auto_mcp opt-in. Default false to match the server-side default —
  // most integrations are added so a specific app can use them (e.g.
  // Facebook for Social), not so every agent in the project gets
  // global access to the integration's tool surface. Operator ticks
  // the box when they DO want a project-wide MCP server.
  const [autoMCP, setAutoMCP] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState("");
  const [deviceAuth, setDeviceAuth] = useState<{ connection: ConnectionInfo; auth: DeviceAuthStart } | null>(null);
  const [deviceAuthStatus, setDeviceAuthStatus] = useState<DeviceAuthStatus | null>(null);
  const [deviceAuthPollTick, setDeviceAuthPollTick] = useState(0);

  // Local OAuth client credentials. The user's own OAuth app id+secret
  // (registered with the upstream provider — e.g. github.com/settings/developers).
  // We collect them per app+project and persist them on the connection's
  // encrypted blob server-side, so the next connect to the same app skips
  // the form. On app selection we ask the server whether anything is
  // already on file and hide the form when so.
  const [oauthClientID, setOAuthClientID] = useState("");
  const [oauthClientSecret, setOAuthClientSecret] = useState("");
  const [oauthClientResolved, setOAuthClientResolved] = useState(false);
  const [oauthCallbackURL, setOAuthCallbackURL] = useState("");

  // Composio state
  const [composioSearch, setComposioSearch] = useState("");
  const [composioApps, setComposioApps] = useState<ComposioApp[]>([]);
  const [composioLoading, setComposioLoading] = useState(false);
  const [composioError, setComposioError] = useState("");
  const [composioPicked, setComposioPicked] = useState<ComposioApp | null>(null);
  const [composioDetails, setComposioDetails] = useState<ComposioToolkitDetails | null>(null);
  const [composioDetailsLoading, setComposioDetailsLoading] = useState(false);
  const [composioConfigCreds, setComposioConfigCreds] = useState<Record<string, string>>({});
  const [composioInitCreds, setComposioInitCreds] = useState<Record<string, string>>({});
  const [composioSubmitting, setComposioSubmitting] = useState(false);

  // The local integrations catalog is always-on — every install ships
  // (or auto-downloads on first boot) the apteva/integrations JSON,
  // and the server serves it unconditionally. No "Apteva Local"
  // provider row to look up here. Composio stays a real provider:
  // it needs an API key, so it has to be explicitly activated.
  const composioProvider = providerList.find((p) => p.name === "Composio");
  const hasComposio = !!composioProvider;

  const loadConnections = useCallback(() => {
    integrations.connections(currentProject?.id).then(setConnections).catch(() => {});
  }, [currentProject?.id]);

  useEffect(() => {
    if (openMenuFor == null) return;
    const onDocMouseDown = (event: MouseEvent) => {
      const node = actionMenuRef.current;
      if (node && event.target instanceof Node && !node.contains(event.target)) {
        setOpenMenuFor(null);
      }
    };
    document.addEventListener("mousedown", onDocMouseDown);
    return () => document.removeEventListener("mousedown", onDocMouseDown);
  }, [openMenuFor]);

  const loadLocalApps = useCallback(() => {
    // Ask the server to hide apps that are members of a credential
    // group; the suite list below renders one card per group instead.
    // Falls back silently on older servers that don't support group=1.
    integrations.catalog(localSearch, { collapseGroups: true }).then(setLocalApps).catch(() => {});
    // Suites come from a parallel endpoint so the cards can coexist
    // with the flat catalog grid.
    integrations.listGroups().then(setSuites).catch(() => setSuites([]));
  }, [localSearch]);

  const loadComposioApps = useCallback(
    (search?: string) => {
      if (!composioProvider) return;
      setComposioLoading(true);
      setComposioError("");
      integrations
        .composioApps(composioProvider.id, search)
        .then((apps) => setComposioApps(apps || []))
        .catch((err) => setComposioError(err?.message || "Failed to load Composio apps"))
        .finally(() => setComposioLoading(false));
    },
    [composioProvider],
  );

  useEffect(() => {
    let cancelled = false;
    providers
      .list(currentProject?.id)
      .then((p) => {
        if (cancelled) return;
        setProviderList(p);
        setLoaded(true);
      })
      .catch(() => {
        if (cancelled) return;
        setLoaded(true);
      });
    return () => { cancelled = true; };
  }, [currentProject?.id]);

  useEffect(() => {
    loadConnections();
  }, [loadConnections]);

  useEffect(() => {
    if (tab === "local") loadLocalApps();
  }, [tab, loadLocalApps]);

  useEffect(() => {
    if (tab === "composio" && composioApps.length === 0) loadComposioApps();
  }, [tab, loadComposioApps, composioApps.length]);

  // Debounced server-side search when the user types in the Composio search
  // box — the upstream catalog is large and client-side filtering only covers
  // the first page we fetched on mount.
  useEffect(() => {
    if (tab !== "composio") return;
    const t = setTimeout(() => {
      loadComposioApps(composioSearch || undefined);
    }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [composioSearch, tab]);

  // Default tab: local catalog is always-on, so we land there.
  // Composio only auto-selects if we've nothing better to show
  // (placeholder — kept for future variants that might land
  // composio-first).
  useEffect(() => {
    if (!loaded) return;
  }, [loaded, hasComposio]);

  // --- Local app interactions ---

  const nextLocalConnectionName = (slug: string, appName: string) => {
    const existing = (connections || []).filter(
      (c) => c.app_slug === slug && c.source === "local",
    );
    return existing.length === 0 ? appName : `${appName} ${existing.length + 1}`;
  };

  const selectLocalApp = async (slug: string) => {
    const app = await integrations.app(slug);
    setSelectedLocalApp(app);
    setCredentials({});
    // Suggest a default connection name. If the user already has one or
    // more connections for this app in the current project, append a
    // suffix so the unique-name server check doesn't immediately reject
    // the submit. The user can still edit the field before saving.
    setConnName(nextLocalConnectionName(slug, app.name));
    setError("");
    setOAuthClientID("");
    setOAuthClientSecret("");
    setOAuthClientResolved(false);
    setOAuthCallbackURL("");
    setAutoMCP(true);
    setDeviceAuth(null);
    setDeviceAuthStatus(null);
    setDeviceAuthPollTick(0);

    // For OAuth2 apps, find out whether the user already registered an
    // OAuth client for this app+project. If yes, hide the form. If no,
    // we'll show two fields plus the callback URL helper.
    if (defaultLocalAuthType(app) === "oauth2") {
      try {
        const status = await integrations.oauthClientStatus(slug, currentProject?.id);
        setOAuthClientResolved(status.resolved);
        setOAuthCallbackURL(status.callback_url);
      } catch {
        // Non-fatal — the user can still type creds; the server will
        // re-validate on submit.
      }
    }
  };

  const handleConnectLocal = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedLocalApp || !connName.trim()) return;
    setError("");
    setConnecting(true);
    try {
      const authType = defaultLocalAuthType(selectedLocalApp);
      const isOAuth2 = authType === "oauth2";
      const isDeviceCode = authType === "oauth_device_code";
      const oauthCreds = isOAuth2 && !oauthClientResolved
        ? { client_id: oauthClientID.trim(), client_secret: oauthClientSecret.trim() }
        : undefined;
      const result = await integrations.connect(
        selectedLocalApp.slug,
        connName.trim(),
        credentials,
        authType || undefined,
        currentProject?.id,
        oauthCreds,
        undefined,        // createdVia — default 'integration'
        autoMCP,          // operator's expose-to-agents choice
      );
      if ((result as ConnectCreateResponse).device_auth) {
        const r = result as ConnectCreateResponse;
        setDeviceAuth({ connection: r.connection, auth: r.device_auth! });
        setDeviceAuthStatus({ status: "pending", next_poll_seconds: r.device_auth!.interval_seconds || 5 });
        setDeviceAuthPollTick(0);
        return;
      }
      // OAuth2 apps return { connection, redirect_url } — open the popup and
      // start polling the pending connection. Non-OAuth apps return the
      // connection object directly, fully active.
      if ((result as ConnectCreateResponse).redirect_url) {
        const r = result as ConnectCreateResponse;
        openOAuthPopup(r.redirect_url || "");
        pollConnection(r.connection.id, autoMCP);
      } else {
        loadConnections();
        // Non-OAuth path: response IS the connection (ConnectionInfo).
        // Open the tool picker immediately so the user can create the
        // first MCP for this integration — but only if the operator
        // chose to expose this integration to agents. When autoMCP is
        // off the server didn't create an MCP, so there's nothing for
        // the picker to edit.
        if (autoMCP) openPickerFor(result as unknown as ConnectionInfo);
      }
      setSelectedLocalApp(null);
      setCredentials({});
      setOAuthClientID("");
      setOAuthClientSecret("");
    } catch (err: any) {
      // The server's pre-flight check returns 400 with a JSON body
      // shaped { error, detail, status_code, health_check } when
      // the credentials don't pass the catalog's health_check
      // probe. Parse it so the form shows "HTTP 403: …" rather
      // than the raw JSON. Falls through to the plain-text path
      // for any other 4xx/5xx.
      let msg: string = err?.message || "Failed to connect";
      try {
        const parsed = JSON.parse(msg);
        if (parsed && typeof parsed === "object") {
          if (parsed.health_check) {
            msg = `Credential check failed — ${parsed.detail || "upstream rejected the request"}`;
          } else if (parsed.error) {
            msg = parsed.error + (parsed.detail ? ` — ${parsed.detail}` : "");
          }
        }
      } catch {
        // not JSON — leave msg as-is
      }
      setError(msg);
    } finally {
      setConnecting(false);
    }
  };

  // --- Composio interactions ---

  // Clicking a Composio app fetches its schema and decides whether we need
  // to collect anything on our side. Per Composio's documented flow:
  //   - Managed OAuth toolkits (is_composio_managed=true, e.g. GitHub,
  //     Google Sheets) → zero inline form, open Connect Link popup
  //     immediately. Composio runs its own OAuth app. The auth_config is
  //     use_composio_managed_auth (no credentials needed from us). Note
  //     that Composio's toolkit schema still lists config_fields for these
  //     toolkits, but those are optional "bring-your-own-OAuth" overrides
  //     — we ignore them for managed flows.
  //   - API_KEY / BASIC / BEARER toolkits (Pushover) → zero inline form,
  //     open Connect Link popup, user enters credentials on Composio's
  //     hosted form.
  //   - Non-managed OAuth toolkits where the user *wants* their own OAuth
  //     app → inline form for config_fields (client_id / client_secret),
  //     which we write into a use_custom_auth auth config. We don't offer
  //     this today — managed flows cover the common case.
  //
  // Rule: if the toolkit is composio-managed OR has no config_fields, skip
  // our form entirely and let Composio handle credential collection.
  const handlePickComposio = async (app: ComposioApp) => {
    if (!composioProvider) return;
    setComposioError("");

    // Fetch toolkit details FIRST so we can decide whether we need to
    // render our own side panel at all. Composio-managed and
    // no-config-field toolkits hand the entire credential collection
    // off to Composio's hosted modal — opening (and immediately
    // closing) our side panel just causes a visible flash. Only call
    // setComposioPicked when there's a real form to show.
    setComposioDetailsLoading(true);
    let d: ComposioToolkitDetails;
    try {
      d = await integrations.composioToolkit(composioProvider.id, app.slug);
    } catch (err: any) {
      setComposioError(err?.message || "Failed to load toolkit details");
      setComposioDetailsLoading(false);
      return;
    }
    setComposioDetailsLoading(false);

    const shouldSkipForm = d.is_composio_managed || d.config_fields.length === 0;
    if (shouldSkipForm) {
      // Straight to Composio's hosted flow — no inline side panel.
      // submitComposioConnection opens the popup with the redirect_url
      // it gets back from the server.
      await submitComposioConnection(app, d, {}, {});
      return;
    }

    // Real config_fields to collect (e.g. the user wants to bring their
    // own OAuth client_id/secret instead of using composio-managed
    // auth) — show the inline form.
    setComposioPicked(app);
    setComposioDetails(d);
    setComposioConfigCreds({});
    setComposioInitCreds({});
  };

  const submitComposioConnection = async (
    app: ComposioApp,
    details: ComposioToolkitDetails,
    configCreds: Record<string, string>,
    initCreds: Record<string, string>,
  ) => {
    if (!composioProvider) return;
    setComposioSubmitting(true);
    try {
      // For composio-managed toolkits, the server must create the auth
      // config with type=use_composio_managed_auth. Our server's
      // ensureAuthConfig takes the managed path only when authMode is
      // empty, so we send an empty string here to signal that intent.
      // For non-managed toolkits we pass the scheme verbatim so the server
      // uses use_custom_auth.
      const authMode = details.is_composio_managed ? "" : details.auth_mode.toUpperCase();
      const result = await integrations.connectComposio(composioProvider.id, app.slug, {
        name: app.name,
        projectId: currentProject?.id,
        authMode,
        configCreds,
        initCreds,
      });
      // Two response shapes:
      //   - redirect_url set → OAuth flow, open popup and poll
      //   - redirect_url empty → direct create succeeded on the server side,
      //     connection is already active, just refresh
      if (result.redirect_url) {
        openOAuthPopup(result.redirect_url);
        pollConnection(result.connection.id, true);
      } else if (result.connection) {
        // Composio direct create (no redirect needed) — connection is
        // already active, go straight to the tool picker.
        openPickerFor(result.connection as unknown as ConnectionInfo);
      }
      setComposioPicked(null);
      setComposioDetails(null);
      setComposioConfigCreds({});
      setComposioInitCreds({});
      loadConnections();
    } catch (err: any) {
      setComposioError(err?.message || "Failed to start Composio connection");
    } finally {
      setComposioSubmitting(false);
    }
  };

  const handleSubmitComposioForm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!composioPicked || !composioDetails) return;
    await submitComposioConnection(composioPicked, composioDetails, composioConfigCreds, composioInitCreds);
  };

  // --- OAuth popup + poll ---

  const openOAuthPopup = (url: string): Window | null => {
    const w = 540;
    const h = 680;
    const left = window.screenX + (window.outerWidth - w) / 2;
    const top = window.screenY + (window.outerHeight - h) / 2;
    return window.open(
      url,
      "apteva-oauth",
      `width=${w},height=${h},left=${left},top=${top},menubar=no,toolbar=no,location=no`,
    );
  };

  const pollConnection = (id: number, openPickerOnDone: boolean) => {
    let attempts = 0;
    const tick = async () => {
      attempts += 1;
      try {
        const c = await integrations.get(id);
        if (c.status === "active") {
          loadConnections();
          // Connection finished OAuth — open the tool picker so the user
          // can pick which tools to expose as the first MCP for this
          // integration. Skip when the operator unchecked "expose to
          // agents" (no MCP exists to edit).
          if (openPickerOnDone) openPickerFor(c as unknown as ConnectionInfo);
          return;
        }
        if (c.status === "failed") {
          loadConnections();
          return;
        }
      } catch {
        // ignore transient errors
      }
      if (attempts < 120) setTimeout(tick, 1500);
    };
    setTimeout(tick, 1500);
  };

  const waitForOAuthPopupResult = (
    popup: Window | null,
    onDone: (ok: boolean | null) => void,
  ) => {
    let done = false;
    let onMessage: (event: MessageEvent) => void;
    let closePoll: number | undefined;
    const finish = (ok: boolean | null) => {
      if (done) return;
      done = true;
      window.removeEventListener("message", onMessage);
      if (closePoll != null) window.clearInterval(closePoll);
      onDone(ok);
    };
    onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      const data = event.data as { type?: string; ok?: boolean } | null;
      if (!data || data.type !== "apteva-oauth-result") return;
      finish(!!data.ok);
    };
    window.addEventListener("message", onMessage);
    if (!popup) {
      finish(false);
      return;
    }
    closePoll = window.setInterval(() => {
      if (popup.closed) finish(null);
    }, 500);
    window.setTimeout(() => finish(false), 180_000);
  };

  const handleAddOAuthAccount = async (c: ConnectionInfo) => {
    setOpenMenuFor(null);
    setError("");
    setConnecting(true);
    try {
      const app = await integrations.app(c.app_slug);
      const result = await integrations.connect(
        app.slug,
        nextLocalConnectionName(app.slug, app.name),
        {},
        "oauth2",
        currentProject?.id,
        undefined,
        undefined,
        true,
      );
      const r = result as ConnectCreateResponse;
      if (r.redirect_url) {
        openOAuthPopup(r.redirect_url);
        pollConnection(r.connection.id, true);
      }
    } catch (err: any) {
      setError(err?.message || "Failed to start OAuth");
    } finally {
      setConnecting(false);
    }
  };

  const handleReauthConnection = async (c: ConnectionInfo) => {
    setOpenMenuFor(null);
    setError("");
    setReauthInFlight((prev) => new Set(prev).add(c.id));
    try {
      const r = await integrations.reauth(c.id);
      const popup = openOAuthPopup(r.redirect_url || "");
      waitForOAuthPopupResult(popup, (ok) => {
        setReauthInFlight((prev) => {
          const next = new Set(prev);
          next.delete(c.id);
          return next;
        });
        loadConnections();
        if (ok === false) setError("OAuth re-auth did not complete");
      });
    } catch (err: any) {
      setReauthInFlight((prev) => {
        const next = new Set(prev);
        next.delete(c.id);
        return next;
      });
      setError(err?.message || "Failed to start re-auth");
    }
  };

  useEffect(() => {
    if (!deviceAuth?.auth.session_id || deviceAuthStatus?.status !== "pending") return;
    let cancelled = false;
    const delay = Math.max(2, deviceAuthStatus.next_poll_seconds || deviceAuth.auth.interval_seconds || 5) * 1000;
    const timer = window.setTimeout(async () => {
      try {
        const next = await integrations.deviceAuthPoll(deviceAuth.auth.session_id);
        if (cancelled) return;
        setDeviceAuthStatus(next);
        if (next.status === "connected" && next.connection) {
          loadConnections();
          if (autoMCP) openPickerFor(next.connection as unknown as ConnectionInfo);
          setSelectedLocalApp(null);
          setDeviceAuth(null);
          setDeviceAuthStatus(null);
          setDeviceAuthPollTick(0);
        } else if (next.status === "pending") {
          setDeviceAuthPollTick((n) => n + 1);
        } else if (next.status === "expired" || next.status === "failed") {
          setError(next.error || `Authentication ${next.status}`);
        }
      } catch (err: any) {
        if (!cancelled) setError(err?.message || "Authentication check failed");
      }
    }, delay);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [deviceAuth?.auth.session_id, deviceAuthStatus?.status, deviceAuthStatus?.next_poll_seconds, deviceAuthPollTick, autoMCP, loadConnections]);

  const handleDisconnect = async (id: number) => {
    await integrations.disconnect(id);
    loadConnections();
  };

  // handleTestConnection runs the catalog's health_check probe
  // against this connection's stored credentials. Result lives in
  // the testResults map and renders inline next to the row's
  // status dot. The button stays clickable during the request so
  // a user can fire repeated probes (e.g. while watching an
  // upstream incident clear) — the in-flight set prevents races.
  const handleTestConnection = useCallback(async (id: number) => {
    setTestInFlight((prev) => new Set(prev).add(id));
    try {
      const r = await integrations.testConnection(id);
      setTestResults((prev) => ({ ...prev, [id]: r }));
    } catch (err: any) {
      // Network / 5xx — treat as failure with a generic message
      // since the server didn't get to run the probe at all.
      setTestResults((prev) => ({
        ...prev,
        [id]: {
          ok: false,
          latency_ms: 0,
          error: err?.message || "test request failed",
        },
      }));
    } finally {
      setTestInFlight((prev) => {
        const n = new Set(prev);
        n.delete(id);
        return n;
      });
    }
  }, []);

  const openInviteFor = async (c: ConnectionInfo) => {
    setInviteFor(c);
    setInviteLink(null);
    setInviteErr("");
    setCopied(false);
    setInviteBusy(true);
    try {
      const r = await invites.create({
        app_slug: c.app_slug,
        source: c.source || "local",
        project_id: c.project_id || "",
        connection_id: c.id,
      });
      setInviteLink(r);
    } catch (e: any) {
      setInviteErr(e?.message || "failed to create invite");
    } finally {
      setInviteBusy(false);
    }
  };

  // Open the tool picker for a freshly-created connection.
  //
  // Local integrations: create path auto-registered one MCP server with
  // every tool enabled — we locate that row by connection_id and edit
  // its allowed_tools in place.
  //
  // Composio integrations: MCP rows are pooled per-toolkit (not
  // per-connection) and carry source="remote". They're not linked via
  // connection_id, so we match on (source="remote", name=toolkit slug,
  // provider_id). The server-side /mcp-servers/:id/tools endpoint
  // already fetches the full Composio action catalog for remote rows,
  // and PUT /tools triggers the reconcile that rotates Composio's
  // upstream server to pick up the new action set.
  const openPickerFor = async (c: ConnectionInfo) => {
    setPickerFor(c);
    setPickerMCPId(null);
    setPickerTools([]);
    setPickerSelected(new Set());
    setPickerErr("");
    setPickerFilter("");
    setPickerLoading(true);
    try {
      const servers = await mcpServers.list(c.project_id || "");
      const existing = c.source === "composio"
        ? (servers || []).find(
            (s) =>
              s.source === "remote" &&
              s.name === c.app_slug &&
              (c.provider_id == null || s.provider_id === c.provider_id),
          )
        : (servers || []).find((s) => s.connection_id === c.id);
      if (existing) {
        const info = await mcpServers.tools(existing.id);
        setPickerMCPId(existing.id);
        setPickerTools(info.tools.map((t) => ({ name: t.name, description: t.description })));
        // Pre-tick the currently-persisted filter; if none set, tick all
        // (matches the "all tools exposed" semantics of an empty filter).
        const current = info.allowed_tools && info.allowed_tools.length > 0
          ? new Set(info.allowed_tools)
          : new Set(info.tools.map((t) => t.name));
        setPickerSelected(current);
      } else if (c.source === "composio") {
        // Composio connection active but reconcile hasn't produced an
        // MCP row yet — fall back to the raw toolkit action catalog so
        // the user can still pick. On submit we skip the unknown
        // pickerMCPId path; the reconcile will create the row with the
        // chosen filter on the next boot.
        const actions = await integrations.composioToolkitActions(c.app_slug);
        setPickerTools(
          (actions || []).map((a) => ({
            name: a.slug,
            description: a.description || a.name,
          })),
        );
        // Default: tick all so an empty selection doesn't silently
        // disable every tool — user can untick what they don't want.
        setPickerSelected(new Set((actions || []).map((a) => a.slug)));
      } else {
        // Local fallback: no MCP row auto-created — use the raw
        // connection tool catalog and create a new scoped MCP on submit.
        const tools = await integrations.tools(c.id);
        setPickerTools(tools);
        setPickerSelected(new Set(tools.map((t) => t.name)));
      }
    } catch (e: any) {
      setPickerErr(e?.message || "failed to load tools");
    } finally {
      setPickerLoading(false);
    }
  };

  const togglePickerTool = (name: string) => {
    setPickerSelected((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const submitPicker = async () => {
    if (!pickerFor) return;
    if (pickerSelected.size === 0) { setPickerErr("pick at least one tool"); return; }
    setPickerBusy(true);
    setPickerErr("");
    try {
      const allowed = Array.from(pickerSelected);
      if (pickerMCPId != null) {
        // Edit the auto-created MCP row in place — no second MCP server.
        // For Composio remote rows, the server's PUT /tools handler
        // triggers a reconcile that rotates the upstream Composio
        // server to the new action set.
        await mcpServers.setAllowedTools(pickerMCPId, allowed);
      } else if (pickerFor.source === "composio") {
        // Composio reconcile hasn't produced an MCP row yet (race
        // between connection activation and the background reconcile).
        // Refuse the save rather than silently dropping the selection —
        // the user can re-open the picker in a moment and try again.
        throw new Error(
          "Composio is still provisioning this toolkit. Reload the page and try again in a few seconds.",
        );
      } else {
        // Local fallback (no auto-created MCP found) — create a scoped one.
        await integrations.createScopedMCP(
          pickerFor.id,
          `${pickerFor.app_slug}-${pickerFor.id}`,
          allowed,
        );
      }
      setPickerFor(null);
      loadConnections();
    } catch (e: any) {
      setPickerErr(e?.message || "failed to save tools");
    } finally {
      setPickerBusy(false);
    }
  };

  const openRenameFor = (c: ConnectionInfo) => {
    setRenameFor(c);
    setRenameText(c.name);
    setRenameErr("");
  };

  const openCredsFor = async (c: ConnectionInfo) => {
    setCredsFor(c);
    setCredsData(null);
    setCredsErr("");
    setCredsRevealed(new Set());
    setCredsCopied(null);
    setCredsBusy(true);
    try {
      const r = await integrations.credentials(c.id);
      setCredsData(r.credentials || {});
    } catch (e: any) {
      setCredsErr(e?.message || "failed to load credentials");
    } finally {
      setCredsBusy(false);
    }
  };

  const closeCreds = () => {
    setCredsFor(null);
    setCredsData(null);
    setCredsRevealed(new Set());
    setCredsCopied(null);
    setCredsErr("");
  };

  const toggleCredReveal = (key: string) => {
    setCredsRevealed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const copyCred = async (key: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCredsCopied(key);
      setTimeout(() => setCredsCopied((k) => (k === key ? null : k)), 1500);
    } catch {
      // clipboard blocked (insecure context, etc.) — silent
    }
  };

  const submitRename = async () => {
    if (!renameFor) return;
    const next = renameText.trim();
    if (!next || next === renameFor.name) { setRenameFor(null); return; }
    setRenameBusy(true);
    setRenameErr("");
    try {
      await integrations.rename(renameFor.id, next);
      setRenameFor(null);
      loadConnections();
    } catch (e: any) {
      setRenameErr(e?.message || "rename failed");
    } finally {
      setRenameBusy(false);
    }
  };

  const copyInvite = async () => {
    if (!inviteLink) return;
    try {
      await navigator.clipboard.writeText(inviteLink.url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignore — user can select + copy manually
    }
  };

  // --- Filtering for Composio ---

  const filteredComposioApps = composioSearch
    ? composioApps.filter(
        (a) =>
          a.name.toLowerCase().includes(composioSearch.toLowerCase()) ||
          a.slug.toLowerCase().includes(composioSearch.toLowerCase()),
      )
    : composioApps;

  // --- Render ---

  if (!loaded) return null;

  // renderConnectionRow — single source of truth for a connection row.
  // Secondary operations live behind the overflow menu so adding OAuth
  // lifecycle actions does not keep stretching each row horizontally.
  const renderConnectionRow = (c: ConnectionInfo) => {
    const isGlobal = !c.project_id;
    const isLocalOAuth = (c.source || "local") === "local" && c.auth_type === "oauth2";
    const canMoveScope = c.source !== "composio" && (isGlobal ? currentProject?.id : true);
    const canExplore = c.source !== "composio" && c.app_slug === "bunny-stream" && c.status === "active";
    const menuOpen = openMenuFor === c.id;
    const menuItemClass = "block w-full text-left px-3 py-2 text-sm text-text-muted hover:bg-bg-hover hover:text-text transition-colors";
    return (
      <div
        key={c.id}
        className="border border-border rounded-lg p-4 bg-bg-card flex items-center justify-between gap-4"
      >
        <div className="min-w-0 flex items-center gap-3">
          <span
            className={`inline-block w-2.5 h-2.5 rounded-full ${
              c.status === "active"
                ? "bg-green"
                : c.status === "pending"
                  ? "bg-warn"
                  : "bg-red"
            }`}
          />
          <div className="min-w-0">
            {c.is_group_child ? (
              <span
                className="text-text text-base font-bold"
                title={c.external_project_id ? `Suite child — pinned to project ${c.external_project_id}` : undefined}
              >
                {c.app_name} {c.name}
              </span>
            ) : (
              <>
                <span className="text-text text-base font-bold">{c.name}</span>
                <span className="text-text-muted text-sm ml-2">· {c.app_name}</span>
              </>
            )}
          </div>
          <span
            className={`text-xs px-1.5 py-0.5 rounded ${
              c.source === "composio"
                ? "bg-purple-900/40 text-purple-300"
                : "bg-bg-hover text-text-dim"
            }`}
          >
            {c.source || "local"}
          </span>
          {isGlobal && (
            <span
              className="text-xs px-1.5 py-0.5 rounded bg-accent/20 text-accent"
              title="Visible from every project"
            >
              global
            </span>
          )}
          {c.status === "pending" && (
            <span className="text-xs text-warn">pending…</span>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-3">
          {c.tool_count > 0 && (
            <span className="text-text-dim text-sm">{c.tool_count} tools</span>
          )}
          {testResults[c.id] && (
            <ConnectionTestBadge result={testResults[c.id]} />
          )}
          <div className="relative" ref={menuOpen ? actionMenuRef : null}>
            <button
              type="button"
              onClick={() => setOpenMenuFor(menuOpen ? null : c.id)}
              className="w-8 h-8 rounded border border-border text-text-muted hover:text-text hover:bg-bg-hover transition-colors"
              title="Connection actions"
              aria-label="Connection actions"
            >
              ⋮
            </button>
            {menuOpen && (
              <div className="absolute right-0 top-9 z-20 w-52 overflow-hidden rounded-md border border-border bg-bg-card shadow-xl">
                <button className={menuItemClass} onClick={() => { setOpenMenuFor(null); openRenameFor(c); }}>
                  Rename
                </button>
                <button className={menuItemClass} onClick={() => { setOpenMenuFor(null); openCredsFor(c); }}>
                  View credentials
                </button>
                {canExplore && (
                  <button
                    className={menuItemClass}
                    onClick={() => {
                      setOpenMenuFor(null);
                      setExplorerFor(c);
                    }}
                  >
                    Explore
                  </button>
                )}
                <button
                  className={`${menuItemClass} disabled:opacity-50`}
                  disabled={testInFlight.has(c.id)}
                  onClick={() => { setOpenMenuFor(null); handleTestConnection(c.id); }}
                >
                  {testInFlight.has(c.id) ? "Testing..." : "Test connection"}
                </button>
                {isLocalOAuth && (
                  <>
                    <button
                      className={menuItemClass}
                      disabled={connecting}
                      onClick={() => handleAddOAuthAccount(c)}
                    >
                      Add account
                    </button>
                    <button
                      className={`${menuItemClass} disabled:opacity-50`}
                      disabled={reauthInFlight.has(c.id)}
                      onClick={() => handleReauthConnection(c)}
                    >
                      {reauthInFlight.has(c.id) ? "Re-authing..." : "Re-auth"}
                    </button>
                  </>
                )}
                {canMoveScope && (
                  <button
                    className={menuItemClass}
                    onClick={() => {
                      setOpenMenuFor(null);
                      setScopeFlipErr("");
                      setScopeFlipFor(c);
                    }}
                  >
                    {isGlobal ? `Move to ${currentProject?.name || "project"}` : "Move to global"}
                  </button>
                )}
                <button className={menuItemClass} onClick={() => { setOpenMenuFor(null); openInviteFor(c); }}>
                  Invite
                </button>
                <div className="border-t border-border" />
                <button
                  className="block w-full text-left px-3 py-2 text-sm text-red hover:bg-bg-hover transition-colors"
                  onClick={() => { setOpenMenuFor(null); handleDisconnect(c.id); }}
                >
                  Disconnect
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="flex flex-col h-full">
      <div className="border-b border-border px-6 py-4">
        <h1 className="text-text text-lg font-bold">Integrations</h1>
        <p className="text-text-muted text-sm mt-1">
          Connect apps and services to your Apteva instances.
        </p>
      </div>

      {/* Source tabs — Apteva Local is always available; Composio
          stays a real provider, gated on its API key being set. */}
      <div className="border-b border-border px-6 flex gap-0">
        <button
          onClick={() => setTab("local")}
          className={`px-5 py-3 text-sm transition-colors border-b-2 -mb-px ${
            tab === "local"
              ? "text-accent border-accent"
              : "text-text-muted border-transparent hover:text-text"
          }`}
        >
          Apteva Local
        </button>
        <button
          onClick={() => setTab("composio")}
          disabled={!hasComposio}
          className={`px-5 py-3 text-sm transition-colors border-b-2 -mb-px ${
            tab === "composio"
              ? "text-accent border-accent"
              : "text-text-muted border-transparent hover:text-text"
          } ${!hasComposio ? "opacity-50 cursor-not-allowed" : ""}`}
        >
          Composio {!hasComposio && "· inactive"}
        </button>
      </div>

      <div className="flex-1 flex min-h-0">
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Active connections — shared across sources.
              v0.15.0 splits the list into "Project: <name>" and
              "Global" sections so the operator can tell at a glance
              which connections are scoped to the current project vs.
              visible across every project. Both sections render the
              same row component; only the heading differs. */}
          {connections && connections.length > 0 && (
            <section>
              <h2 className="text-text text-base font-bold mb-3">
                Connected ({connections.length})
              </h2>
              {(() => {
                const globals = connections.filter((c) => !c.project_id);
                const local = connections.filter((c) => c.project_id);
                return (
                  <>
                    {local.length > 0 && (
                      <div className="mb-4">
                        <div className="text-text-muted text-xs mb-2 uppercase tracking-wide">
                          Project{currentProject?.name ? `: ${currentProject.name}` : ""}
                          {" "}
                          ({local.length})
                        </div>
                        <div className="space-y-2">
                          {local.map((c) => renderConnectionRow(c))}
                        </div>
                      </div>
                    )}
                    {globals.length > 0 && (
                      <div>
                        <div className="text-text-muted text-xs mb-2 uppercase tracking-wide">
                          Global ({globals.length})
                        </div>
                        <div className="space-y-2">
                          {globals.map((c) => renderConnectionRow(c))}
                        </div>
                      </div>
                    )}
                  </>
                );
              })()}
            </section>
          )}

          {/* Tab content */}
          {tab === "local" && (
            <section>
              <h2 className="text-text text-base font-bold mb-3">App Catalog</h2>
              <input
                value={localSearch}
                onChange={(e) => setLocalSearch(e.target.value)}
                className="w-full bg-bg-input border border-border rounded-lg px-4 py-3 text-base text-text focus:outline-none focus:border-accent mb-4"
                placeholder="Search apps..."
              />
              {(() => {
                // Shared per-app card renderer — used from the merged
                // sort below. Kept as a local closure so it captures
                // `connections` + `selectLocalApp` without prop drilling.
                const renderLocalAppCard = (app: AppSummary) => {
                  const connectedCount = (connections || []).filter(
                    (c) => c.app_slug === app.slug && c.source === "local",
                  ).length;
                  return (
                    <button
                      key={app.slug}
                      onClick={() => selectLocalApp(app.slug)}
                      className={`border rounded-lg p-4 text-left transition-colors ${
                        connectedCount > 0
                          ? "border-green bg-bg-card"
                          : "border-border bg-bg-card hover:border-accent"
                      }`}
                    >
                      <div className="flex items-center gap-3 mb-2">
                        <AppLogo src={app.logo} className="w-6 h-6 rounded" />
                        <div className="flex-1 min-w-0">
                          <span className="text-text text-sm font-bold">{app.name}</span>
                        </div>
                        {connectedCount === 1 && <span className="text-green text-xs shrink-0">connected</span>}
                        {connectedCount > 1 && (
                          <span className="text-green text-xs shrink-0">{connectedCount} connections</span>
                        )}
                      </div>
                      <p className="text-text-muted text-xs leading-relaxed line-clamp-2">{app.description}</p>
                      <div className="flex items-center gap-2 mt-2">
                        <span className="text-text-dim text-xs">{app.tool_count} tools</span>
                      </div>
                    </button>
                  );
                };
                return (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                    {(() => {
                  type SuiteItem = { kind: "suite"; sortName: string; suite: SuiteSummary };
                  type AppItem = { kind: "app"; sortName: string; app: AppSummary };
                  const items: Array<SuiteItem | AppItem> = [
                    ...(suites || []).map<SuiteItem>((s) => ({
                      kind: "suite",
                      sortName: s.name.toLowerCase(),
                      suite: s,
                    })),
                    ...(localApps || []).map<AppItem>((a) => ({
                      kind: "app",
                      sortName: a.name.toLowerCase(),
                      app: a,
                    })),
                  ];
                  items.sort((a, b) => a.sortName.localeCompare(b.sortName));
                  return items.map((item) => {
                    if (item.kind === "suite") {
                      const suite = item.suite;
                      const connectedCount = (connections || []).filter((c) =>
                        suite.members.some((m) => m.slug === c.app_slug),
                      ).length;
                      return (
                        <button
                          key={`suite:${suite.id}`}
                          onClick={() => setActiveSuite(suite)}
                          className={`border rounded-lg p-4 text-left transition-colors ${
                            connectedCount > 0
                              ? "border-green bg-bg-card"
                              : "border-border bg-bg-card hover:border-accent"
                          }`}
                        >
                          <div className="flex items-center gap-3 mb-2">
                            <AppLogo src={suite.logo} className="w-6 h-6 rounded" />
                            <div className="flex-1 min-w-0">
                              <span className="text-text text-sm font-bold">{suite.name}</span>
                              <span className="text-text-muted text-xs ml-2">
                                suite · {suite.members.length} services
                              </span>
                            </div>
                            {connectedCount > 0 && (
                              <span className="text-green text-xs shrink-0">{connectedCount} connected</span>
                            )}
                          </div>
                          <p className="text-text-muted text-xs leading-relaxed line-clamp-2">{suite.description}</p>
                        </button>
                      );
                    }
                    // kind === "app" — fall through to the original
                    // per-app card below.
                    return renderLocalAppCard(item.app);
                  });
                })()}

                  </div>
                );
              })()}
              {localApps.length === 0 && suites.length === 0 && (
                <p className="text-text-muted text-sm">No apps found.</p>
              )}
            </section>
          )}

          {tab === "composio" && hasComposio && (
            <section>
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-text text-base font-bold">Composio App Catalog</h2>
                <button
                  onClick={loadComposioApps}
                  className="text-xs text-accent hover:text-accent-hover transition-colors"
                >
                  Refresh
                </button>
              </div>
              <input
                value={composioSearch}
                onChange={(e) => setComposioSearch(e.target.value)}
                className="w-full bg-bg-input border border-border rounded-lg px-4 py-3 text-base text-text focus:outline-none focus:border-accent mb-4"
                placeholder="Search Composio apps..."
              />
              {composioLoading && <p className="text-text-muted text-sm">Loading Composio catalog…</p>}
              {composioError && <p className="text-red text-sm mb-3">{composioError}</p>}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {filteredComposioApps.map((app) => {
                  const isConnected = (connections || []).some(
                    (c) => c.app_slug === app.slug && c.source === "composio",
                  );
                  return (
                    <button
                      key={app.slug}
                      onClick={() => !isConnected && handlePickComposio(app)}
                      disabled={isConnected}
                      className={`border rounded-lg p-4 text-left transition-colors ${
                        isConnected
                          ? "border-green bg-bg-card cursor-default"
                          : "border-border bg-bg-card hover:border-accent"
                      }`}
                    >
                      <div className="flex items-center gap-3 mb-2">
                        <AppLogo src={app.logo} className="w-6 h-6 rounded" />
                        <div className="flex-1 min-w-0">
                          <span className="text-text text-sm font-bold">{app.name}</span>
                          <span className="text-text-dim text-xs ml-1.5">{app.slug}</span>
                        </div>
                        {app.composio_managed && (
                          <span className="text-[10px] px-1 py-0.5 rounded bg-accent/20 text-accent">
                            managed
                          </span>
                        )}
                        {isConnected && <span className="text-green text-xs shrink-0">connected</span>}
                      </div>
                      {app.description && (
                        <p className="text-text-muted text-xs leading-relaxed line-clamp-2">
                          {app.description}
                        </p>
                      )}
                    </button>
                  );
                })}
              </div>
              {!composioLoading && filteredComposioApps.length === 0 && (
                <p className="text-text-muted text-sm">No apps.</p>
              )}
              <p className="text-text-dim text-xs mt-4">
                Clicking an app opens Composio's OAuth flow in a popup. Composio handles the
                entire authorization on its side — we only store a reference. A single hosted
                MCP server will appear in the MCP Servers list, aggregating every Composio
                connection in this project.
              </p>
            </section>
          )}
        </div>

        {/* Composio toolkit connect form (right panel) */}
        {tab === "composio" && composioPicked && (
          <div className="w-96 border-l border-border overflow-y-auto p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-text text-base font-bold">{composioPicked.name}</h2>
              <button
                onClick={() => {
                  setComposioPicked(null);
                  setComposioDetails(null);
                  setComposioConfigCreds({});
                  setComposioInitCreds({});
                }}
                className="text-text-muted hover:text-text text-sm transition-colors"
              >
                Close
              </button>
            </div>

            {composioDetailsLoading && (
              <p className="text-text-muted text-sm">Loading toolkit details…</p>
            )}

            {composioError && <p className="text-red text-sm mb-4">{composioError}</p>}

            {composioDetails && (
              <>
                <div className="text-text-dim text-xs mb-4">
                  Auth: {composioDetails.auth_mode_display || composioDetails.auth_mode}
                  {composioDetails.is_composio_managed && (
                    <span className="ml-2 text-accent">· composio-managed</span>
                  )}
                </div>

                {composioDetails.auth_guide_url && (
                  <a
                    href={composioDetails.auth_guide_url}
                    target="_blank"
                    rel="noreferrer"
                    className="text-accent text-xs hover:text-accent-hover block mb-4"
                  >
                    → setup guide for {composioDetails.name}
                  </a>
                )}

                {composioDetails.config_fields.length === 0 && (
                  <div className="bg-bg-hover border border-border rounded-lg p-3 mb-4 text-xs text-text-muted">
                    {composioDetails.is_composio_managed
                      ? "Clicking Authorize opens Composio's OAuth flow — you'll be redirected to the provider to sign in."
                      : "Clicking Connect opens Composio's hosted credential form where you'll enter your API key. Composio stores it on their side."}
                  </div>
                )}

                <form onSubmit={handleSubmitComposioForm} className="space-y-4">
                  {composioDetails.config_fields.length > 0 && (
                    <>
                      <p className="text-text-muted text-xs">
                        These fields configure the auth config itself (e.g. your own OAuth app's
                        client id/secret). The user's per-connection credentials are entered on
                        Composio's side after submit.
                      </p>
                      {composioDetails.config_fields.map((f) => (
                        <div key={`c-${f.name}`}>
                          <label className="block text-text-muted text-sm mb-1">
                            {f.display_name}
                            {f.required && <span className="text-red ml-1">*</span>}
                          </label>
                          {f.description && (
                            <p className="text-text-dim text-xs mb-1">{f.description}</p>
                          )}
                          <input
                            type={f.type === "password" || /key|secret|token/i.test(f.name) ? "password" : "text"}
                            value={composioConfigCreds[f.name] || ""}
                            onChange={(e) =>
                              setComposioConfigCreds({ ...composioConfigCreds, [f.name]: e.target.value })
                            }
                            className="w-full bg-bg-input border border-border rounded-lg px-4 py-3 text-sm text-text focus:outline-none focus:border-accent"
                            required={f.required}
                          />
                        </div>
                      ))}
                    </>
                  )}

                  <button
                    type="submit"
                    disabled={composioSubmitting}
                    className="w-full px-5 py-3 bg-accent text-bg rounded-lg font-bold text-sm hover:bg-accent-hover transition-colors disabled:opacity-50"
                  >
                    {composioSubmitting
                      ? "Connecting…"
                      : composioDetails.is_composio_managed
                        ? "Authorize"
                        : "Connect"}
                  </button>
                </form>
              </>
            )}
          </div>
        )}

        {/* Local app connect form (right panel) */}
        {tab === "local" && selectedLocalApp && (
          <div className="w-96 border-l border-border overflow-y-auto p-6">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <AppLogo src={selectedLocalApp.logo} className="w-8 h-8 rounded" />
                <h2 className="text-text text-base font-bold">{selectedLocalApp.name}</h2>
              </div>
              <button
                onClick={() => {
                  setSelectedLocalApp(null);
                  setDeviceAuth(null);
                  setDeviceAuthStatus(null);
                }}
                className="text-text-muted hover:text-text text-sm transition-colors"
              >
                Close
              </button>
            </div>

            <p className="text-text-muted text-sm mb-4">{selectedLocalApp.description}</p>

            <div className="text-text-dim text-xs mb-4">
              Auth: {selectedLocalApp.auth.types.join(", ")} · {selectedLocalApp.tools.length} tools
            </div>

            {defaultLocalAuthType(selectedLocalApp) === "oauth_device_code" && !deviceAuth && (
              <div className="bg-bg-hover border border-border rounded-lg p-3 mb-4 text-xs text-text-muted">
                Click <b>Connect</b> to get a short sign-in code, then authorize
                this connection with your OpenAI account.
              </div>
            )}

            {defaultLocalAuthType(selectedLocalApp) === "oauth2" && oauthClientResolved && (
              <div className="bg-bg-hover border border-border rounded-lg p-3 mb-4 text-xs text-text-muted">
                OAuth client already registered for this project. Click <b>Authorize</b>
                to open {selectedLocalApp.name} in a popup.
              </div>
            )}

            {defaultLocalAuthType(selectedLocalApp) === "oauth2" && !oauthClientResolved && (
              <div className="bg-bg-hover border border-border rounded-lg p-3 mb-4 text-xs text-text-muted space-y-2">
                <p>
                  <b>{selectedLocalApp.name} OAuth setup.</b> You need to register an OAuth
                  app on {selectedLocalApp.name}'s side first, then paste its client
                  ID and secret below.
                </p>
                {oauthCallbackURL && (
                  <p>
                    Use this redirect / callback URL when registering the OAuth app:
                    <br />
                    <code className="text-text inline-block mt-1 px-1.5 py-0.5 rounded bg-bg-card font-mono text-[10px] break-all">
                      {oauthCallbackURL}
                    </code>
                  </p>
                )}
                <p className="text-text-dim">
                  These credentials are saved encrypted on the connection — you only need
                  to enter them once per project.
                </p>
              </div>
            )}

            <form onSubmit={handleConnectLocal} className="space-y-4">
              <div>
                <label className="block text-text-muted text-sm mb-2">Connection Name</label>
                <input
                  value={connName}
                  onChange={(e) => setConnName(e.target.value)}
                  className="w-full bg-bg-input border border-border rounded-lg px-4 py-3 text-sm text-text focus:outline-none focus:border-accent"
                  required
                  disabled={!!deviceAuth}
                />
              </div>

              {deviceAuth && (
                <div className="space-y-3">
                  <div className="rounded-lg border border-border bg-bg-hover p-4">
                    <div className="text-xs uppercase text-text-muted mb-1">Code</div>
                    <div className="text-text text-2xl font-bold tracking-wide">{deviceAuth.auth.user_code}</div>
                  </div>
                  <a
                    href={deviceAuth.auth.verification_uri}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex text-sm text-accent hover:text-accent-hover"
                  >
                    Open sign-in page
                  </a>
                  <div className="text-sm text-text-muted">
                    {deviceAuthStatus?.status === "pending" ? "Waiting for authorization…" : deviceAuthStatus?.status}
                  </div>
                </div>
              )}

              {defaultLocalAuthType(selectedLocalApp) === "oauth2" && !oauthClientResolved && (
                <>
                  <div>
                    <label className="block text-text-muted text-sm mb-2">
                      OAuth Client ID
                    </label>
                    <input
                      value={oauthClientID}
                      onChange={(e) => setOAuthClientID(e.target.value)}
                      className="w-full bg-bg-input border border-border rounded-lg px-4 py-3 text-sm text-text font-mono focus:outline-none focus:border-accent"
                      placeholder="Iv1.abc123…"
                      autoComplete="off"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-text-muted text-sm mb-2">
                      OAuth Client Secret
                    </label>
                    <input
                      type="password"
                      value={oauthClientSecret}
                      onChange={(e) => setOAuthClientSecret(e.target.value)}
                      className="w-full bg-bg-input border border-border rounded-lg px-4 py-3 text-sm text-text font-mono focus:outline-none focus:border-accent"
                      placeholder="secret"
                      autoComplete="new-password"
                      required
                    />
                  </div>
                </>
              )}

              {defaultLocalAuthType(selectedLocalApp) !== "oauth2" &&
                defaultLocalAuthType(selectedLocalApp) !== "oauth_device_code" &&
                selectedLocalApp.auth.credential_fields?.map((field) => (
                  <div key={field.name}>
                    <label className="block text-text-muted text-sm mb-2">{field.label}</label>
                    {field.description && (
                      <p className="text-text-dim text-xs mb-1">{field.description}</p>
                    )}
                    <input
                      type={field.type === "text" ? "text" : "password"}
                      value={credentials[field.name] || ""}
                      onChange={(e) =>
                        setCredentials({ ...credentials, [field.name]: e.target.value })
                      }
                      className="w-full bg-bg-input border border-border rounded-lg px-4 py-3 text-sm text-text focus:outline-none focus:border-accent"
                      required={field.required !== false}
                    />
                  </div>
                ))}

              <label className="flex items-start gap-3 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={autoMCP}
                  onChange={(e) => setAutoMCP(e.target.checked)}
                  className="mt-1 h-4 w-4 rounded border-border bg-bg-input accent-accent"
                />
                <span className="text-sm text-text-muted">
                  Expose tools to agents
                  <span className="block text-xs text-text-dim mt-0.5">
                    When checked, an MCP server is auto-created so every agent in this project can call this integration's tools. Uncheck if the integration is only meant for an app (e.g. Social) and shouldn't be exposed agent-wide.
                  </span>
                </span>
              </label>

              {error && <div className="text-red text-sm">{error}</div>}

              <button
                type="submit"
                disabled={connecting || !!deviceAuth}
                className="w-full px-5 py-3 bg-accent text-bg rounded-lg font-bold text-sm hover:bg-accent-hover transition-colors disabled:opacity-50"
              >
                {connecting
                  ? "Connecting..."
                  : deviceAuth
                  ? "Waiting for authorization..."
                  : defaultLocalAuthType(selectedLocalApp) === "oauth2"
                    ? "Authorize"
                    : "Connect"}
              </button>
            </form>

            <div className="mt-6">
              <h3 className="text-text-muted text-sm font-bold mb-2">Available Tools</h3>
              <div className="space-y-2">
                {selectedLocalApp.tools.map((tool) => (
                  <div key={tool.name} className="border border-border rounded-lg px-3 py-2 bg-bg-hover">
                    <div className="flex items-center gap-2">
                      <span className="text-xs px-1.5 py-0.5 rounded bg-bg-card text-text-dim">
                        {tool.method}
                      </span>
                      <span className="text-text text-sm font-bold">{tool.name}</span>
                    </div>
                    <p className="text-text-muted text-xs mt-1">{tool.description}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      {/*
        SuiteConnect modal: opens from a suite card in the catalog grid.
        Always project-scoped output (one child connection per service ×
        project cell). The master credential is invisible plumbing.
      */}
      {activeSuite && (
        <SuiteConnect
          group={activeSuite}
          projectId={currentProject?.id}
          onClose={() => setActiveSuite(null)}
          onConnectionsChanged={() => {
            // Refresh the flat connections list after fan-out so the
            // new "service • project" rows show up immediately.
            integrations.connections(currentProject?.id).then(setConnections).catch(() => {});
          }}
        />
      )}

      <Modal open={!!pickerFor} onClose={() => !pickerBusy && setPickerFor(null)}>
        <div className="p-6 w-[620px] max-w-full space-y-3">
          <div>
            <h2 className="text-text text-base font-bold">
              Select tools — {pickerFor?.app_name || pickerFor?.app_slug}
            </h2>
            <p className="text-text-dim text-xs leading-snug mt-1">
              Pick which tools from this connection are exposed to your
              agents. Unchecked tools are filtered server-side on every
              call. Applies to the MCP server that was created for this
              integration.
            </p>
          </div>
          <div className="flex items-center gap-2 pt-1">
            <input
              value={pickerFilter}
              onChange={(e) => setPickerFilter(e.target.value)}
              placeholder="filter tools…"
              className="flex-1 bg-bg-input border border-border rounded-lg px-3 py-1.5 text-xs text-text focus:outline-none focus:border-accent"
            />
            <button
              type="button"
              onClick={() => setPickerSelected(new Set(pickerTools.map((t) => t.name)))}
              className="text-xs text-text-muted hover:text-text"
            >
              All
            </button>
            <button
              type="button"
              onClick={() => setPickerSelected(new Set())}
              className="text-xs text-text-muted hover:text-text"
            >
              None
            </button>
            <span className="text-xs text-text-dim">
              {pickerSelected.size}/{pickerTools.length}
            </span>
          </div>
          <div className="border border-border rounded-lg max-h-[360px] overflow-y-auto divide-y divide-border">
            {pickerLoading && (
              <div className="p-3 text-text-dim text-xs">Loading tools…</div>
            )}
            {!pickerLoading && pickerTools.length === 0 && (
              <div className="p-3 text-text-dim text-xs">
                No tools available for this connection.
              </div>
            )}
            {pickerTools
              .filter((t) => {
                const q = pickerFilter.trim().toLowerCase();
                if (!q) return true;
                return (
                  t.name.toLowerCase().includes(q) ||
                  (t.description || "").toLowerCase().includes(q)
                );
              })
              .map((t) => {
                const checked = pickerSelected.has(t.name);
                return (
                  <label
                    key={t.name}
                    className={`flex items-start gap-3 p-2.5 cursor-pointer hover:bg-bg-hover ${checked ? "bg-accent/5" : ""}`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => togglePickerTool(t.name)}
                      className="mt-1 accent-accent"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="text-text text-xs font-mono truncate">{t.name}</div>
                      {t.description && (
                        <div className="text-text-dim text-[11px] leading-snug truncate">
                          {t.description}
                        </div>
                      )}
                    </div>
                  </label>
                );
              })}
          </div>
          {pickerErr && <div className="text-red text-xs">{pickerErr}</div>}
          <div className="flex justify-end gap-3 pt-1">
            <button
              onClick={() => setPickerFor(null)}
              disabled={pickerBusy}
              className="px-4 py-2 border border-border rounded-lg text-sm text-text-muted hover:text-text"
            >
              Skip
            </button>
            <button
              onClick={submitPicker}
              disabled={pickerBusy || pickerLoading || pickerSelected.size === 0}
              className="px-4 py-2 bg-accent text-bg font-bold rounded-lg text-sm hover:bg-accent-hover disabled:opacity-50"
            >
              {pickerBusy ? "Saving…" : `Save (${pickerSelected.size}/${pickerTools.length})`}
            </button>
          </div>
        </div>
      </Modal>

      <Modal open={!!credsFor} onClose={closeCreds}>
        <div className="p-6 w-[560px] max-w-full space-y-3">
          <h2 className="text-text text-base font-bold">
            Credentials — {credsFor?.name}
          </h2>
          <p className="text-text-dim text-xs leading-snug">
            Stored values for the <span className="text-text">{credsFor?.app_name}</span> connection.
            Click the eye to reveal a value, or the copy button to copy it. Each
            reveal is logged on the server for audit. Don&apos;t share these — they grant the same
            access the connection itself does.
          </p>
          {credsBusy && <div className="text-text-dim text-xs">Loading…</div>}
          {credsErr && <div className="text-red text-xs">{credsErr}</div>}
          {credsData && Object.keys(credsData).length === 0 && !credsBusy && (
            <div className="text-text-dim text-xs">No credentials stored on this connection.</div>
          )}
          {credsData && Object.keys(credsData).length > 0 && (
            <div className="space-y-2">
              {Object.entries(credsData).map(([key, value]) => {
                const revealed = credsRevealed.has(key);
                const masked = value.length <= 4
                  ? "••••"
                  : "•".repeat(Math.max(8, value.length - 4)) + value.slice(-4);
                return (
                  <div key={key} className="rounded-lg border border-border bg-bg-card p-3">
                    <div className="mb-2 flex items-center justify-between gap-3">
                      <div className="min-w-0 truncate text-xs text-text-muted font-mono">{key}</div>
                      <div className="flex shrink-0 items-center gap-2">
                        <button
                          onClick={() => toggleCredReveal(key)}
                          className="px-2 py-1.5 border border-border rounded text-xs text-text-muted hover:text-text"
                          title={revealed ? "Hide" : "Reveal"}
                        >
                          {revealed ? "Hide" : "Reveal"}
                        </button>
                        <button
                          onClick={() => copyCred(key, value)}
                          className="px-2 py-1.5 border border-border rounded text-xs text-text-muted hover:text-text"
                          title="Copy to clipboard"
                        >
                          {credsCopied === key ? "Copied" : "Copy"}
                        </button>
                      </div>
                    </div>
                    <textarea
                      readOnly
                      value={revealed ? value : masked}
                      rows={revealed && value.length > 56 ? 3 : 1}
                      onFocus={(e) => e.currentTarget.select()}
                      className="block w-full resize-none overflow-hidden rounded border border-border bg-bg-input px-3 py-2 font-mono text-xs leading-relaxed text-text focus:border-accent focus:outline-none"
                    />
                  </div>
                );
              })}
            </div>
          )}
          <div className="flex justify-end pt-1">
            <button
              onClick={closeCreds}
              className="px-4 py-2 border border-border rounded-lg text-sm text-text-muted hover:text-text"
            >
              Close
            </button>
          </div>
        </div>
      </Modal>

      <Modal open={!!renameFor} onClose={() => !renameBusy && setRenameFor(null)}>
        <div className="p-6 w-[420px] max-w-full space-y-3">
          <h2 className="text-text text-base font-bold">Rename connection</h2>
          <p className="text-text-dim text-xs leading-snug">
            Only the display name changes. Credentials, project, and the
            app slug (<span className="text-text-muted">{renameFor?.app_name}</span>) stay the same.
          </p>
          <input
            value={renameText}
            onChange={(e) => setRenameText(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") submitRename(); }}
            autoFocus
            className="w-full bg-bg-input border border-border rounded-lg px-3 py-2 text-sm text-text focus:outline-none focus:border-accent"
          />
          {renameErr && <div className="text-red text-xs">{renameErr}</div>}
          <div className="flex justify-end gap-3 pt-1">
            <button
              onClick={() => setRenameFor(null)}
              disabled={renameBusy}
              className="px-4 py-2 border border-border rounded-lg text-sm text-text-muted hover:text-text"
            >
              Cancel
            </button>
            <button
              onClick={submitRename}
              disabled={renameBusy || !renameText.trim() || renameText.trim() === renameFor?.name}
              className="px-4 py-2 bg-accent text-bg font-bold rounded-lg text-sm hover:bg-accent-hover disabled:opacity-50"
            >
              {renameBusy ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      </Modal>

      <Modal open={!!inviteFor} onClose={() => { setInviteFor(null); setInviteLink(null); setInviteErr(""); }}>
        <div className="p-6 w-[560px] max-w-full space-y-3">
          <h2 className="text-text text-base font-bold">
            Invite link — {inviteFor?.name}
          </h2>
          <p className="text-text-dim text-xs leading-snug">
            Anyone with this link can submit new credentials for
            <span className="text-text"> {inviteFor?.app_name}</span>. The new
            credentials replace the existing ones on submit. Default TTL: 1 hour.
          </p>
          {inviteBusy && <div className="text-text-dim text-xs">Generating…</div>}
          {inviteErr && <div className="text-red text-xs">{inviteErr}</div>}
          {inviteLink && (
            <>
              <div className="flex gap-2">
                <input
                  readOnly
                  value={inviteLink.url}
                  onFocus={(e) => e.currentTarget.select()}
                  className="flex-1 bg-bg-input border border-border rounded-lg px-3 py-2 text-xs text-text font-mono focus:outline-none focus:border-accent"
                />
                <button
                  onClick={copyInvite}
                  className="px-3 py-2 border border-border rounded-lg text-xs text-text-muted hover:text-text"
                >
                  {copied ? "Copied" : "Copy"}
                </button>
              </div>
              <div className="text-text-dim text-[10px]">
                expires {new Date(inviteLink.expires_at).toLocaleString()}
              </div>
            </>
          )}
          <div className="flex justify-end pt-2">
            <button
              onClick={() => { setInviteFor(null); setInviteLink(null); setInviteErr(""); }}
              className="px-4 py-2 border border-border rounded-lg text-sm text-text-muted hover:text-text"
            >
              Close
            </button>
          </div>
        </div>
      </Modal>

      {/* Scope-flip confirmation. Mirrors the install scope-flip
          modal from v0.14.5. Same data-safety story explained
          inline so the operator doesn't need to dig for it:
          credentials, bindings, MCP allowed-tools, subscriptions
          all stay; only project_id and any auto-MCP project_id
          move. */}
      <Modal open={!!scopeFlipFor} onClose={() => !scopeFlipBusy && setScopeFlipFor(null)}>
        {scopeFlipFor && (() => {
          const wasGlobal = !scopeFlipFor.project_id;
          const target = wasGlobal ? (currentProject?.id ?? "") : "";
          const targetLabel = wasGlobal
            ? (currentProject?.name ?? "current project")
            : "global";
          const onConfirm = async () => {
            setScopeFlipBusy(true);
            setScopeFlipErr("");
            try {
              await integrations.setConnectionScope(scopeFlipFor.id, target);
              setScopeFlipFor(null);
              loadConnections();
            } catch (e: any) {
              setScopeFlipErr(e?.message || "scope change failed");
            } finally {
              setScopeFlipBusy(false);
            }
          };
          return (
            <div className="bg-bg border border-border rounded-lg shadow-xl max-w-md w-full p-5 space-y-3">
              <h3 className="text-text text-sm font-bold">
                Move {scopeFlipFor.name} to {targetLabel}?
              </h3>
              <div className="text-xs text-text-muted leading-relaxed space-y-2">
                <p>
                  {wasGlobal
                    ? "Binds this connection to the current project — it'll no longer be visible from other projects."
                    : "Makes this connection visible from every project. Any app install bound to it keeps working unchanged."}
                </p>
                <p>
                  Credentials, integration bindings, MCP allowed-tool
                  subsets, and subscriptions are preserved. Only the
                  connection's scope changes.
                </p>
              </div>
              {scopeFlipErr && <div className="text-red text-xs">{scopeFlipErr}</div>}
              <div className="flex gap-2 justify-end pt-1">
                <button
                  onClick={() => setScopeFlipFor(null)}
                  disabled={scopeFlipBusy}
                  className="px-3 py-1.5 text-xs border border-border rounded hover:bg-bg-hover disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  onClick={onConfirm}
                  disabled={scopeFlipBusy}
                  className="px-3 py-1.5 text-xs bg-accent text-bg rounded font-bold hover:opacity-80 disabled:opacity-50"
                >
                  {scopeFlipBusy ? "Moving…" : `Move to ${targetLabel}`}
                </button>
              </div>
            </div>
          );
        })()}
      </Modal>

      <IntegrationExplorerPanel
        open={!!explorerFor}
        connection={explorerFor}
        onClose={() => setExplorerFor(null)}
      />
    </div>
  );
}

// ConnectionTestBadge — inline pill rendered next to a Test button
// after a probe runs. Three visual states match the result shape:
//
//   ok=true  + skipped=true → neutral grey "no probe"
//   ok=true  + skipped=false → green "✓ <latency>ms"
//   ok=false                 → red "✗ <error>" with the upstream
//                              status / message in a tooltip so the
//                              row stays compact but the operator
//                              can read the full reason on hover.
function ConnectionTestBadge({ result }: { result: ConnectionTestResult }) {
  if (result.ok && result.skipped) {
    return (
      <span
        className="text-xs text-text-dim"
        title={result.reason || "no health check declared in the catalog for this app"}
      >
        no probe
      </span>
    );
  }
  if (result.ok) {
    // result.reason is set when the upstream returned 4xx but the
    // body matched a catalog-declared "auth still valid" pattern
    // (S3-compat: bucket-scoped tokens get 403 AccessDenied on
    // ListBuckets even when they're perfectly valid for the
    // operations they're scoped to). Surface the explanation in
    // the tooltip so the green tick is intelligible — the operator
    // shouldn't have to wonder why HTTP 403 reads as success.
    const status = result.status_code ?? 200;
    const tooltip = result.reason
      ? `HTTP ${status} · ${result.latency_ms}ms — ${result.reason}`
      : `HTTP ${status} · ${result.latency_ms}ms`;
    return (
      <span className="text-xs text-green" title={tooltip}>
        ✓ {result.latency_ms}ms
      </span>
    );
  }
  // Failure. Show "✗ HTTP 401" inline + full error in tooltip.
  const compact =
    result.status_code != null
      ? `✗ HTTP ${result.status_code}`
      : `✗ failed`;
  return (
    <span
      className="text-xs text-red max-w-[14rem] truncate"
      title={result.error || "test failed"}
    >
      {compact}
    </span>
  );
}
