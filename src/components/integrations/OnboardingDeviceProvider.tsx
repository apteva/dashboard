import { useCallback, useEffect, useRef, useState } from "react";
import { integrations, type ConnectionInfo, type DeviceAuthStart, type RuntimeCatalogEntry } from "../../api";
import { verifyOnboardingProvider } from "../../utils/onboarding";
import { DeviceCodeAuthPanel } from "./ConnectionReauthDialog";

// Uses the same connection and device-code endpoints as Settings. The parent
// advances onboarding only after authorization and provider verification finish.
export function OnboardingDeviceProvider({ entry, projectId, retryConnection, busy, onConnect }: {
  entry: RuntimeCatalogEntry;
  projectId: string;
  retryConnection: Pick<ConnectionInfo, "id" | "app_slug"> | null;
  busy: boolean;
  onConnect: (connect: () => Promise<void>) => void;
}) {
  const saved = useRef(retryConnection?.app_slug === entry.slug ? retryConnection : null);
  const [auth, setAuth] = useState<DeviceAuthStart | null>(null);
  const [starting, setStarting] = useState(false);
  const [authorized, setAuthorized] = useState(false);
  const [error, setError] = useState("");
  const inFlight = useRef(false);
  const generation = useRef(0);
  useEffect(() => () => { generation.current += 1; }, []);

  const finish = useCallback(() => {
    const connection = saved.current;
    if (!connection) return;
    setAuth(null);
    setAuthorized(true);
    setError("");
    onConnect(() => verifyOnboardingProvider(connection.id, entry.provider_key, projectId));
  }, [entry.provider_key, projectId, onConnect]);

  const fail = useCallback((message: string) => {
    setAuth(null);
    setError(message);
  }, []);

  const start = async () => {
    if (busy || inFlight.current) return;
    inFlight.current = true;
    setStarting(true);
    setError("");
    const current = generation.current;
    try {
      // Retry, reload, and a lost create response reuse the existing global
      // onboarding credential. Reauth preserves its scope and runtime settings.
      if (!saved.current) {
        const rows = await integrations.connections();
        if (current !== generation.current) return;
        saved.current = rows.find((row) => row.app_slug === entry.slug && row.name === entry.name && !row.project_id) || null;
      }
      const result = saved.current
        ? await integrations.reauth(saved.current.id)
        : await integrations.connect(entry.slug, entry.name, {}, "oauth_device_code", "", undefined, "integration", false);
      if (current !== generation.current) return;
      if (!("connection" in result)) throw new Error("The provider did not return a sign-in session. Please try again.");
      if (result.connection.app_slug !== entry.slug || (saved.current && result.connection.id !== saved.current.id)) {
        throw new Error("The sign-in session did not match this provider. Please try again.");
      }
      saved.current = { id: result.connection.id, app_slug: entry.slug };
      if (!result.device_auth) throw new Error("The provider did not return a sign-in code. Please try again.");
      setAuth(result.device_auth);
    } catch (caught) {
      if (current === generation.current) setError(caught instanceof Error ? caught.message : "Could not start sign-in. Please try again.");
    } finally {
      if (current === generation.current) {
        inFlight.current = false;
        setStarting(false);
      }
    }
  };

  return <div className="space-y-4">
    <p className="text-sm leading-6 text-text-muted">Sign in to {entry.name} in your browser. No API key needed.</p>
    {auth ? <DeviceCodeAuthPanel auth={auth} onConnected={finish} onError={fail} /> : <button
      type="button"
      disabled={busy || starting}
      onClick={() => authorized ? finish() : void start()}
      className="w-full rounded-lg bg-accent px-5 py-3 text-sm font-semibold text-bg disabled:opacity-40"
    >{busy ? "Checking your connection…" : starting ? "Starting sign-in…" : authorized ? "Continue with this provider" : `Sign in with ${entry.name}`}</button>}
    {error && <p role="alert" className="text-sm text-red">{error}</p>}
  </div>;
}
