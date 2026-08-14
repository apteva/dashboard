import { useCallback, useEffect, useState } from "react";
import {
  integrations,
  type ConnectionInfo,
  type IntegrationURLPropertyStatus,
} from "../../api";

type Entry = {
  connection: ConnectionInfo;
  property: IntegrationURLPropertyStatus;
};

export function URLPropertiesPanel({ connections }: { connections: ConnectionInfo[] }) {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const local = connections.filter((c) => (c.source || "local") === "local" && c.status === "active");
    const results = await Promise.all(
      local.map(async (connection) => {
        try {
          const response = await integrations.urlProperties(connection.app_slug, connection.id);
          return response.properties.map((property) => ({ connection, property }));
        } catch {
          return [] as Entry[];
        }
      }),
    );
    setEntries(results.flat());
  }, [connections]);

  useEffect(() => {
    void load();
  }, [load]);

  if (entries.length === 0) return null;

  const run = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key);
    setError("");
    try {
      await fn();
      await load();
    } catch (err: any) {
      setError(err?.message || "Could not update provider URL delivery");
    } finally {
      setBusy("");
    }
  };

  return (
    <section>
      <div className="mb-3">
        <h3 className="text-text text-sm font-bold">Provider setup</h3>
        <p className="mt-1 text-xs leading-relaxed text-text-muted">
          Complete this once so {entries.length === 1 ? entries[0].connection.app_name : "the provider"} can securely fetch media from Apteva.
        </p>
      </div>
      {error && <div className="mb-3 rounded border border-red/40 bg-red/10 px-3 py-2 text-xs text-red">{error}</div>}
      <div className="space-y-3">
        {entries.map(({ connection, property }) => {
          const id = `${connection.id}:${property.definition.id}`;
          const state = property.state || {};
          const fileReady = !!state.verification_filename;
          const publicReady = state.hosting_status === "ready";
          const providerReady = !!state.operator_confirmed_at;
          return (
            <div key={id} className="rounded-lg border border-border bg-bg-card p-3.5">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="text-sm font-bold text-text">{property.definition.label}</div>
                  {property.definition.purpose && <p className="mt-1 text-xs leading-relaxed text-text-muted">{property.definition.purpose}</p>}
                </div>
                <span className={`shrink-0 rounded border px-2 py-1 text-[10px] font-bold uppercase ${property.ready ? "border-green/50 bg-green/10 text-green" : "border-warn/50 bg-warn/10 text-warn"}`}>
                  {property.ready ? "Ready" : "Setup required"}
                </span>
              </div>

              <div className="mt-3 rounded-md border border-border bg-bg-input p-3">
                <div className="text-[10px] font-bold uppercase tracking-wide text-text-dim">URL prefix</div>
                <div className="mt-1 break-all font-mono text-xs leading-relaxed text-text">{property.configured_prefix}</div>
              </div>

              <ol className="mt-3 space-y-2">
                <SetupStep number={1} complete={fileReady} title="Upload TikTok's verification file" detail={state.verification_filename || "Download the .txt file from TikTok first."} />
                <SetupStep number={2} complete={publicReady} title="Check the public URL" detail={publicReady ? "Apteva can serve the verification file." : "Confirm the file is publicly reachable."} />
                <SetupStep number={3} complete={providerReady} title={`Verify it with ${connection.app_name}`} detail={providerReady ? "Provider verification confirmed." : "Finish verification in the provider portal, then confirm here."} />
              </ol>

              <div className="mt-4 space-y-2">
                <label className="flex min-h-9 cursor-pointer items-center justify-center rounded-md border border-border px-3 py-2 text-xs font-medium text-text-muted transition-colors hover:border-accent hover:text-text">
                  {state.verification_filename ? "Replace verification file" : "Upload verification file"}
                  <input
                    type="file"
                    accept=".txt,text/plain"
                    className="hidden"
                    disabled={busy === id}
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      if (!file) return;
                      void run(id, async () => {
                        const text = await file.text();
                        await integrations.configureURLProperty(connection.app_slug, property.definition.id, connection.id, file.name, text);
                      });
                      event.currentTarget.value = "";
                    }}
                  />
                </label>
                <button
                  type="button"
                  disabled={!fileReady || busy === id}
                  onClick={() => void run(id, () => integrations.testURLProperty(connection.app_slug, property.definition.id, connection.id))}
                  className="min-h-9 w-full rounded-md border border-border px-3 py-2 text-xs font-medium text-text-muted transition-colors hover:border-accent hover:text-text disabled:opacity-40"
                >
                  {publicReady ? "Test public URL again" : "Test public URL"}
                </button>
                {property.definition.setup_url && (
                  <a className="flex min-h-9 items-center justify-center rounded-md border border-border px-3 py-2 text-xs font-medium text-text-muted transition-colors hover:border-accent hover:text-text" href={property.definition.setup_url} target="_blank" rel="noreferrer">
                    Open {connection.app_name} setup ↗
                  </a>
                )}
                <button
                  type="button"
                  disabled={!publicReady || providerReady || busy === id}
                  onClick={() => void run(id, () => integrations.confirmURLProperty(connection.app_slug, property.definition.id, connection.id))}
                  className="min-h-9 w-full rounded-md border border-accent bg-accent px-3 py-2 text-xs font-bold text-black transition-opacity disabled:opacity-40"
                >
                  {providerReady ? "Provider verified" : "Confirm provider verification"}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function SetupStep({ number, complete, title, detail }: { number: number; complete: boolean; title: string; detail: string }) {
  return (
    <li className="grid grid-cols-[24px_minmax(0,1fr)] gap-2.5">
      <span className={`flex h-6 w-6 items-center justify-center rounded-full border text-[10px] font-bold ${complete ? "border-green/40 bg-green/10 text-green" : "border-border bg-bg-input text-text-dim"}`}>
        {complete ? "✓" : number}
      </span>
      <div className="min-w-0 pt-0.5">
        <div className="text-xs font-medium text-text">{title}</div>
        <div className="mt-0.5 break-words text-[10px] leading-relaxed text-text-dim">{detail}</div>
      </div>
    </li>
  );
}
