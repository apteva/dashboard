import { useState, useEffect, useCallback } from "react";
import {
  integrations,
  providers,
  invites,
  mcpServers,
  type AppSummary,
  type AppDetail,
  type ConnectionInfo,
  type Provider,
  type ComposioApp,
  type ComposioToolkitDetails,
  type ConnectCreateResponse,
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
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState("");

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

  const localProvider = providerList.find((p) => p.name === "Apteva Local");
  const composioProvider = providerList.find((p) => p.name === "Composio");
  const hasLocal = !!localProvider;
  const hasComposio = !!composioProvider;

  const loadConnections = useCallback(() => {
    integrations.connections(currentProject?.id).then(setConnections).catch(() => {});
  }, [currentProject?.id]);

  const loadLocalApps = useCallback(() => {
    if (!hasLocal) return;
    // Ask the server to hide apps that are members of a credential
    // group; the suite list below renders one card per group instead.
    // Falls back silently on older servers that don't support group=1.
    integrations.catalog(localSearch, { collapseGroups: true }).then(setLocalApps).catch(() => {});
    // Suites come from a parallel endpoint so the cards can coexist
    // with the flat catalog grid.
    integrations.listGroups().then(setSuites).catch(() => setSuites([]));
  }, [localSearch, hasLocal]);

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

  // Default tab: prefer the first activated integration provider
  useEffect(() => {
    if (!loaded) return;
    if (!hasLocal && hasComposio) setTab("composio");
  }, [loaded, hasLocal, hasComposio]);

  // --- Local app interactions ---

  const selectLocalApp = async (slug: string) => {
    const app = await integrations.app(slug);
    setSelectedLocalApp(app);
    setCredentials({});
    // Suggest a default connection name. If the user already has one or
    // more connections for this app in the current project, append a
    // suffix so the unique-name server check doesn't immediately reject
    // the submit. The user can still edit the field before saving.
    const existing = (connections || []).filter(
      (c) => c.app_slug === slug && c.source === "local",
    );
    setConnName(existing.length === 0 ? app.name : `${app.name} ${existing.length + 1}`);
    setError("");
    setOAuthClientID("");
    setOAuthClientSecret("");
    setOAuthClientResolved(false);
    setOAuthCallbackURL("");

    // For OAuth2 apps, find out whether the user already registered an
    // OAuth client for this app+project. If yes, hide the form. If no,
    // we'll show two fields plus the callback URL helper.
    if (app.auth.types.includes("oauth2")) {
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
      const isOAuth2 = selectedLocalApp.auth.types.includes("oauth2");
      const oauthCreds = isOAuth2 && !oauthClientResolved
        ? { client_id: oauthClientID.trim(), client_secret: oauthClientSecret.trim() }
        : undefined;
      // Pin auth_type to "oauth2" when the app supports it, even if the
      // server's default-picker would also choose it. Templates that list
      // ["bearer", "oauth2"] could otherwise be routed to the non-OAuth
      // path (silent "connected" with empty creds) if the picker drifts.
      const explicitAuthType = isOAuth2 ? "oauth2" : undefined;
      const result = await integrations.connect(
        selectedLocalApp.slug,
        connName.trim(),
        credentials,
        explicitAuthType,
        currentProject?.id,
        oauthCreds,
      );
      // OAuth2 apps return { connection, redirect_url } — open the popup and
      // start polling the pending connection. Non-OAuth apps return the
      // connection object directly, fully active.
      if ("redirect_url" in (result as any)) {
        const r = result as ConnectCreateResponse;
        openOAuthPopup(r.redirect_url);
        pollConnection(r.connection.id);
      } else {
        loadConnections();
        // Non-OAuth path: response IS the connection (ConnectionInfo).
        // Open the tool picker immediately so the user can create the
        // first MCP for this integration.
        openPickerFor(result as unknown as ConnectionInfo);
      }
      setSelectedLocalApp(null);
      setCredentials({});
      setOAuthClientID("");
      setOAuthClientSecret("");
    } catch (err: any) {
      setError(err?.message || "Failed to connect");
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
        pollConnection(result.connection.id);
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

  const openOAuthPopup = (url: string) => {
    const w = 540;
    const h = 680;
    const left = window.screenX + (window.outerWidth - w) / 2;
    const top = window.screenY + (window.outerHeight - h) / 2;
    window.open(
      url,
      "apteva-oauth",
      `width=${w},height=${h},left=${left},top=${top},menubar=no,toolbar=no,location=no`,
    );
  };

  const pollConnection = (id: number) => {
    let attempts = 0;
    const tick = async () => {
      attempts += 1;
      try {
        const c = await integrations.get(id);
        if (c.status === "active") {
          loadConnections();
          // Connection finished OAuth — open the tool picker so the user
          // can pick which tools to expose as the first MCP for this
          // integration.
          openPickerFor(c as unknown as ConnectionInfo);
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

  const handleDisconnect = async (id: number) => {
    await integrations.disconnect(id);
    loadConnections();
  };

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

  // Neither integrations provider is activated — prompt user to pick one.
  if (!hasLocal && !hasComposio) {
    return (
      <div className="flex flex-col h-full">
        <div className="border-b border-border px-6 py-4">
          <h1 className="text-text text-lg font-bold">Integrations</h1>
        </div>
        <div className="flex-1 p-6">
          <div className="max-w-lg border border-border rounded-lg p-6 bg-bg-card">
            <h2 className="text-text text-base font-bold mb-2">No integration provider activated</h2>
            <p className="text-text-muted text-sm mb-4">
              Activate <b>Apteva Local</b> for 200+ baked-in connectors, or <b>Composio</b> for
              a hosted OAuth-managed catalog. You can enable both.
            </p>
            <button
              onClick={() => navigate("/settings")}
              className="px-5 py-2.5 bg-accent text-bg rounded-lg font-bold text-sm hover:bg-accent-hover transition-colors"
            >
              Go to Settings &gt; Providers
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="border-b border-border px-6 py-4">
        <h1 className="text-text text-lg font-bold">Integrations</h1>
        <p className="text-text-muted text-sm mt-1">
          Connect apps and services to your Apteva instances.
        </p>
      </div>

      {/* Source tabs */}
      <div className="border-b border-border px-6 flex gap-0">
        <button
          onClick={() => setTab("local")}
          disabled={!hasLocal}
          className={`px-5 py-3 text-sm transition-colors border-b-2 -mb-px ${
            tab === "local"
              ? "text-accent border-accent"
              : "text-text-muted border-transparent hover:text-text"
          } ${!hasLocal ? "opacity-50 cursor-not-allowed" : ""}`}
        >
          Apteva Local {!hasLocal && "· inactive"}
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
          {/* Active connections — shared across sources */}
          {connections && connections.length > 0 && (
            <section>
              <h2 className="text-text text-base font-bold mb-3">Connected ({connections.length})</h2>
              <div className="space-y-2">
                {connections.map((c) => (
                  <div
                    key={c.id}
                    className="border border-border rounded-lg p-4 bg-bg-card flex items-center justify-between"
                  >
                    <div className="flex items-center gap-3">
                      <span
                        className={`inline-block w-2.5 h-2.5 rounded-full ${
                          c.status === "active"
                            ? "bg-green"
                            : c.status === "pending"
                              ? "bg-warn"
                              : "bg-red"
                        }`}
                      />
                      <div>
                        {/*
                          Suite children: render as one continuous
                          headline ("OmniKit Messaging Alexa") so the
                          row matches the corresponding MCP server's
                          name. The external project id is technical
                          and lives in the title-tooltip rather than
                          a visible chip — it adds noise without
                          helping the operator pick a row.
                          Legacy single-app connections keep the
                          user-chosen name first, app kind as subtitle.
                        */}
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
                      {c.status === "pending" && (
                        <span className="text-xs text-warn">pending…</span>
                      )}
                    </div>
                    <div className="flex items-center gap-4">
                      {c.tool_count > 0 && (
                        <span className="text-text-dim text-sm">{c.tool_count} tools</span>
                      )}
                      <button
                        onClick={() => openRenameFor(c)}
                        className="text-sm text-text-muted hover:text-text transition-colors"
                        title="Rename"
                      >
                        Rename
                      </button>
                      <button
                        onClick={() => openInviteFor(c)}
                        className="text-sm text-text-muted hover:text-accent transition-colors"
                        title="Generate a shareable link to let someone else swap the credentials"
                      >
                        Invite
                      </button>
                      <button
                        onClick={() => handleDisconnect(c.id)}
                        className="text-sm text-text-muted hover:text-red transition-colors"
                      >
                        Disconnect
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Tab content */}
          {tab === "local" && hasLocal && (
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
                onClick={() => setSelectedLocalApp(null)}
                className="text-text-muted hover:text-text text-sm transition-colors"
              >
                Close
              </button>
            </div>

            <p className="text-text-muted text-sm mb-4">{selectedLocalApp.description}</p>

            <div className="text-text-dim text-xs mb-4">
              Auth: {selectedLocalApp.auth.types.join(", ")} · {selectedLocalApp.tools.length} tools
            </div>

            {selectedLocalApp.auth.types.includes("oauth2") && oauthClientResolved && (
              <div className="bg-bg-hover border border-border rounded-lg p-3 mb-4 text-xs text-text-muted">
                OAuth client already registered for this project. Click <b>Authorize</b>
                to open {selectedLocalApp.name} in a popup.
              </div>
            )}

            {selectedLocalApp.auth.types.includes("oauth2") && !oauthClientResolved && (
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
                />
              </div>

              {selectedLocalApp.auth.types.includes("oauth2") && !oauthClientResolved && (
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

              {!selectedLocalApp.auth.types.includes("oauth2") &&
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

              {error && <div className="text-red text-sm">{error}</div>}

              <button
                type="submit"
                disabled={connecting}
                className="w-full px-5 py-3 bg-accent text-bg rounded-lg font-bold text-sm hover:bg-accent-hover transition-colors disabled:opacity-50"
              >
                {connecting
                  ? "Connecting..."
                  : selectedLocalApp.auth.types.includes("oauth2")
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
    </div>
  );
}
