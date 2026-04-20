import { useParams } from "react-router-dom";
import { MemoryPanel } from "../components/MemoryPanel";

// Memory page — thin wrapper around MemoryPanel for routes like
// /instances/:id/memory. Most users reach memory via the view tabs
// inside InstanceView; this page exists for deep-linkable URLs.
export function Memory() {
  const { id } = useParams<{ id: string }>();
  const instanceId = Number(id);
  if (!Number.isFinite(instanceId) || instanceId <= 0) {
    return (
      <div className="flex flex-col h-full">
        <div className="border-b border-border px-4 py-3">
          <span className="text-text-muted text-xs">// MEMORY</span>
        </div>
        <div className="flex-1 p-4 text-text-muted text-xs">
          Missing or invalid instance id in URL.
        </div>
      </div>
    );
  }
  return <MemoryPanel instanceId={instanceId} />;
}
