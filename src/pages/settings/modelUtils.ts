import type { RuntimeConnection, RuntimeCatalogEntry } from "../../api";
export type HelperModelTier = "large" | "medium" | "small";
export type HelperModelMapping = Record<HelperModelTier, string>;

export const EMPTY_HELPER_MODELS: HelperModelMapping = { large: "", medium: "", small: "" };

// normalizeProviderName matches a provider name saved in an agent's
// config against the server's provider_key spelling. Only needed for
// strings that come out of stored config — connections arrive with
// provider_key already resolved by the catalog.
export function normalizeProviderName(raw: string): string {
  return raw.toLowerCase().trim().replace(/\s+/g, "-");
}

// primaryRuntimeConnections reduces the runtime connection list to one
// entry per provider. The server returns them in pool order (project
// scope, then is_primary, then id), so taking the first occurrence
// yields exactly the credential an agent will boot with — no client-side
// precedence logic, which is what runtimeProviderKey()/isTextProvider()
// used to reimplement.
export function primaryRuntimeConnections(
  connections: RuntimeConnection[],
): RuntimeConnection[] {
  const seen = new Set<string>();
  const out: RuntimeConnection[] = [];
  for (const connection of connections) {
    if (seen.has(connection.provider_key)) continue;
    seen.add(connection.provider_key);
    out.push(connection);
  }
  return out;
}

// groupRuntimeConnectionsByProvider buckets by provider AND scope. Primary
// selection is a database invariant within one (project, app) scope; mixing a
// project row with its global fallback creates two legitimately-checked radios
// and suggests that selecting global can override project precedence.
export function groupRuntimeConnectionsByProvider(
  connections: RuntimeConnection[],
): Array<[string, RuntimeConnection[]]> {
  const groups = new Map<string, RuntimeConnection[]>();
  for (const connection of connections) {
    const scopeKey = connection.project_id || "global";
    const key = `${connection.provider_key}:${scopeKey}`;
    const group = groups.get(key) || [];
    group.push(connection);
    groups.set(key, group);
  }
  return [...groups.entries()];
}

// availableRuntimeEntries is the catalog minus what is already
// connected, keyed on slug rather than provider_key so two catalog
// entries that map to the same runtime (an API key and a subscription,
// say) can both still be offered.
export function availableRuntimeEntries(
  catalog: RuntimeCatalogEntry[],
  connected: RuntimeConnection[],
  targetProjectID = "",
): RuntimeCatalogEntry[] {
  const connectedSlugs = new Set(
    connected
      .filter((connection) => connection.project_id === targetProjectID)
      .map((connection) => connection.app_slug),
  );
  return catalog.filter((entry) => !connectedSlugs.has(entry.slug));
}
