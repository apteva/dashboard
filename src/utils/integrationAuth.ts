import type { AppDetail, CredentialField } from "../api";

const legacyOAuthTokenFields = new Set([
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

export function shouldPreferOAuth2(detail: AppDetail | null | undefined): boolean {
  if (!detail?.auth?.types?.includes("oauth2") || !detail.auth.oauth2) return false;
  const fields = detail.auth.credential_fields || [];
  if (fields.length === 0) return true;

  // Explicit source metadata removes the old ambiguity: user-supplied
  // supplemental fields belong to the OAuth setup and generated fields do
  // not become form inputs. Legacy templates retain the token-name heuristic.
  if (fields.every((field) => field.source === "user" || field.source === "oauth")) {
    return true;
  }
  return fields.every((field) =>
    legacyOAuthTokenFields.has(String(field.name || "").toLowerCase()),
  );
}

export function defaultIntegrationAuthType(
  detail: AppDetail | null | undefined,
): string {
  const types = detail?.auth?.types || [];
  if (types.includes("oauth_device_code")) return "oauth_device_code";
  if (types.includes("oauth2") && shouldPreferOAuth2(detail)) return "oauth2";
  return types.find((type) => type !== "oauth2") || types[0] || "";
}

export function visibleCredentialFields(
  detail: AppDetail | null | undefined,
  authType: string,
): CredentialField[] {
  const fields = detail?.auth?.credential_fields || [];
  if (authType === "oauth2") {
    return fields.filter((field) => field.source === "user" && !field.hidden);
  }
  return fields.filter((field) => field.source !== "oauth" && !field.hidden);
}
