import { useState } from "react";

import { SecurityAlertsPanel, SecurityOverviewPanel } from "./security/SecurityOverview";
import { SecurityEventsPanel } from "./security/SecurityEvents";
import { SecurityContainmentPanel } from "./security/SecurityContainment";
import { SecurityHostPanel } from "./security/SecurityHost";

const TABS = [
  { id: "overview", label: "Overview" },
  { id: "alerts", label: "Alerts" },
  { id: "events", label: "Events" },
  { id: "accounts", label: "Accounts" },
  { id: "ssh", label: "SSH" },
] as const;
type Tab = typeof TABS[number]["id"];

export function SecurityCenter() {
  const [tab, setTab] = useState<Tab>("overview");
  return (
    <div className="w-full space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-bold text-text">Security monitoring</h2>
          <p className="mt-1 text-sm text-text-muted">Audit trail, alerts, account containment, and SSH access to this server.</p>
        </div>
        <div className="flex rounded-md border border-border p-0.5" role="tablist" aria-label="Security sections">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => setTab(t.id)}
              className={`rounded px-2.5 py-1 text-xs transition-colors ${tab === t.id ? "bg-bg-hover font-semibold text-text" : "text-text-muted hover:text-text"}`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>
      <div role="tabpanel">
        {tab === "overview" && <SecurityOverviewPanel />}
        {tab === "alerts" && <SecurityAlertsPanel />}
        {tab === "events" && <SecurityEventsPanel />}
        {tab === "accounts" && <SecurityContainmentPanel />}
        {tab === "ssh" && <SecurityHostPanel />}
      </div>
    </div>
  );
}
