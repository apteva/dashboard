import { useEffect, useMemo, useState } from "react";
import { integrations, type AppSummary, type ConnectionInfo } from "../../api";
import { Modal } from "../Modal";
import { IntegrationLogo } from "./IntegrationLogo";

export type IntegrationSuite = {
  id: string;
  name: string;
  logo?: string | null;
  description?: string;
  members: Array<{ slug: string; name: string; tool_count: number; logo?: string | null }>;
  has_account_scope: boolean;
  has_project_scope: boolean;
};

type Props = {
  connections: ConnectionInfo[];
  onClose: () => void;
  onSelectApp: (slug: string) => Promise<void>;
  onSelectSuite: (suite: IntegrationSuite) => void;
};

export function IntegrationCatalogModal({ connections, onClose, onSelectApp, onSelectSuite }: Props) {
  const [apps, setApps] = useState<AppSummary[]>([]);
  const [suites, setSuites] = useState<IntegrationSuite[]>([]);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectionError, setSelectionError] = useState("");
  const [selecting, setSelecting] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    Promise.all([integrations.catalog(undefined, { collapseGroups: true }), integrations.listGroups()])
      .then(([nextApps, nextSuites]) => {
        if (cancelled) return;
        setApps(nextApps || []);
        setSuites(nextSuites || []);
      })
      .catch(() => { if (!cancelled) setError("Couldn't load integrations. Please try again."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [retry]);

  // Catalog tags include over a thousand provider-specific keywords. Keep the
  // category menu short; every tag remains searchable through the text field.
  const categories = useMemo(() => {
    const present = new Set(apps.flatMap((app) => app.categories || []));
    return ["ai", "analytics", "audio", "automation", "cloud", "crm", "design", "developer-tools", "devops", "ecommerce", "email", "finance", "marketing", "payments", "productivity", "sales", "scraping", "social", "sports", "storage", "video"].filter((name) => present.has(name));
  }, [apps]);
  const items = useMemo(() => {
    const terms = search.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const matches = (text: string) => terms.every((term) => text.toLowerCase().includes(term));
    return [
      ...apps.filter((app) => (!category || app.categories?.includes(category)) && matches([app.name, app.slug, app.description, ...(app.categories || [])].join(" ")))
        .map((app) => ({ id: `app:${app.slug}`, name: app.name, description: app.description, logo: app.logo,
          detail: `${app.tool_count} tools`, count: connections.filter((c) => c.app_slug === app.slug).length,
          app, suite: null as IntegrationSuite | null })),
      ...suites.filter((suite) => !category && matches([suite.name, suite.description, ...suite.members.flatMap((m) => [m.name, m.slug])].join(" ")))
        .map((suite) => ({ id: `suite:${suite.id}`, name: suite.name, description: suite.description, logo: suite.logo,
          detail: `${suite.members.length} services · Suite`, count: connections.filter((c) => suite.members.some((m) => m.slug === c.app_slug)).length,
          app: null, suite })),
    ].sort((a, b) => {
      const query = search.trim().toLowerCase();
      const rank = (name: string) => {
        const text = name.toLowerCase();
        if (!query || text === query) return 0;
        if (text.startsWith(query)) return 1;
        if (text.includes(query)) return 2;
        if (terms.every((term) => text.includes(term))) return 3;
        return 4;
      };
      return rank(a.name) - rank(b.name) || a.name.localeCompare(b.name);
    });
  }, [apps, suites, search, category, connections]);

  const select = async (item: typeof items[number]) => {
    if (selecting) return;
    setSelectionError("");
    setSelecting(item.id);
    try {
      if (item.suite) onSelectSuite(item.suite);
      else if (item.app) await onSelectApp(item.app.slug);
    } catch {
      setSelectionError(`Couldn't open ${item.name}. Please try again.`);
    } finally { setSelecting(null); }
  };

  return (
    <Modal open onClose={onClose} width="max-w-5xl" ariaLabel="Add integration">
      <div className="shrink-0 border-b border-border p-4 sm:p-6 space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-text text-lg font-bold">Add integration</h2>
            <p className="text-text-muted text-sm mt-1">Find an app or service to connect.</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close integration catalog" className="text-text-muted hover:text-text p-2 -mr-2">✕</button>
        </div>
        <div className="flex flex-col sm:flex-row gap-3">
          <input autoFocus type="search" aria-label="Search integrations" placeholder="Search by name, service, or keyword…"
            value={search} onChange={(e) => setSearch(e.target.value)}
            className="min-w-0 flex-1 bg-bg-input border border-border rounded-lg px-4 py-3 text-base text-text focus:outline-none focus:border-accent" />
          <select aria-label="Integration category" value={category} onChange={(e) => setCategory(e.target.value)}
            className="sm:w-52 bg-bg-input border border-border rounded-lg px-3 py-3 text-sm text-text focus:outline-none focus:border-accent">
            <option value="">All categories</option>
            {categories.map((name) => <option key={name} value={name}>{({ ai: "AI", crm: "CRM", devops: "DevOps" } as Record<string, string>)[name] || name.replace(/[-_]/g, " ").replace(/^./, (letter) => letter.toUpperCase())}</option>)}
          </select>
        </div>
        {!loading && !error && <p className="text-text-dim text-xs" role="status">{items.length} integration{items.length === 1 ? "" : "s"}{search || category ? " found" : " available"}</p>}
        {selectionError && <p role="alert" className="text-red text-sm">{selectionError}</p>}
      </div>
      <div className="min-h-0 overflow-y-auto p-4 sm:p-6" style={{ minHeight: "min(24rem, 45dvh)" }}>
        {loading ? <p role="status" className="py-12 text-center text-text-muted text-sm">Loading integrations…</p>
          : error ? <div className="py-12 text-center space-y-3"><p role="alert" className="text-text-muted text-sm">{error}</p><button type="button" onClick={() => setRetry((n) => n + 1)} className="text-accent text-sm">Try again</button></div>
          : items.length === 0 ? <div className="py-12 text-center space-y-3"><p className="text-text font-bold">No integrations found</p><p className="text-text-muted text-sm">Try another keyword or category.</p>{(search || category) && <button type="button" onClick={() => { setSearch(""); setCategory(""); }} className="text-accent text-sm">Clear filters</button>}</div>
          : <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {items.map((item) => (
              <button key={item.id} type="button" disabled={selecting !== null} onClick={() => select(item)}
                aria-label={`Connect ${item.name}`} className="flex flex-col gap-3 border border-border rounded-lg p-4 text-left bg-bg-card hover:bg-bg-hover hover:border-accent focus-visible:outline focus-visible:outline-accent transition-colors disabled:opacity-50">
                <div className="flex items-center gap-3"><IntegrationLogo src={item.logo} name={item.name} /><span className="text-text text-sm font-bold">{item.name}</span></div>
                <p className="text-text-muted text-xs leading-relaxed line-clamp-2 flex-1">{item.description}</p>
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                  <span className="text-text-dim">{item.detail}</span>
                  {selecting === item.id ? <span className="text-accent">Opening…</span> : item.count > 0 ? <span className="text-green">{item.count === 1 ? "Connected" : `${item.count} connections`}</span> : <span className="text-accent">Connect →</span>}
                </div>
              </button>
            ))}
          </div>}
      </div>
    </Modal>
  );
}
