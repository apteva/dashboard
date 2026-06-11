import { type AppDetail } from "../../api";

// CredentialFields — auth-type-aware input renderer for an
// integration's credential form. Used by:
//   - The wizard's ConnectIntegrationModal (new, this PR)
//   - pages/Apps.tsx::InlineConnectIntegration (refactor in a
//     follow-up PR; today still inlines its own version)
//   - pages/Integrations.tsx (refactor in a follow-up; currently
//     has its own inline rendering)
//
// Responsibility:
//   - Read AppDetail.auth to figure out what credentials this app
//     wants (api_key, bearer, basic, oauth client_id/secret, ...)
//   - Render one labelled input per declared credential_field
//   - When the chosen auth_type is oauth2 AND the operator hasn't
//     pre-registered an OAuth app, render the client_id /
//     client_secret pair too — that's the local-OAuth2 hosted-by-
//     operator path that Integrations.tsx already handles inline
//
// Stays UI-only: doesn't fetch, doesn't submit. Parent owns the
// credential dict + the submit + the OAuth-popup orchestration.

export interface CredentialFieldsProps {
  detail: AppDetail;
  /** Currently picked auth type (e.g. "api_key", "oauth2", "basic").
   *  When undefined the renderer defaults to the first non-oauth2
   *  type the app supports (mirrors Integrations.tsx's picker). */
  authType?: string;
  credentials: Record<string, string>;
  setCredentials: (next: Record<string, string>) => void;
  /** OAuth-only: the operator's own OAuth app credentials. Only
   *  rendered when the picked auth_type is "oauth2" AND no
   *  resolvedOAuthClient flag tells us the server already has
   *  them on file for this app+project. */
  oauthClientID?: string;
  setOAuthClientID?: (v: string) => void;
  oauthClientSecret?: string;
  setOAuthClientSecret?: (v: string) => void;
  /** Server told us a saved OAuth app already exists for this
   *  app+project tuple. When true we hide the client_id/secret
   *  pair (no need to collect them again). */
  oauthClientResolved?: boolean;
}

export function CredentialFields({
  detail,
  authType,
  credentials,
  setCredentials,
  oauthClientID,
  setOAuthClientID,
  oauthClientSecret,
  setOAuthClientSecret,
  oauthClientResolved,
}: CredentialFieldsProps) {
  const types = detail.auth?.types || [];
  const picked =
    authType ||
    (types.includes("oauth2") && shouldPreferOAuth2(detail)
      ? "oauth2"
      : types.find((t) => t !== "oauth2") || types[0] || "api_key");
  const isOAuth2 = picked === "oauth2";
  const fields = detail.auth?.credential_fields || [];

  if (!isOAuth2 && fields.length === 0) {
    return (
      <div className="text-text-muted text-xs italic">
        {detail.name} doesn't declare any credential fields — it may not
        be connectable from the dashboard yet.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Local-OAuth2 client app — only when no saved client exists
          on the server side for this app+project. Operators paste
          their own client_id/secret once; subsequent connects to
          the same app reuse the saved pair and skip these two fields. */}
      {isOAuth2 && !oauthClientResolved && (
        <>
          <FieldRow
            label="OAuth client ID"
            description="From the OAuth app you registered with this provider."
          >
            <input
              type="text"
              value={oauthClientID ?? ""}
              onChange={(e) => setOAuthClientID?.((e.target as HTMLInputElement).value)}
              autoComplete="off"
              spellCheck={false}
              className="w-full bg-bg-input border border-border rounded-md px-3 py-2 text-sm font-mono text-text focus:outline-none focus:border-accent"
            />
          </FieldRow>
          <FieldRow
            label="OAuth client secret"
            description="Stored encrypted; reused on subsequent connects to this provider."
          >
            <input
              type="password"
              value={oauthClientSecret ?? ""}
              onChange={(e) => setOAuthClientSecret?.((e.target as HTMLInputElement).value)}
              autoComplete="off"
              spellCheck={false}
              className="w-full bg-bg-input border border-border rounded-md px-3 py-2 text-sm font-mono text-text focus:outline-none focus:border-accent"
            />
          </FieldRow>
        </>
      )}

      {/* Per-app credential fields (api keys, bearer tokens, basic
          auth username+password, etc.). Driven by the catalog
          definition so an app declaring three keys gets three rows. */}
      {!isOAuth2 && fields.map((f) => (
        <FieldRow key={f.name} label={f.label || f.name} description={f.description}>
          <input
            type="password"
            value={credentials[f.name] || ""}
            onChange={(e) =>
              setCredentials({ ...credentials, [f.name]: (e.target as HTMLInputElement).value })
            }
            autoComplete="off"
            spellCheck={false}
            className="w-full bg-bg-input border border-border rounded-md px-3 py-2 text-sm font-mono text-text focus:outline-none focus:border-accent"
          />
        </FieldRow>
      ))}
    </div>
  );
}

function shouldPreferOAuth2(detail: AppDetail): boolean {
  if (!detail.auth?.oauth2) return false;
  const fields = detail.auth?.credential_fields || [];
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

function FieldRow({
  label,
  description,
  children,
}: {
  label: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-text-muted text-xs">{label}</label>
      {children}
      {description && (
        <p className="text-text-dim text-[11px] leading-relaxed">{description}</p>
      )}
    </div>
  );
}
