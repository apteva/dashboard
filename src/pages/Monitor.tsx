import { AptevaInbox } from "../components/dashboard/AptevaInbox";
import { usePageTitle } from "../hooks/usePageTitle";

export function Monitor() {
  usePageTitle("Monitor");

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="border-b border-border px-6 py-4">
        <h1 className="text-text text-lg font-bold">Monitor</h1>
        <p className="mt-1 text-xs text-text-dim">
          All-project Apteva channel inbox for agent approvals, reports, and alerts.
        </p>
      </div>

      <div className="flex-1 overflow-auto p-4">
        <div className="grid grid-cols-1 xl:grid-cols-[minmax(360px,720px)_minmax(0,1fr)] gap-4">
          <div className="space-y-4">
            <AptevaInbox allProjects limit={30} />
          </div>
          <div className="hidden xl:flex min-h-[240px] rounded-lg border border-border bg-bg-card/45 items-center justify-center text-center text-xs text-text-dim px-8">
            Live all-project activity will go here. For now, Monitor is focused on the central inbox.
          </div>
        </div>
      </div>
    </div>
  );
}
