import { AptevaInbox } from "../components/dashboard/AptevaInbox";
import { CurrentStatuses } from "../components/dashboard/CurrentStatuses";
import { usePageTitle } from "../hooks/usePageTitle";

export function Monitor() {
  usePageTitle("Monitor");

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="border-b border-border px-6 py-4">
        <h1 className="text-text text-lg font-bold">Monitor</h1>
        <p className="mt-1 text-xs text-text-dim">
          Current agent work and all-project Apteva channel inbox.
        </p>
      </div>

      <div className="flex-1 overflow-auto p-4">
        <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1.1fr)_minmax(360px,0.9fr)] gap-4 items-start">
          <CurrentStatuses />
          <AptevaInbox allProjects limit={30} />
        </div>
      </div>
    </div>
  );
}
