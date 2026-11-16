import { useEffect, useState } from "react";

import { security, type SecurityEvent, type SecurityEventFilter } from "../../../api";
import { Card, ErrorNote, SeverityBadge, buttonClass, errorText, formatTime, inputClass } from "./shared";

const CATEGORIES = ["", "auth", "credential", "permission", "export", "privileged", "deployment", "config", "containment", "ssh", "system", "audit"];
const RESULTS = ["", "success", "failure", "denied", "error"];
const PAGE = 100;

// Describes who acted, without ever showing a credential value.
export function describeActor(ev: SecurityEvent): string {
  const who = ev.principal_type ? `${ev.principal_type}${ev.principal_id ? ` ${ev.principal_id}` : ""}` : "anonymous";
  return ev.source_ip ? `${who} from ${ev.source_ip}` : who;
}

export function SecurityEventsPanel() {
  const [filter, setFilter] = useState<SecurityEventFilter>({});
  const [draft, setDraft] = useState<SecurityEventFilter>({});
  const [events, setEvents] = useState<SecurityEvent[] | null>(null);
  const [more, setMore] = useState(false);
  const [open, setOpen] = useState<number | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    setEvents(null);
    setError("");
    security.events({ ...filter, limit: PAGE })
      .then((page) => { setEvents(page); setMore(page.length === PAGE); })
      .catch((err) => setError(errorText(err)));
  }, [filter]);

  const loadOlder = async () => {
    if (!events?.length) return;
    try {
      const page = await security.events({ ...filter, limit: PAGE, before_seq: events[events.length - 1].seq });
      setEvents([...events, ...page]);
      setMore(page.length === PAGE);
    } catch (err) {
      setError(errorText(err));
    }
  };

  const set = (key: keyof SecurityEventFilter) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setDraft({ ...draft, [key]: e.target.value || undefined });

  return (
    <Card title="Security events" description="Newest first. Credentials appear only as references, never as values.">
      <form
        className="mb-4 grid grid-cols-[repeat(auto-fill,minmax(10rem,1fr))] gap-2"
        onSubmit={(e) => { e.preventDefault(); setFilter({ ...draft }); }}
      >
        <select aria-label="Category" className={inputClass} value={draft.category || ""} onChange={set("category")}>
          {CATEGORIES.map((c) => <option key={c} value={c}>{c || "All categories"}</option>)}
        </select>
        <select aria-label="Result" className={inputClass} value={draft.result || ""} onChange={set("result")}>
          {RESULTS.map((r) => <option key={r} value={r}>{r || "All results"}</option>)}
        </select>
        <input aria-label="Action" placeholder="Action, e.g. auth.login" className={inputClass} value={draft.action || ""} onChange={set("action")} />
        <input aria-label="User ID" placeholder="User ID" className={inputClass} value={draft.principal_id || ""} onChange={set("principal_id")} />
        <input aria-label="Source IP" placeholder="Source IP" className={inputClass} value={draft.source_ip || ""} onChange={set("source_ip")} />
        <button type="submit" className={buttonClass}>Filter</button>
      </form>
      <ErrorNote error={error} />
      {!events ? <p className="text-sm text-text-muted">Loading…</p> : events.length === 0 ? <p className="text-xs text-text-muted">No matching events.</p> : (
        <ul className="divide-y divide-border">
          {events.map((ev) => (
            <li key={ev.seq} className="py-2">
              <button type="button" className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 text-left" onClick={() => setOpen(open === ev.seq ? null : ev.seq)} aria-expanded={open === ev.seq}>
                <SeverityBadge severity={ev.severity} />
                <span className="font-mono text-xs text-text">{ev.action}</span>
                <span className={`text-[11px] ${ev.result === "success" ? "text-text-dim" : "text-red"}`}>{ev.result}</span>
                <span className="text-[11px] text-text-muted">{describeActor(ev)}</span>
                {ev.target_id && <span className="text-[11px] text-text-dim">→ {ev.target_type} {ev.target_id}</span>}
                <span className="ml-auto text-[11px] text-text-dim">{formatTime(ev.occurred_at)}</span>
              </button>
              {open === ev.seq && (
                <pre className="mt-2 overflow-x-auto rounded-lg border border-border bg-bg-input p-3 text-[11px] leading-5 text-text-muted">
                  {JSON.stringify({
                    event_id: ev.event_id, category: ev.category, credential: ev.credential_id, user_agent: ev.user_agent,
                    app: ev.origin_app, install_id: ev.install_id, project_id: ev.project_id, machine: ev.machine_id,
                    correlation_id: ev.correlation_id, details: ev.details,
                  }, (_k, v) => (v === undefined || v === "" ? undefined : v), 2)}
                </pre>
              )}
            </li>
          ))}
        </ul>
      )}
      {more && <div className="mt-3"><button type="button" className={buttonClass} onClick={loadOlder}>Load older events</button></div>}
    </Card>
  );
}
