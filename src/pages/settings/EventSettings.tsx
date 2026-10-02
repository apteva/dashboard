import { useState, useEffect } from "react";

import { integrations, subscriptions, instances as instancesAPI, apps as appsAPI, type SubscriptionInfo, type Agent, type AppRow } from "../../api";

import { Modal } from "../../components/Modal";

import { useProjects } from "../../hooks/useProjects";

import { serializeSubscriptionFilters, type SubscriptionFilterDraft } from "../../subscriptionFilters";

export function SubscriptionsTab() {
  const { currentProject } = useProjects();
  const [subs, setSubs] = useState<SubscriptionInfo[]>([]);
  const safeSubs = subs || [];
  const [connections, setConnections] = useState<any[]>([]);
  const [catalog, setCatalog] = useState<Record<string, any>>({});
  const [instanceList, setInstanceList] = useState<Agent[]>([]);
  // Unified add flow:
  //   pickerOpen=true, adding=null  → modal shows the source picker
  //   pickerOpen=*,    adding=...   → modal shows the configure form
  //   both falsy                    → modal closed
  // Source tagged union covers app-event subscriptions and integration
  // webhooks.
  type AddSource =
    | { kind: "app"; appName: string; appLabel: string; scope: "project" | "global" }
    | { kind: "webhook"; conn: any };
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerSearch, setPickerSearch] = useState("");
  const [adding, setAdding] = useState<AddSource | null>(null);
  const [appsList, setAppsList] = useState<AppRow[]>([]);
  // For app-event subscriptions: free-text topic pattern (e.g. "row.*",
  // "table.created", "*"). The slug sent to the server is composed as
  // `${appName}:${topicPattern}`. Kept for the single-topic fallback
  // path when the app declares no publishes — otherwise the form
  // routes through selectedTopics (multi-select).
  const [topicPattern, setTopicPattern] = useState("*");
  // Multi-select state for the rich app-event picker. Empty = nothing
  // selected (Subscribe button disabled). The `*` sentinel is one of
  // the regular checkbox entries and lives in this set when chosen.
  const [selectedTopics, setSelectedTopics] = useState<Set<string>>(new Set());
  // Search filter for the event list, plus a free-text "custom topic"
  // composer that lets the operator add a pattern not declared by the
  // app (e.g. "row.*" when the app declared exact topics, or any
  // pattern for apps with no declared publishes at all).
  const [topicFilter, setTopicFilter] = useState("");
  const [customTopic, setCustomTopic] = useState("");
  // Topics the operator added by hand via the "+ Custom topic" path
  // — kept separate from app.publishes so the checkbox list shows
  // them as the operator-authored extras they are.
  const [customTopics, setCustomTopics] = useState<string[]>([]);
  const [instanceId, setInstanceId] = useState(0);
  const [description, setDescription] = useState("");
  const [hmacSecret, setHmacSecret] = useState("");
  const [notifyAgent, setNotifyAgent] = useState(false);
  const [selectedEvents, setSelectedEvents] = useState<Set<string>>(new Set());
  const [filterDrafts, setFilterDrafts] = useState<SubscriptionFilterDraft[]>([]);
  const [error, setError] = useState("");
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const load = () => {
    // Wait for the current project to resolve before hitting the
    // scoped endpoints — without the project id, the server falls
    // back to "all user rows" and the tab renders subs from every
    // project (plus legacy unscoped ones), which is not what you
    // want when you're looking at a specific project.
    if (!currentProject?.id) {
      setSubs([]);
      setConnections([]);
      setInstanceList([]);
      return;
    }
    subscriptions.list(currentProject.id).then(setSubs).catch(() => {});
    integrations.connections(currentProject.id).then(setConnections).catch(() => {});
    instancesAPI.list(currentProject.id).then(setInstanceList).catch(() => {});
    integrations.catalog().then((apps) => {
      const map: Record<string, any> = {};
      for (const app of apps || []) map[app.slug] = app;
      setCatalog(map);
    }).catch(() => {});
    // Installed apps (project-scoped + globals) for the app-event
    // subscription picker. Only running rows show up — a stopped
    // sidecar can't emit anyway.
    appsAPI.list(currentProject.id).then((rs) => {
      setAppsList((rs || []).filter((r) => r.status === "running"));
    }).catch(() => setAppsList([]));
  };

  const closeAddFlow = () => {
    setPickerOpen(false);
    setAdding(null);
    setPickerSearch("");
    setTopicPattern("*");
    setSelectedTopics(new Set());
    setTopicFilter("");
    setCustomTopic("");
    setCustomTopics([]);
    setInstanceId(0);
    setDescription("");
    setHmacSecret("");
    setNotifyAgent(false);
    setSelectedEvents(new Set());
    setFilterDrafts([]);
    setError("");
  };
  useEffect(() => { load(); }, [currentProject?.id]);

  const safeConns = connections || [];

  const selectedFilterFieldTypes: Record<string, string> = {};
  if (adding?.kind === "app") {
    const app = appsList.find((candidate) => candidate.name === adding.appName);
    for (const declaration of app?.publishes || []) {
      if (selectedTopics.size > 0 && !selectedTopics.has("*") && !selectedTopics.has(declaration.name)) continue;
      for (const [field, type] of Object.entries(declaration.payload || {})) {
        selectedFilterFieldTypes[field] = type;
      }
    }
  }

  const handleSubscribe = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (!adding || !instanceId) { setError("Select an agent"); return; }

    try {
      if (adding.kind === "app") {
        // Multi-select: one subscription row carries every checked
        // topic in events[], matching webhook subscription semantics.
        // We fall back to topicPattern when the operator uses the
        // single free-text path for apps that declare no events.
        const topics = selectedTopics.size > 0
          ? Array.from(selectedTopics)
          : [topicPattern.trim() || "*"];
        const uniqueTopics = Array.from(new Set(topics.map((t) => t.trim()).filter(Boolean)));
        if (filterDrafts.some((draft) => !draft.field.trim() || !draft.value.trim())) {
          setError("Complete or remove every filter row");
          return;
        }
        const filterFields = filterDrafts.map((draft) => draft.field.trim());
        if (new Set(filterFields).size !== filterFields.length) {
          setError("Each filter field can only be used once");
          return;
        }
        const filters = serializeSubscriptionFilters(filterDrafts, selectedFilterFieldTypes);
        const label = uniqueTopics.length === 1
          ? (uniqueTopics[0] === "*" ? "events" : uniqueTopics[0])
          : `${uniqueTopics.length} events`;
        await subscriptions.create(
          `${adding.appLabel} ${label}`,
          `${adding.appName}:*`,
          instanceId,
          {
            description: description.trim(),
            events: uniqueTopics.length > 0 ? uniqueTopics : ["*"],
            projectId: currentProject?.id,
            source: "app_event",
            filters,
            notifyAgent,
          },
        );
      } else {
        // webhook
        await subscriptions.create(
          `${adding.conn.app_name} webhooks`,
          adding.conn.app_slug,
          instanceId,
          {
            connectionId: adding.conn.id,
            description: description.trim(),
            hmacSecret: hmacSecret.trim(),
            events: Array.from(selectedEvents),
            projectId: currentProject?.id,
            notifyAgent,
          },
        );
      }
      closeAddFlow();
      load();
    } catch (err: any) {
      setError(err.message || "Failed");
    }
  };

  const handleDelete = async (id: string) => {
    await subscriptions.delete(id);
    load();
  };

  const handleToggle = async (id: string, enabled: boolean) => {
    if (enabled) await subscriptions.disable(id);
    else await subscriptions.enable(id);
    load();
  };

  const [testingSub, setTestingSub] = useState<SubscriptionInfo | null>(null);
  const [testEvent, setTestEvent] = useState("");
  const [testPayload, setTestPayload] = useState("{}");
  const [testSending, setTestSending] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);

  const openTestModal = (sub: any) => {
    const events = catalog[sub.slug]?.webhook_events;
    setTestingSub(sub);
    setTestEvent(sub.source === "app_event" ? (sub.events?.[0] || "test.event") : (events?.[0]?.name || "test.event"));
    setTestPayload(JSON.stringify(sub.filters || { message: "Test event", id: 123 }, null, 2));
    setTestResult(null);
  };

  const handleTest = async () => {
    if (!testingSub) return;
    setTestSending(true);
    setTestResult(null);
    try {
      let payload: Record<string, any> | undefined;
      try { payload = JSON.parse(testPayload); } catch { /* use default */ }
      const res = await subscriptions.test(testingSub.id, { event: testEvent, payload });
      setTestResult(res.matched
        ? `Matched and delivered "${res.event}" to agent`
        : "Filtered out — the agent was not woken");
    } catch (e: any) {
      setTestResult(`Failed: ${e.message || "unknown error"}`);
    }
    setTestSending(false);
  };

  const copyUrl = (id: string, url: string) => {
    navigator.clipboard.writeText(url);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h2 className="text-text text-base font-bold">Events &amp; webhooks</h2>
        <p className="text-text-muted text-sm mt-1">
          Receive events from connected integrations via webhooks.
          Configure the webhook URL in your external service to deliver events to your Apteva instance.
        </p>
      </div>

      {/* Active subscriptions */}
      {safeSubs.length > 0 && (
        <section>
          <h3 className="text-text-muted text-sm font-bold mb-3 uppercase tracking-wide">Active</h3>
          <div className="space-y-3">
            {safeSubs.map((sub) => {
              const conn = connections.find((c: any) => c.id === sub.connection_id);
              const inst = instanceList.find((i) => i.id === sub.instance_id);
              return (
              <div key={sub.id} className="border border-border rounded-lg p-4 bg-bg-card">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-3">
                    <span className={`inline-block w-2.5 h-2.5 rounded-full ${sub.enabled ? "bg-green" : "bg-red"}`} />
                    <span className="text-text text-base font-bold">{sub.name}</span>
                    {sub.slug && <span className="text-text-muted text-sm">{sub.slug}</span>}
                  </div>
                  <div className="flex items-center gap-3">
                    <button onClick={() => openTestModal(sub)}
                      className="text-sm text-accent hover:text-accent-hover transition-colors">
                      Test
                    </button>
                    <button onClick={() => handleToggle(sub.id, sub.enabled)}
                      className="text-sm text-text-muted hover:text-text transition-colors">
                      {sub.enabled ? "Disable" : "Enable"}
                    </button>
                    <button onClick={() => handleDelete(sub.id)}
                      className="text-sm text-text-muted hover:text-red transition-colors">
                      Delete
                    </button>
                  </div>
                </div>
                {sub.description && <p className="text-text-dim text-sm mb-2">{sub.description}</p>}
                <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs mt-2">
                  <dt className="text-text-dim">Connection</dt>
                  <dd className="text-text">
                    {conn ? (
                      <>
                        {conn.app_name}
                        <span className="text-text-muted ml-2">{conn.name}</span>
                      </>
                    ) : (
                      <span className="text-text-dim">#{sub.connection_id} (not found)</span>
                    )}
                  </dd>
                  <dt className="text-text-dim">Agent</dt>
                  <dd className="text-text">
                    {inst ? inst.name : <span className="text-text-dim">#{sub.instance_id} (not found)</span>}
                  </dd>
                  <dt className="text-text-dim">Events</dt>
                  <dd>
                    {sub.events && sub.events.length > 0 ? (
                      <div className="flex flex-wrap gap-1">
                        {sub.events.map((ev) => (
                          <code key={ev} className="text-[10px] px-1.5 py-0.5 rounded bg-bg-input text-text font-mono">
                            {ev}
                          </code>
                        ))}
                      </div>
                    ) : (
                      <span className="text-text-dim">all events</span>
                    )}
                  </dd>
                  {sub.filters && Object.keys(sub.filters).length > 0 && (
                    <>
                      <dt className="text-text-dim">Filters</dt>
                      <dd className="flex flex-wrap gap-1">
                        {Object.entries(sub.filters).map(([field, value]) => (
                          <code key={field} className="text-[10px] px-1.5 py-0.5 rounded bg-bg-input text-text font-mono">
                            {field} = {String(value)}
                          </code>
                        ))}
                      </dd>
                    </>
                  )}
                </dl>
              </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Single entry point for app events and integration webhooks. */}
      <div className="flex justify-end">
        <button
          onClick={() => { closeAddFlow(); setPickerOpen(true); }}
          className="px-4 py-2 bg-accent text-bg rounded-lg text-sm font-bold hover:bg-accent-hover"
        >
          + New Subscription
        </button>
      </div>

      {/* Unified add flow — picker phase OR configure phase */}
      <Modal open={pickerOpen || !!adding} onClose={closeAddFlow}>
        {pickerOpen && !adding && (() => {
          // Build the picker source list: installed apps and webhook-
          // capable catalog integrations. One row per option.
          const webhookConns = safeConns.filter((c: any) =>
            catalog[c.app_slug]?.has_webhooks,
          );
          const q = pickerSearch.trim().toLowerCase();
          const matches = (s: string) => !q || s.toLowerCase().includes(q);
          const visibleApps = (appsList || []).filter((a) =>
            matches(a.display_name || a.name),
          );
          const visibleWebhook = webhookConns.filter((c: any) =>
            matches(c.app_name) || matches(c.name),
          );
          return (
            <div className="p-4 sm:p-6 w-full max-w-[640px] space-y-4">
              <div>
                <h3 className="text-text text-base font-bold">New subscription</h3>
                <p className="text-text-muted text-sm mt-1">
                  Pick a source to wake up an agent. Apps emit events from the
                  in-process bus; integrations forward external webhooks.
                </p>
              </div>
              <input
                value={pickerSearch}
                onChange={(e) => setPickerSearch(e.target.value)}
                placeholder="Search apps and integrations…"
                autoFocus
                className="w-full bg-bg-input border border-border rounded-lg px-4 py-2.5 text-sm text-text focus:outline-none focus:border-accent"
              />
              <div className="max-h-[420px] overflow-y-auto space-y-4">
                {visibleApps.length > 0 && (
                  <section>
                    <h4 className="text-text-muted text-xs font-bold uppercase tracking-wide mb-2">
                      Installed apps
                    </h4>
                    <div className="space-y-1">
                      {visibleApps.map((a) => {
                        const scope: "project" | "global" = a.project_id ? "project" : "global";
                        const label = a.display_name || a.name;
                        return (
                          <button
                            key={a.install_id}
                            onClick={() => {
                              setAdding({ kind: "app", appName: a.name, appLabel: label, scope });
                              setPickerOpen(false);
                              setTopicPattern("*");
                            }}
                            className="w-full flex items-center justify-between px-3 py-2 rounded-lg hover:bg-bg-card text-left"
                          >
                            <div className="flex items-center gap-2 min-w-0">
                              <span className="text-text text-sm font-medium truncate">{label}</span>
                              <span className="text-text-dim text-xs font-mono truncate">{a.name}</span>
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-300">
                                {scope}
                              </span>
                            </div>
                            <span className="text-text-muted text-xs">app events →</span>
                          </button>
                        );
                      })}
                    </div>
                  </section>
                )}
                {visibleWebhook.length > 0 && (
                  <section>
                    <h4 className="text-text-muted text-xs font-bold uppercase tracking-wide mb-2">
                      Integrations (webhooks)
                    </h4>
                    <div className="space-y-1">
                      {visibleWebhook.map((c: any) => (
                        <button
                          key={c.id}
                          onClick={() => {
                            const events = catalog[c.app_slug]?.webhook_events;
                            setAdding({ kind: "webhook", conn: c });
                            setSelectedEvents(events ? new Set(events.map((ev: any) => ev.name)) : new Set());
                            setPickerOpen(false);
                          }}
                          className="w-full flex items-center justify-between px-3 py-2 rounded-lg hover:bg-bg-card text-left"
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="text-text text-sm font-medium truncate">{c.app_name}</span>
                            <span className="text-text-dim text-xs truncate">{c.name}</span>
                          </div>
                          <span className="text-text-muted text-xs">webhook →</span>
                        </button>
                      ))}
                    </div>
                  </section>
                )}
                {visibleApps.length === 0 && visibleWebhook.length === 0 && (
                  <p className="text-text-dim text-sm py-4 text-center">
                    {q ? "No matches." : "No subscribable apps or integrations yet. Install an app, or connect an integration first."}
                  </p>
                )}
              </div>
            </div>
          );
        })()}

        {adding && (
          <form onSubmit={handleSubscribe} className="p-4 sm:p-6 w-full max-w-[560px] space-y-4">
            <div className="flex items-start justify-between gap-2">
              <div>
                <h3 className="text-text text-base font-bold">
                  {adding.kind === "app"
                    ? `Subscribe to ${adding.appLabel}`
                    : `Subscribe to ${adding.conn.app_name}`}
                </h3>
                <p className="text-text-muted text-sm mt-1">
                  {adding.kind === "app"
                    ? "Wake the agent on app events emitted from this project's installed sidecar."
                    : `Subscribe to ${adding.conn.app_name} events. The webhook is auto-registered upstream — no manual setup needed.`}
                </p>
              </div>
              <button
                type="button"
                onClick={() => { setAdding(null); setPickerOpen(true); }}
                className="text-text-muted text-xs hover:text-text shrink-0"
              >
                ← back
              </button>
            </div>

            <div>
              <label className="block text-text-muted text-sm mb-2">Target agent</label>
              <select
                value={instanceId} onChange={(e) => setInstanceId(Number(e.target.value))}
                className="w-full bg-bg-input border border-border rounded-lg px-4 py-3 text-base text-text focus:outline-none focus:border-accent"
              >
                <option value={0}>Select agent...</option>
                {instanceList.map((inst) => (
                  <option key={inst.id} value={inst.id}>{inst.name} (#{inst.id})</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-text-muted text-sm mb-2">Description (optional)</label>
              <input
                value={description} onChange={(e) => setDescription(e.target.value)}
                className="w-full bg-bg-input border border-border rounded-lg px-4 py-3 text-sm text-text focus:outline-none focus:border-accent"
                placeholder="e.g. Wake on row inserts in the leads table"
              />
            </div>

            {adding.kind === "app" && (() => {
              // Look up the picked app's declared publishes from the
              // installed-apps list. Two render modes:
              //   - Declared (decls.length > 0): rich checkbox picker
              //     with search + a "+ Custom topic" composer. Operator
              //     can subscribe to many events at once; each becomes
              //     its own subscription row server-side.
              //   - No declarations: degrade to the legacy single
              //     free-text input. Apps that haven't updated their
              //     manifest still work, just without the picker.
              const app = appsList.find((a) => a.name === adding.appName);
              const decls = app?.publishes || [];

              // Combined list = declared + operator-added customs.
              // Customs are tagged so the render shows them differently
              // (with a remove × button).
              type Row = { name: string; description?: string; payload?: Record<string, string>; custom: boolean };
              const allRows: Row[] = [
                { name: "*", description: `Every event from ${adding.appName}`, custom: false },
                ...decls.map((d) => ({ name: d.name, description: d.description, payload: d.payload, custom: false })),
                ...customTopics.map((n) => ({ name: n, description: "Custom topic / pattern (operator-added)", custom: true })),
              ];

              const filter = topicFilter.trim().toLowerCase();
              const filtered = filter
                ? allRows.filter((r) => r.name.toLowerCase().includes(filter) || (r.description || "").toLowerCase().includes(filter))
                : allRows;

              const toggle = (name: string) => {
                setSelectedTopics((prev) => {
                  const next = new Set(prev);
                  if (next.has(name)) next.delete(name);
                  else next.add(name);
                  // Picking "*" cancels out every specific topic — they
                  // would all be subsumed and create useless duplicate
                  // subs. Picking a specific topic cancels "*" for the
                  // same reason.
                  if (name === "*" && next.has("*")) {
                    for (const k of Array.from(next)) if (k !== "*") next.delete(k);
                  } else if (name !== "*" && next.has(name)) {
                    next.delete("*");
                  }
                  return next;
                });
              };

              const addCustom = () => {
                const t = customTopic.trim();
                if (!t) return;
                if (!customTopics.includes(t) && !decls.find((d) => d.name === t) && t !== "*") {
                  setCustomTopics((prev) => [...prev, t]);
                }
                setSelectedTopics((prev) => {
                  const next = new Set(prev);
                  next.add(t);
                  // Cancel the everything-wildcard if the user
                  // started narrowing to specific patterns.
                  if (t !== "*") next.delete("*");
                  return next;
                });
                setCustomTopic("");
              };

              const removeCustom = (name: string) => {
                setCustomTopics((prev) => prev.filter((n) => n !== name));
                setSelectedTopics((prev) => { const next = new Set(prev); next.delete(name); return next; });
              };

              return (
                <div>
                  <label className="block text-text-muted text-sm mb-2">
                    Event(s) <span className="text-text-dim font-mono">{adding.appName}:</span>
                    {selectedTopics.size > 0 && (
                      <span className="ml-2 text-text-dim text-xs">
                        ({selectedTopics.size} selected)
                      </span>
                    )}
                  </label>

                  {decls.length === 0 ? (
                    // Legacy single-pattern fallback — apps that
                    // haven't declared events yet. Same UX as before
                    // multi-select landed.
                    <>
                      <input
                        value={topicPattern}
                        onChange={(e) => setTopicPattern(e.target.value)}
                        className="w-full bg-bg-input border border-border rounded-lg px-4 py-3 text-sm text-text font-mono focus:outline-none focus:border-accent"
                        placeholder="e.g. row.* or table.created or *"
                      />
                      <p className="text-text-dim text-xs mt-1">
                        <span className="font-mono">*</span> matches everything; <span className="font-mono">prefix.*</span> matches by prefix; otherwise exact match.
                        <span className="text-text-dim"> {adding.appName} hasn't declared its events in its manifest — pattern is free-form.</span>
                      </p>
                    </>
                  ) : (
                    <>
                      {/* Search filter for the checkbox list. Useful
                          once an app declares 10+ events; for tiny
                          surfaces (media has 5) it's basically idle. */}
                      <input
                        value={topicFilter}
                        onChange={(e) => setTopicFilter(e.target.value)}
                        className="w-full bg-bg-input border border-border rounded-lg px-3 py-2 text-sm text-text focus:outline-none focus:border-accent"
                        placeholder="Filter events…"
                      />

                      {/* Checkbox list. Each row: label, optional
                          description, optional payload hint, custom
                          rows get a remove × on the right. */}
                      <div className="mt-2 border border-border rounded-lg max-h-72 overflow-y-auto divide-y divide-border">
                        {filtered.length === 0 ? (
                          <div className="px-3 py-4 text-center text-text-dim text-xs">
                            No events match "{topicFilter}".
                          </div>
                        ) : filtered.map((r) => {
                          const checked = selectedTopics.has(r.name);
                          return (
                            <label
                              key={r.name}
                              className={`flex items-start gap-3 px-3 py-2.5 cursor-pointer hover:bg-bg-hover transition-colors ${checked ? "bg-accent/5" : ""}`}
                            >
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={() => toggle(r.name)}
                                className="mt-1 shrink-0"
                              />
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2">
                                  <span className={`text-sm font-mono ${r.name === "*" ? "text-accent" : "text-text"}`}>
                                    {r.name}
                                  </span>
                                  {r.custom && (
                                    <span className="text-[10px] uppercase tracking-wide text-text-dim px-1 py-0.5 border border-border rounded">
                                      custom
                                    </span>
                                  )}
                                </div>
                                {r.description && (
                                  <div className="text-text-muted text-xs mt-0.5">{r.description}</div>
                                )}
                                {r.payload && (
                                  <div className="text-text-dim text-[11px] mt-1 font-mono">
                                    payload: {Object.entries(r.payload).map(([k, v]) => `${k}: ${v}`).join(", ")}
                                  </div>
                                )}
                              </div>
                              {r.custom && (
                                <button
                                  type="button"
                                  onClick={(e) => { e.preventDefault(); removeCustom(r.name); }}
                                  className="shrink-0 text-text-dim hover:text-red text-sm px-1"
                                  title="Remove this custom topic"
                                >
                                  ×
                                </button>
                              )}
                            </label>
                          );
                        })}
                      </div>

                      {/* Custom-topic composer — for patterns the app
                          didn't declare ("row.*", "*.failed", etc.). */}
                      <div className="mt-2 flex gap-2">
                        <input
                          value={customTopic}
                          onChange={(e) => setCustomTopic(e.target.value)}
                          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addCustom(); } }}
                          className="flex-1 bg-bg-input border border-border rounded-lg px-3 py-2 text-sm text-text font-mono focus:outline-none focus:border-accent"
                          placeholder="+ Custom topic or pattern (e.g. row.*)"
                        />
                        <button
                          type="button"
                          onClick={addCustom}
                          disabled={!customTopic.trim()}
                          className="px-3 py-2 border border-border rounded-lg text-text-muted hover:text-accent text-xs transition-colors disabled:opacity-40"
                        >
                          Add
                        </button>
                      </div>
                      <p className="text-text-dim text-[11px] mt-1">
                        <span className="font-mono">*</span> matches everything;
                        <span className="font-mono"> prefix.*</span> matches by prefix; otherwise exact match.
                      </p>
                    </>
                  )}
                </div>
              );
            })()}

            {adding.kind === "app" && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <div>
                    <label className="block text-text-muted text-sm">Filters (optional)</label>
                    <p className="text-text-dim text-xs mt-0.5">
                      All fields must match. If an event field is an array, the value may match any item.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setFilterDrafts((rows) => [
                      ...rows,
                      { field: Object.keys(selectedFilterFieldTypes)[0] || "", value: "" },
                    ])}
                    className="text-xs px-2 py-1 border border-border rounded hover:bg-bg-input"
                  >
                    + Add filter
                  </button>
                </div>
                {filterDrafts.map((draft, index) => {
                  const fieldListID = `subscription-filter-fields-${index}`;
                  return (
                    <div key={index} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] gap-2">
                      <div>
                        <input
                          list={fieldListID}
                          value={draft.field}
                          onChange={(e) => setFilterDrafts((rows) => rows.map((row, rowIndex) =>
                            rowIndex === index ? { ...row, field: e.target.value } : row,
                          ))}
                          placeholder="Field, e.g. list_ids"
                          className="w-full bg-bg-input border border-border rounded-lg px-3 py-2 text-sm text-text font-mono focus:outline-none focus:border-accent"
                        />
                        <datalist id={fieldListID}>
                          {Object.keys(selectedFilterFieldTypes).map((field) => (
                            <option key={field} value={field} />
                          ))}
                        </datalist>
                      </div>
                      <input
                        value={draft.value}
                        onChange={(e) => setFilterDrafts((rows) => rows.map((row, rowIndex) =>
                          rowIndex === index ? { ...row, value: e.target.value } : row,
                        ))}
                        placeholder="Value, e.g. 2"
                        className="w-full bg-bg-input border border-border rounded-lg px-3 py-2 text-sm text-text font-mono focus:outline-none focus:border-accent"
                      />
                      <button
                        type="button"
                        onClick={() => setFilterDrafts((rows) => rows.filter((_, rowIndex) => rowIndex !== index))}
                        className="px-2 text-text-dim hover:text-red"
                        aria-label={`Remove filter ${index + 1}`}
                      >
                        ×
                      </button>
                    </div>
                  );
                })}
                {filterDrafts.length > 0 && (
                  <p className="text-text-dim text-[11px]">
                    Events that do not match these field values will not wake the agent.
                  </p>
                )}
              </div>
            )}

            {adding.kind === "webhook" && (() => {
              // Local-source: use the catalog's webhook_events list.
              const events = catalog[adding.conn.app_slug]?.webhook_events;
              if (!events || events.length === 0) return null;
              return (
                <div>
                  <label className="block text-text-muted text-sm mb-2">Events</label>
                  <div className="border border-border rounded-lg bg-bg-input p-3 max-h-48 overflow-y-auto space-y-1">
                    <label className="flex items-center gap-2 cursor-pointer py-1 px-1 rounded hover:bg-bg-card">
                      <input
                        type="checkbox"
                        checked={selectedEvents.size === events.length}
                        onChange={(e) => {
                          setSelectedEvents(e.target.checked ? new Set(events.map((ev: any) => ev.name)) : new Set());
                        }}
                        className="accent-accent"
                      />
                      <span className="text-text text-sm font-bold">All events</span>
                    </label>
                    <div className="border-t border-border my-1" />
                    {events.map((ev: any) => (
                      <label key={ev.name} className="flex items-start gap-2 cursor-pointer py-1 px-1 rounded hover:bg-bg-card">
                        <input
                          type="checkbox"
                          checked={selectedEvents.has(ev.name)}
                          onChange={(e) => {
                            const next = new Set(selectedEvents);
                            e.target.checked ? next.add(ev.name) : next.delete(ev.name);
                            setSelectedEvents(next);
                          }}
                          className="accent-accent mt-0.5"
                        />
                        <div>
                          <span className="text-text text-sm">{ev.name}</span>
                          {ev.description && <p className="text-text-dim text-xs">{ev.description}</p>}
                        </div>
                      </label>
                    ))}
                  </div>
                </div>
              );
            })()}

            {adding.kind === "webhook" && (
              <div>
                <label className="block text-text-muted text-sm mb-2">HMAC Secret (optional)</label>
                <input
                  type="password"
                  value={hmacSecret} onChange={(e) => setHmacSecret(e.target.value)}
                  className="w-full bg-bg-input border border-border rounded-lg px-4 py-3 text-sm text-text focus:outline-none focus:border-accent"
                  placeholder="For signature verification"
                />
              </div>
            )}

            <label className="flex items-start gap-3 border border-border rounded-lg bg-bg-input px-3 py-2.5 cursor-pointer">
              <input
                type="checkbox"
                checked={notifyAgent}
                onChange={(e) => setNotifyAgent(e.target.checked)}
                className="mt-1 accent-accent"
              />
              <div>
                <div className="text-text text-sm">Tell the agent about this subscription</div>
                <p className="text-text-dim text-xs mt-0.5">
                  Optional agent context. The subscription stays active when this is unchecked.
                </p>
              </div>
            </label>

            {error && <div className="text-red text-sm">{error}</div>}

            <div className="flex justify-end gap-3">
              <button type="button" onClick={closeAddFlow}
                className="px-4 py-2.5 border border-border rounded-lg text-sm text-text-muted hover:text-text transition-colors">
                Cancel
              </button>
              <button
                type="submit"
                disabled={adding?.kind === "app" && (appsList.find((a) => a.name === adding.appName)?.publishes?.length ?? 0) > 0 && selectedTopics.size === 0}
                className="px-4 py-2.5 bg-accent text-bg rounded-lg font-bold text-sm hover:bg-accent-hover transition-colors disabled:opacity-50"
              >
                {adding?.kind === "app" && selectedTopics.size > 1
                  ? `Subscribe to ${selectedTopics.size} events`
                  : "Create Subscription"}
              </button>
            </div>
          </form>
        )}
      </Modal>

      {/* Test event modal */}
      <Modal open={!!testingSub} onClose={() => setTestingSub(null)}>
        {testingSub && (
          <div className="p-6 space-y-4">
            <h3 className="text-text text-base font-bold">
              Test {testingSub.name}
            </h3>
            <p className="text-text-muted text-sm">
              Send a test event to verify your subscription is working.
            </p>

            <div>
              <label className="block text-text-muted text-sm mb-2">Event Type</label>
              {(() => {
                const events = catalog[testingSub.slug]?.webhook_events;
                if (events && events.length > 0) {
                  return (
                    <select
                      value={testEvent}
                      onChange={(e) => setTestEvent(e.target.value)}
                      className="w-full bg-bg-input border border-border rounded-lg px-4 py-3 text-sm text-text focus:outline-none focus:border-accent"
                    >
                      {events.map((ev: any) => (
                        <option key={ev.name} value={ev.name}>{ev.name} — {ev.description}</option>
                      ))}
                    </select>
                  );
                }
                return (
                  <input
                    value={testEvent}
                    onChange={(e) => setTestEvent(e.target.value)}
                    className="w-full bg-bg-input border border-border rounded-lg px-4 py-3 text-sm text-text focus:outline-none focus:border-accent"
                    placeholder="e.g. content.created"
                  />
                );
              })()}
            </div>

            <div>
              <label className="block text-text-muted text-sm mb-2">Payload (JSON)</label>
              <textarea
                value={testPayload}
                onChange={(e) => setTestPayload(e.target.value)}
                rows={6}
                className="w-full bg-bg-input border border-border rounded-lg px-4 py-3 text-sm text-text font-mono focus:outline-none focus:border-accent resize-y"
                placeholder='{ "message": "hello" }'
              />
            </div>

            {testResult && (
              <div className={`text-sm ${testResult.startsWith("Failed") ? "text-red" : testResult.startsWith("Filtered") ? "text-yellow" : "text-green"}`}>
                {testResult}
              </div>
            )}

            <div className="flex justify-end gap-3">
              <button onClick={() => setTestingSub(null)}
                className="px-4 py-2.5 border border-border rounded-lg text-sm text-text-muted hover:text-text transition-colors">
                Close
              </button>
              <button onClick={handleTest} disabled={testSending}
                className="px-4 py-2.5 bg-accent text-bg rounded-lg font-bold text-sm hover:bg-accent-hover transition-colors disabled:opacity-50">
                {testSending ? "Sending..." : "Send Test Event"}
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
