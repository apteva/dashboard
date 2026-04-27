// Project root dashboard — read-only, live, project-wide.
//
// This page is the cockpit: a glance answers "what is my project doing
// right now?" without drilling into any single agent. Every section is
// derived from data already flowing through telemetry / existing API
// endpoints; mutation lives one click away on /agents/:id.
//
// Layout (desktop):
//
//   ┌─ Pulse strip (5 KPIs) ────────────────────────────────────────┐
//   ├─ Agents grid ──────────┬─ Activity feed (cross-instance) ────┤
//   ├─ Project chat ─────────┼─ Tools usage ──┬─ Cost (24h) ───────┤
//   └────────────────────────┴────────────────┴────────────────────┘
//
// Sections are composed from the existing event bus and instance
// list — no new core work needed; the project-event SSE wrapper lives
// alongside this page in PulseStrip / ActivityFeed.

import { PulseStrip } from "../components/dashboard/PulseStrip";
import { AgentsGrid } from "../components/dashboard/AgentsGrid";
import { ActivityFeed } from "../components/dashboard/ActivityFeed";
import { ProjectChat } from "../components/dashboard/ProjectChat";
import { ToolsUsageCard } from "../components/dashboard/ToolsUsageCard";
import { CostCard } from "../components/dashboard/CostCard";

export function Dashboard() {
  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="border-b border-border px-6 py-4">
        <h1 className="text-text text-lg font-bold">Overview</h1>
      </div>

      <div className="flex-1 overflow-auto p-4 space-y-4">
        <PulseStrip />

        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-4">
          <AgentsGrid />
          <ActivityFeed />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,3fr)_minmax(0,1fr)_minmax(0,1fr)] gap-4">
          <ProjectChat />
          <ToolsUsageCard />
          <CostCard />
        </div>
      </div>
    </div>
  );
}
