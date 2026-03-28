import { useState, useEffect } from "react";
import { integrations, providers, type AppSummary, type AppDetail, type ConnectionInfo, type Provider } from "../api";
import { useNavigate } from "react-router-dom";

export function Integrations() {
  const [search, setSearch] = useState("");
  const [apps, setApps] = useState<AppSummary[]>([]);
  const [connections, setConnections] = useState<ConnectionInfo[]>([]);
  const [selectedApp, setSelectedApp] = useState<AppDetail | null>(null);
  const [credentials, setCredentials] = useState<Record<string, string>>({});
  const [connName, setConnName] = useState("");
  const [error, setError] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [providerList, setProviderList] = useState<Provider[]>([]);
  const [loaded, setLoaded] = useState(false);
  const navigate = useNavigate();

  const isActivated = providerList.some((p) => p.name === "Apteva Local");

  const loadApps = () => integrations.catalog(search).then(setApps).catch(() => {});
  const loadConnections = () => integrations.connections().then(setConnections).catch(() => {});

  useEffect(() => {
    providers.list().then((p) => { setProviderList(p); setLoaded(true); }).catch(() => setLoaded(true));
    loadConnections();
  }, []);
  useEffect(() => { if (isActivated) loadApps(); }, [search, isActivated]);

  const selectApp = async (slug: string) => {
    const app = await integrations.app(slug);
    setSelectedApp(app);
    setCredentials({});
    setConnName(app.name);
    setError("");
  };

  const handleConnect = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedApp || !connName.trim()) return;
    setError("");
    setConnecting(true);
    try {
      await integrations.connect(selectedApp.slug, connName.trim(), credentials);
      setSelectedApp(null);
      setCredentials({});
      loadConnections();
    } catch (err: any) {
      setError(err.message || "Failed to connect");
    } finally {
      setConnecting(false);
    }
  };

  const handleDisconnect = async (id: number) => {
    await integrations.disconnect(id);
    loadConnections();
  };

  if (!loaded) return null;

  if (!isActivated) {
    return (
      <div className="flex flex-col h-full">
        <div className="border-b border-border px-6 py-4">
          <h1 className="text-text text-lg font-bold">Integrations</h1>
        </div>
        <div className="flex-1 p-6">
          <div className="max-w-lg border border-border rounded-lg p-6 bg-bg-card">
            <h2 className="text-text text-base font-bold mb-2">Activate Apteva Local</h2>
            <p className="text-text-muted text-sm mb-4">
              Enable the Apteva Local provider to access 200+ app integrations including
              GitHub, Slack, Stripe, Pushover, and more. Each integration provides tools
              that your Apteva instances can use.
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

      <div className="flex-1 flex min-h-0">
        {/* Left: Connections + Catalog */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Active connections */}
          {connections && connections.length > 0 && (
            <section>
              <h2 className="text-text text-base font-bold mb-3">
                Connected ({connections.length})
              </h2>
              <div className="space-y-2">
                {connections.map((c) => (
                  <div key={c.id} className="border border-border rounded-lg p-4 bg-bg-card flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <span className="inline-block w-2.5 h-2.5 rounded-full bg-green" />
                      <div>
                        <span className="text-text text-base font-bold">{c.name}</span>
                        <span className="text-text-muted text-sm ml-2">{c.app_name}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-4">
                      <span className="text-text-dim text-sm">{c.tool_count} tools</span>
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

          {/* Search */}
          <section>
            <h2 className="text-text text-base font-bold mb-3">App Catalog</h2>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full bg-bg-input border border-border rounded-lg px-4 py-3 text-base text-text focus:outline-none focus:border-accent mb-4"
              placeholder="Search apps..."
            />

            {/* App grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {(apps || []).map((app) => {
                const isConnected = (connections || []).some((c) => c.app_slug === app.slug);
                return (
                  <button
                    key={app.slug}
                    onClick={() => selectApp(app.slug)}
                    className={`border rounded-lg p-4 text-left transition-colors ${
                      isConnected
                        ? "border-green bg-bg-card"
                        : "border-border bg-bg-card hover:border-accent"
                    }`}
                  >
                    <div className="flex items-center gap-3 mb-2">
                      {app.logo && (
                        <img src={app.logo} alt="" className="w-6 h-6 rounded" />
                      )}
                      <div className="flex-1 min-w-0">
                        <span className="text-text text-sm font-bold">{app.name}</span>
                        {app.slug !== app.name.toLowerCase().replace(/\s+/g, "-") && (
                          <span className="text-text-dim text-xs ml-1.5">{app.slug}</span>
                        )}
                      </div>
                      {isConnected && (
                        <span className="text-green text-xs shrink-0">connected</span>
                      )}
                    </div>
                    <p className="text-text-muted text-xs leading-relaxed line-clamp-2">
                      {app.description}
                    </p>
                    <div className="flex items-center gap-2 mt-2">
                      <span className="text-text-dim text-xs">{app.tool_count} tools</span>
                      {(app.categories || []).slice(0, 2).map((cat) => (
                        <span key={cat} className="text-xs px-1.5 py-0.5 bg-bg-hover rounded text-text-muted">
                          {cat}
                        </span>
                      ))}
                    </div>
                  </button>
                );
              })}
            </div>

            {apps.length === 0 && (
              <p className="text-text-muted text-sm">No apps found.</p>
            )}
          </section>
        </div>

        {/* Right: App detail / connect form */}
        {selectedApp && (
          <div className="w-96 border-l border-border overflow-y-auto p-6">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                {selectedApp.logo && (
                  <img src={selectedApp.logo} alt="" className="w-8 h-8 rounded" />
                )}
                <h2 className="text-text text-base font-bold">{selectedApp.name}</h2>
              </div>
              <button
                onClick={() => setSelectedApp(null)}
                className="text-text-muted hover:text-text text-sm transition-colors"
              >
                Close
              </button>
            </div>

            <p className="text-text-muted text-sm mb-4">{selectedApp.description}</p>

            {/* Auth info */}
            <div className="text-text-dim text-xs mb-4">
              Auth: {selectedApp.auth.types.join(", ")} · {selectedApp.tools.length} tools
            </div>

            {/* Connect form */}
            <form onSubmit={handleConnect} className="space-y-4">
              <div>
                <label className="block text-text-muted text-sm mb-2">Connection Name</label>
                <input
                  value={connName}
                  onChange={(e) => setConnName(e.target.value)}
                  className="w-full bg-bg-input border border-border rounded-lg px-4 py-3 text-sm text-text focus:outline-none focus:border-accent"
                  required
                />
              </div>

              {selectedApp.auth.credential_fields?.map((field) => (
                <div key={field.name}>
                  <label className="block text-text-muted text-sm mb-2">{field.label}</label>
                  {field.description && (
                    <p className="text-text-dim text-xs mb-1">{field.description}</p>
                  )}
                  <input
                    type={field.type === "text" ? "text" : "password"}
                    value={credentials[field.name] || ""}
                    onChange={(e) => setCredentials({ ...credentials, [field.name]: e.target.value })}
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
                {connecting ? "Connecting..." : "Connect"}
              </button>
            </form>

            {/* Tools list */}
            <div className="mt-6">
              <h3 className="text-text-muted text-sm font-bold mb-2">Available Tools</h3>
              <div className="space-y-2">
                {selectedApp.tools.map((tool) => (
                  <div key={tool.name} className="border border-border rounded-lg px-3 py-2 bg-bg-hover">
                    <div className="flex items-center gap-2">
                      <span className="text-xs px-1.5 py-0.5 rounded bg-bg-card text-text-dim">{tool.method}</span>
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
    </div>
  );
}
