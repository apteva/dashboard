import { useEffect, useState } from "react";
import {
  integrations,
  type AppDetail,
  type ConnectCreateResponse,
  type ConnectionInfo,
} from "../../api";
import { Modal } from "../Modal";
import { CredentialFields } from "./CredentialFields";
import { openOAuthPopup, pollConnection } from "./connectFlow";

// ConnectIntegrationModal — one-stop modal for connecting an
// integration. Opened with a single app slug; handles both
// non-OAuth (api_key, bearer, basic — credentials → POST →
// active connection in one round-trip) and local OAuth2 (POST
// returns a redirect_url, modal opens popup + polls for the
// connection to flip to active).
//
// Used from the wizard's Setup step today; pages/Integrations.tsx
// will switch to it in a follow-up PR (today still has its own
// inline flow for the Composio + group-suite paths the modal
// deliberately doesn't try to cover).
//
// Closed states:
//   - User cancel → onCancel() — no connection made
//   - Non-OAuth success → onConnected(connection) — modal closes
//     synchronously, connection is already 'active'
//   - OAuth success → onConnected(connection) once poll flips to
//     'active'. The popup may have already closed (auto-close on
//     callback) or may need manual close — either way the modal
//     reads the connection status, not the window state.
//   - OAuth failure / timeout → error shown in-modal, operator
//     can retry or cancel
//
// autoMCP defaults to true since every caller so far wants the
// connection's tools exposed to agents (least-privilege on the
// PICK side is the wizard's Setup step itself; per-tool
// least-privilege is a post-create concern).

export interface ConnectIntegrationModalProps {
  open: boolean;
  /** App slug to connect (e.g. "slack", "stripe", "linear"). */
  slug: string;
  /** Project to scope the connection to. Empty string → global. */
  projectId?: string;
  /** Fired once on a successful connect — `connection.status` will
   *  be 'active' before this fires. Caller should refetch its
   *  connections list. */
  onConnected: (connection: ConnectionInfo) => void;
  /** Fired when the operator dismisses the modal without
   *  connecting. */
  onCancel: () => void;
  /** Expose the connection's tools as an MCP server to agents.
   *  Defaults to true — see comment above. */
  autoMCP?: boolean;
}

export function ConnectIntegrationModal({
  open,
  slug,
  projectId,
  onConnected,
  onCancel,
  autoMCP = true,
}: ConnectIntegrationModalProps) {
  const [detail, setDetail] = useState<AppDetail | null>(null);
  const [loadError, setLoadError] = useState("");
  const [name, setName] = useState("");
  const [credentials, setCredentials] = useState<Record<string, string>>({});
  const [oauthClientID, setOAuthClientID] = useState("");
  const [oauthClientSecret, setOAuthClientSecret] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  // pollState: "" idle, "waiting" popup open + polling,
  // "timeout" gave up waiting. active/failed terminal states
  // route through onConnected / submitError.
  const [pollState, setPollState] = useState<"" | "waiting" | "timeout">("");

  // Reset everything on open + slug change.
  useEffect(() => {
    if (!open) return;
    setDetail(null);
    setLoadError("");
    setName("");
    setCredentials({});
    setOAuthClientID("");
    setOAuthClientSecret("");
    setSubmitting(false);
    setSubmitError("");
    setPollState("");
    integrations
      .app(slug)
      .then((d) => {
        setDetail(d);
        if (!name) setName(d.name);
      })
      .catch((e) => setLoadError(e?.message || "Failed to load integration details"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, slug]);

  const isOAuth2 = !!detail && (detail.auth?.types || []).includes("oauth2");
  const onlyOAuth2 =
    !!detail && (detail.auth?.types || []).every((t) => t === "oauth2");
  // Pick the auth_type to send on the wire. For apps that support both
  // OAuth and a real API key, keep the non-OAuth default. If the only
  // non-OAuth fields are OAuth token internals, prefer the OAuth flow.
  const authType = onlyOAuth2 || shouldPreferOAuth2(detail)
    ? "oauth2"
    : (detail?.auth?.types || []).find((t) => t !== "oauth2") || "api_key";
  const usingOAuthPath = authType === "oauth2";

  const submit = async () => {
    if (!detail) return;
    setSubmitting(true);
    setSubmitError("");
    try {
      const oauthCreds =
        usingOAuthPath && (oauthClientID || oauthClientSecret)
          ? { client_id: oauthClientID.trim(), client_secret: oauthClientSecret.trim() }
          : undefined;
      const result = await integrations.connect(
        detail.slug,
        name.trim() || detail.name,
        credentials,
        authType,
        projectId,
        oauthCreds,
        "integration",
        autoMCP,
      );
      // OAuth: server returned a redirect_url — pop it and poll.
      if (result && typeof result === "object" && "redirect_url" in result) {
        const r = result as ConnectCreateResponse;
        const popup = openOAuthPopup(r.redirect_url);
        if (!popup) {
          setSubmitError(
            "Couldn't open the OAuth popup — your browser blocked it. Allow popups for this site and try again.",
          );
          setSubmitting(false);
          return;
        }
        setPollState("waiting");
        pollConnection(r.connection.id, {
          onUpdate: () => {
            // No per-tick UI — the "Waiting for OAuth…" copy
            // doesn't need a counter for the operator to know
            // something's happening.
          },
          onDone: async (outcome) => {
            if (outcome.status === "active") {
              const fresh = await integrations.get(r.connection.id).catch(() => r.connection);
              onConnected(fresh);
            } else if (outcome.status === "failed") {
              setSubmitError(
                "The OAuth flow failed. Check the popup for an error message, then try again.",
              );
              setSubmitting(false);
              setPollState("");
            } else {
              setSubmitError(
                "OAuth didn't complete within 3 minutes. Close the popup and retry, or finish the flow on the Integrations page.",
              );
              setSubmitting(false);
              setPollState("timeout");
            }
          },
        });
        return;
      }
      // Non-OAuth: result IS the active connection.
      onConnected(result as ConnectionInfo);
    } catch (e: any) {
      // Server returns 400 with a JSON body when credentials fail
      // the catalog's health_check probe. Surface the parsed
      // message rather than the raw JSON. e?.message is already
      // the parsed copy in this codebase's request() wrapper.
      setSubmitError(e?.message || "Connect failed");
      setSubmitting(false);
    }
  };

  return (
    <Modal open={open} onClose={submitting ? () => {} : onCancel} width="max-w-md">
      <div className="p-5 flex flex-col gap-4">
        <div>
          <h3 className="text-text text-base font-bold">
            Connect {detail?.name || slug}
          </h3>
          <p className="text-text-muted text-xs mt-1">
            Credentials are encrypted server-side and never sent to app processes. The agent will reach this integration through the MCP gateway.
          </p>
        </div>

        {loadError && (
          <div className="text-red text-sm border-l-2 border-red pl-3">{loadError}</div>
        )}

        {!detail && !loadError && (
          <div className="text-text-muted text-sm">Loading {slug}…</div>
        )}

        {detail && (
          <>
            <div className="flex flex-col gap-1">
              <label className="text-text-muted text-xs">Connection name</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName((e.target as HTMLInputElement).value)}
                placeholder={detail.name}
                autoComplete="off"
                className="w-full bg-bg-input border border-border rounded-md px-3 py-2 text-sm text-text focus:outline-none focus:border-accent"
              />
            </div>

            <CredentialFields
              detail={detail}
              authType={authType}
              credentials={credentials}
              setCredentials={setCredentials}
              oauthClientID={oauthClientID}
              setOAuthClientID={setOAuthClientID}
              oauthClientSecret={oauthClientSecret}
              setOAuthClientSecret={setOAuthClientSecret}
              // PR-1 doesn't pre-check the saved-OAuth-app cache.
              // Always render the client_id/secret pair on OAuth
              // paths; server reuses them if it already has a
              // matching set. PR-2 can call a lookup first to
              // skip the form when an app+project is already
              // registered.
              oauthClientResolved={false}
            />

            {pollState === "waiting" && (
              <div className="bg-accent/10 border border-accent/40 rounded-md px-3 py-2 text-sm text-accent flex items-center gap-2">
                <span className="inline-block w-2 h-2 rounded-full bg-accent animate-pulse" />
                Waiting for OAuth approval… complete the flow in the popup.
              </div>
            )}

            {submitError && (
              <div className="text-red text-sm border-l-2 border-red pl-3 whitespace-pre-wrap">
                {submitError}
              </div>
            )}

            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                onClick={onCancel}
                disabled={submitting}
                className="px-3 py-1.5 text-sm text-text-muted hover:text-text disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={submit}
                disabled={submitting || !detail}
                className="px-4 py-1.5 bg-accent text-bg rounded-md font-bold text-sm hover:bg-accent-hover transition-colors disabled:opacity-50"
              >
                {submitting
                  ? usingOAuthPath
                    ? "Opening OAuth…"
                    : "Connecting…"
                  : usingOAuthPath
                    ? `Connect via OAuth`
                    : `Connect ${detail.name}`}
              </button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}

function shouldPreferOAuth2(detail: AppDetail | null): boolean {
  if (!detail?.auth?.types?.includes("oauth2") || !detail.auth.oauth2) return false;
  const fields = detail.auth.credential_fields || [];
  if (fields.length === 0) return true;
  const tokenFieldNames = new Set([
    "token",
    "accesstoken",
    "access_token",
    "refresh_token",
    "refreshtoken",
    "expires_in",
    "expiresin",
    "token_type",
    "tokentype",
    "scope",
  ]);
  return fields.every((field) =>
    tokenFieldNames.has(String(field.name || "").toLowerCase())
  );
}
