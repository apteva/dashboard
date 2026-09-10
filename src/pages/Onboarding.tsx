import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { auth, integrations, runtimeEntryAsAppDetail, type ConnectionInfo, type InterfaceLevel, type RuntimeCatalogEntry } from "../api";
import { CredentialFields } from "../components/integrations/CredentialFields";
import { defaultIntegrationAuthType } from "../utils/integrationAuth";
import { prepareOnboardingConversation, onboardingProviderConnection, verifyOnboardingConnection, replaceOnboardingCredentials } from "../utils/onboarding";
import { useAuth } from "../hooks/useAuth";
import { useAudience } from "../hooks/useAudience";
import { usePageTitle } from "../hooks/usePageTitle";

export const ONBOARDING_STEP_IDS = ["usage", "provider"] as const;
type SetupStatus = Awaited<ReturnType<typeof auth.onboardingStatus>>;

export function isTypeableRuntimeEntry(entry: RuntimeCatalogEntry): boolean {
  if (!entry.credential_fields?.length) return false;
  const type = defaultIntegrationAuthType(runtimeEntryAsAppDetail(entry));
  return type !== "oauth2" && type !== "oauth1" && type !== "oauth_device_code";
}

export function Onboarding() {
  usePageTitle("Welcome");
  const { user, refresh } = useAuth();
  const { setAudience } = useAudience();
  const navigate = useNavigate();
  const [step, setStep] = useState<"usage" | "provider">("usage");
  const [choice, setChoice] = useState<InterfaceLevel | null>(null);
  const [status, setStatus] = useState<SetupStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [retryConnection, setRetryConnection] = useState<Pick<ConnectionInfo, "id" | "app_slug"> | null>(null);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");
  const destination = useRef("/");
  const inFlight = useRef(false);

  useEffect(() => {
    if (user && user.onboarded && !busy) navigate(destination.current, { replace: true });
  }, [user, busy, navigate]);

  const finish = async (next: SetupStatus, selected: InterfaceLevel) => {
    if (!user) throw new Error("Please sign in again.");
    setProgress("Opening your conversation…");
    destination.current = selected === "developer" ? "/agents/new" : await prepareOnboardingConversation(user.id, next.project_id, selected, next.starter_agent_id);
    await auth.completeOnboarding();
    await refresh();
    window.dispatchEvent(new Event("apteva:agents-changed"));
    navigate(destination.current, { replace: true });
  };

  const run = async (action: () => Promise<void>) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError("");
    try { await action(); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Could not finish setup. Please try again."); }
    finally { inFlight.current = false; setBusy(false); }
  };

  const verifyExistingProvider = async (next: SetupStatus) => {
    if (!next.provider_configured) return;
    try {
      const connection = await onboardingProviderConnection(next.project_id);
      if (connection) {
        setRetryConnection(connection);
        await verifyOnboardingConnection(connection.id);
      }
      setRetryConnection(null);
    } catch (error) {
      setStatus({ ...next, provider_configured: false });
      setStep("provider");
      throw error;
    }
  };

  const choose = (selected = choice) => {
    if (!selected) return;
    setChoice(selected);
    void run(async () => {
      setProgress("Preparing your workspace…");
      await setAudience(selected);
      const next = await auth.onboardingStatus();
      setStatus(next);
      if (next.provider_configured) {
        if (selected !== "developer") await verifyExistingProvider(next);
        await finish(next, selected);
      }
      else setStep("provider");
    });
  };

  const checkAndFinish = async () => {
    const next = await auth.onboardingStatus();
    setStatus(next);
    if (!next.provider_configured) throw new Error("AI access is not connected yet. Please connect a provider to continue.");
    await verifyExistingProvider(next);
    await finish(next, choice!);
  };

  return <main className="min-h-screen bg-bg px-6 py-12 flex items-center justify-center">
    <div className="w-full max-w-xl">
      <p className="mb-3 text-xs font-medium uppercase tracking-wide text-text-muted">Welcome to Apteva</p>
      {step === "usage" ? <>
        <h1 className="text-3xl font-semibold text-text">How will you use Apteva?</h1>
        <p className="mt-3 text-sm leading-6 text-text-muted">Choose a starting point. You can change this later.</p>
        <div className="mt-8 grid gap-3 sm:grid-cols-2">
          {(["personal", "business"] as const).map((value) => <button key={value} disabled={busy} aria-pressed={choice === value} onClick={() => setChoice(value)} className={`rounded-xl border p-5 text-left disabled:opacity-60 ${choice === value ? "border-accent bg-accent/5" : "border-border bg-bg-card hover:border-accent/50"}`}>
            <span className="block text-base font-semibold text-text">{value === "personal" ? "For myself" : "For my business"}</span>
            <span className="mt-2 block text-sm leading-6 text-text-muted">{value === "personal" ? "An assistant for everyday tasks and personal projects." : "An assistant to help with your business tasks."}</span>
          </button>)}
        </div>
        <button disabled={!choice || busy} onClick={() => choose()} className="mt-6 w-full rounded-lg bg-accent px-5 py-3 text-sm font-semibold text-bg disabled:opacity-40">{busy ? progress : "Continue"}</button>
        <button disabled={busy} onClick={() => choose("developer")} className="mt-4 text-xs text-text-muted underline underline-offset-4 disabled:opacity-40">Developer setup</button>
      </> : <>
        <button disabled={busy} onClick={() => { setStep("usage"); setError(""); }} className="mb-5 text-sm text-text-muted disabled:opacity-40">← Back</button>
        <h1 className="text-3xl font-semibold text-text">Connect your AI</h1>
        <p className="mt-3 text-sm leading-6 text-text-muted">Connect a model so your assistant can help in your first conversation.</p>
        {status?.provider_configured ? <div className="mt-6">
          <p className="text-sm text-text-muted">Your AI connection is ready.</p>
          <button disabled={busy} onClick={() => void run(checkAndFinish)} className="mt-5 rounded-lg bg-accent px-5 py-3 text-sm font-semibold text-bg disabled:opacity-40">{busy ? progress : "Open my conversation"}</button>
        </div> : status?.can_manage_provider ? <ProviderStep key={retryConnection?.id || "new"} busy={busy} projectId={status.project_id} retryConnection={retryConnection} onConnect={(connect) => void run(async () => {
          setProgress("Checking your connection…");
          await connect();
          await checkAndFinish();
        })} /> : <div className="mt-6 rounded-xl border border-border bg-bg-card p-5">
          <p className="text-sm leading-6 text-text-muted">Your workspace administrator needs to connect AI. Once they do, you can continue here without adding your own key.</p>
          <button disabled={busy} onClick={() => void run(checkAndFinish)} className="mt-4 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-bg disabled:opacity-40">{busy ? progress : "Check again"}</button>
        </div>}
        {choice === "developer" && <button disabled={busy} onClick={() => void run(async () => finish(status!, "developer"))} className="mt-5 text-xs text-text-muted underline">Set up AI later</button>}
      </>}
      {error && <p role="alert" className="mt-5 text-sm text-red">{error}</p>}
      {busy && <p role="status" className="mt-4 text-sm text-text-muted">{progress}</p>}
    </div>
  </main>;
}

function ProviderStep({ busy, projectId, retryConnection, onConnect }: { busy: boolean; projectId: string; retryConnection: Pick<ConnectionInfo, "id" | "app_slug"> | null; onConnect: (connect: () => Promise<void>) => void }) {
  const [entries, setEntries] = useState<RuntimeCatalogEntry[]>([]);
  const [selected, setSelected] = useState<RuntimeCatalogEntry | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const savedConnection = useRef<Pick<ConnectionInfo, "id" | "app_slug"> | null>(retryConnection);
  const credentialsDirty = useRef(false);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setLoadError("");
    integrations.runtimeCatalog("llm").then((all) => {
      if (!active) return;
      const available = all.filter(isTypeableRuntimeEntry);
      setEntries(available);
      const initial = available.find((entry) => entry.slug === retryConnection?.app_slug) || available.find((entry) => entry.slug === "openai-api") || available[0] || null;
      // An expired OAuth connection may not be repairable in this key form.
      // Never apply another provider's credentials to that connection.
      if (savedConnection.current?.app_slug !== initial?.slug) savedConnection.current = null;
      setSelected(initial);
    }).catch(() => { if (active) setLoadError("Could not load connection options. Please try again."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [attempt, retryConnection?.id]);

  const connect = async () => {
    if (!selected) throw new Error("Choose a provider.");
    const credentials: Record<string, string> = {};
    for (const field of selected.credential_fields || []) {
      const value = (fields[field.name] || field.default || "").trim();
      if (field.required && !value) throw new Error(`Enter ${field.label || field.name}.`);
      if (value) credentials[field.name] = value;
    }
    if (!Object.keys(credentials).length) throw new Error("Enter your provider key.");
    if (!savedConnection.current) {
      // Reuse an earlier saved attempt after Back, reload, provider switching,
      // or a lost create response, without fetching its secret credentials.
      const rows = await integrations.connections();
      savedConnection.current = rows.find((row) => row.app_slug === selected.slug && row.name === selected.name && !row.project_id) || null;
      if (savedConnection.current) credentialsDirty.current = true;
    }
    if (savedConnection.current) {
      if (credentialsDirty.current) {
        await replaceOnboardingCredentials(savedConnection.current, credentials);
        credentialsDirty.current = false;
      }
    } else {
      const result = await integrations.connect(selected.slug, selected.name, credentials, defaultIntegrationAuthType(runtimeEntryAsAppDetail(selected)) || "api_key", "", undefined, "integration", false);
      const id = "connection" in result ? result.connection.id : result.id;
      savedConnection.current = { id, app_slug: selected.slug };
      credentialsDirty.current = false;
    }
    await verifyOnboardingConnection(savedConnection.current.id);
    // A failed previous provider can still be the deterministic pool default.
    // Use the verified choice for new agents in this onboarding workspace.
    const preference = await integrations.newAgentProvider(projectId);
    if (preference.effective_provider !== selected.provider_key) {
      await integrations.setNewAgentProvider(selected.provider_key, projectId);
    }
  };

  if (loading) return <p role="status" className="mt-6 text-sm text-text-muted">Loading connection options…</p>;
  if (loadError || !selected) return <div className="mt-6"><p role="alert" className="text-sm text-red">{loadError || "No connection options are available. Please contact your administrator."}</p><button disabled={busy} onClick={() => setAttempt(attempt + 1)} className="mt-3 text-sm text-accent">Try again</button></div>;
  return <fieldset disabled={busy} className="mt-7 min-w-0 space-y-5">
    <div className="rounded-xl border border-border bg-bg-card p-5 space-y-4">
      <h2 className="text-base font-semibold text-text">{selected.name}</h2>
      <CredentialFields detail={runtimeEntryAsAppDetail(selected)} credentials={fields} setCredentials={(next) => { setFields(next); credentialsDirty.current = true; }} />
      {entries.length > 1 && <details className="text-sm text-text-muted"><summary className="cursor-pointer">Use another provider</summary><label className="mt-3 block">Provider<select value={selected.slug} onChange={(event) => { setSelected(entries.find((entry) => entry.slug === event.target.value) || null); setFields({}); savedConnection.current = null; credentialsDirty.current = false; }} className="mt-2 block w-full rounded-lg border border-border bg-bg-input px-3 py-2 text-text">{entries.map((entry) => <option key={entry.slug} value={entry.slug}>{entry.name}</option>)}</select></label></details>}
    </div>
    <button onClick={() => onConnect(connect)} className="w-full rounded-lg bg-accent px-5 py-3 text-sm font-semibold text-bg disabled:opacity-40">{busy ? "Connecting…" : "Connect and get started"}</button>
    <p className="text-xs leading-5 text-text-muted">Your provider may charge for AI usage. You can manage this connection later in Settings.</p>
  </fieldset>;
}
