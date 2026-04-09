import { useState, useEffect } from "react";
import { instances, type Instance, type TelemetryEvent } from "../api";
import { ChatPanel } from "../components/ChatPanel";
import { ActivityPanel } from "../components/ActivityPanel";
import { FleetGraph } from "../components/FleetGraph";
import { Modal } from "../components/Modal";
import { useProjects } from "../hooks/useProjects";

export function Dashboard() {
  const { currentProject } = useProjects();
  const [instance, setInstance] = useState<Instance | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [name, setName] = useState("");
  const [directive, setDirective] = useState("");
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);

  const projectId = currentProject?.id;

  const load = () =>
    instances
      .list(projectId)
      .then((list) => {
        setInstance(list.length > 0 ? list[0] : null);
        setLoaded(true);
      })
      .catch(() => setLoaded(true));

  useEffect(() => {
    load();
    const interval = setInterval(load, 5000);
    return () => clearInterval(interval);
  }, [projectId]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setError("");
    setCreating(true);
    try {
      await instances.create(name.trim(), directive.trim(), "autonomous", projectId);
      setName("");
      setDirective("");
      load();
    } catch (err: any) {
      setError(err.message || "Failed to create instance");
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async () => {
    if (!instance) return;
    await instances.delete(instance.id);
    setInstance(null);
  };

  if (!loaded) return null;

  if (instance) {
    return <InstanceView instance={instance} onDelete={handleDelete} onReload={load} />;
  }

  // Create instance form
  return (
    <div className="flex flex-col h-full">
      <div className="border-b border-border px-6 py-4">
        <h1 className="text-text text-lg font-bold">Dashboard</h1>
      </div>
      <div className="flex-1 overflow-y-auto p-6">
        <form onSubmit={handleCreate} className="border border-border rounded-lg p-6 bg-bg-card space-y-4 max-w-lg">
          <h2 className="text-text text-base font-bold">Create your instance</h2>
          <div>
            <label className="block text-text-muted text-sm mb-2">Name</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full bg-bg-input border border-border rounded-lg px-4 py-3 text-base text-text focus:outline-none focus:border-accent"
              placeholder="My instance"
              required
            />
          </div>
          <div>
            <label className="block text-text-muted text-sm mb-2">Directive (optional)</label>
            <textarea
              value={directive}
              onChange={(e) => setDirective(e.target.value)}
              className="w-full bg-bg-input border border-border rounded-lg px-4 py-3 text-base text-text focus:outline-none focus:border-accent resize-none h-24"
              placeholder="What should this instance think about?"
            />
          </div>
          {error && <div className="text-red text-sm">{error}</div>}
          <button
            type="submit"
            disabled={creating}
            className="px-6 py-3 bg-accent text-bg rounded-lg font-bold text-base hover:bg-accent-hover transition-colors disabled:opacity-50"
          >
            {creating ? "Creating..." : "Create Instance"}
          </button>
        </form>
      </div>
    </div>
  );
}

// ─── Instance View (Chat + Activity) ───

function InstanceView({ instance, onDelete, onReload }: { instance: Instance; onDelete: () => void; onReload: () => void }) {
  const [latestEvent, setLatestEvent] = useState<TelemetryEvent | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [view, setView] = useState<"activity" | "fleet">("activity");

  // Track threads, tools, thoughts for the fleet graph
  const [graphThreads, setGraphThreads] = useState<import("../api").Thread[]>([]);
  const [graphActiveTools, setGraphActiveTools] = useState<Record<string, string>>({});
  const [graphThoughts, setGraphThoughts] = useState<Record<string, string>>({});

  const handleEvent = (event: TelemetryEvent) => {
    setLatestEvent(event);
    const data = event.data || {};

    // Track threads
    if (event.type === "thread.spawn") {
      setGraphThreads((prev) => {
        if (prev.some((t) => t.id === event.thread_id)) return prev;
        const parentId = data.parent_id || "main";
        let depth = 0;
        if (parentId !== "main") {
          const parent = prev.find((t) => t.id === parentId);
          depth = parent ? (parent.depth || 0) + 1 : 1;
        }
        return [...prev, { id: event.thread_id, parent_id: parentId, depth, directive: data.directive || "", tools: [], iteration: 0, rate: "reactive", model: "", age: "0s" }];
      });
    }
    if (event.type === "thread.done") {
      setGraphThreads((prev) => prev.filter((t) => t.id !== event.thread_id));
      setGraphActiveTools((prev) => { const n = { ...prev }; delete n[event.thread_id]; return n; });
      setGraphThoughts((prev) => { const n = { ...prev }; delete n[event.thread_id]; return n; });
    }

    // Track active tools
    if (event.type === "tool.call" && data.name && !String(data.name).startsWith("channels_")) {
      setGraphActiveTools((prev) => ({ ...prev, [event.thread_id]: data.name }));
    }
    if (event.type === "tool.result" && data.name && !String(data.name).startsWith("channels_")) {
      setGraphActiveTools((prev) => { const n = { ...prev }; if (n[event.thread_id] === data.name) delete n[event.thread_id]; return n; });
    }

    // Track thoughts
    if (event.type === "llm.done" && data.message) {
      const text = String(data.message).slice(0, 100);
      setGraphThoughts((prev) => ({ ...prev, [event.thread_id]: text }));
      // Update iteration on thread
      setGraphThreads((prev) => prev.map((t) =>
        t.id === event.thread_id ? { ...t, iteration: data.iteration || t.iteration, rate: data.rate || t.rate } : t
      ));
    }
  };

  // Sync threads from poll (initial load + catch-up)
  useEffect(() => {
    if (instance.status !== "running") return;
    import("../api").then(({ core }) => {
      core.threads(instance.id).then((threads) => {
        setGraphThreads(threads.filter((t) => t.id !== "main").concat(
          [{ id: "main", parent_id: "", depth: 0, directive: "", tools: [], iteration: 0, rate: "sleep", model: "", age: "" }]
        ));
      }).catch(() => {});
    });
  }, [instance.id, instance.status]);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="border-b border-border px-6 py-2.5 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className={`inline-block w-2.5 h-2.5 rounded-full ${instance.status === "running" ? "bg-green" : "bg-red"}`} />
          <h1 className="text-text text-sm font-bold">{instance.name}</h1>
          {/* View toggle */}
          <div className="flex border border-border rounded-lg overflow-hidden ml-4">
            <button
              onClick={() => setView("activity")}
              className={`px-3 py-1 text-xs transition-colors ${view === "activity" ? "bg-accent/20 text-accent" : "text-text-muted hover:text-text"}`}
            >
              Activity
            </button>
            <button
              onClick={() => setView("fleet")}
              className={`px-3 py-1 text-xs transition-colors ${view === "fleet" ? "bg-accent/20 text-accent" : "text-text-muted hover:text-text"}`}
            >
              Fleet
            </button>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {instance.status === "running" && (
            <>
              <button
                onClick={async () => { await instances.pause(instance.id); }}
                className="px-2.5 py-1 border border-border rounded-lg text-xs text-text-muted hover:text-accent hover:border-accent transition-colors"
              >
                Pause
              </button>
              <button
                onClick={async () => { await instances.stop(instance.id); onReload(); }}
                className="px-2.5 py-1 border border-border rounded-lg text-xs text-text-muted hover:text-red hover:border-red transition-colors"
              >
                Stop
              </button>
            </>
          )}
          {instance.status === "stopped" && (
            <button
              onClick={async () => { await instances.start(instance.id); onReload(); }}
              className="px-2.5 py-1 border border-accent rounded-lg text-xs text-accent hover:bg-accent hover:text-bg transition-colors"
            >
              Start
            </button>
          )}
          <button
            onClick={() => setShowDeleteConfirm(true)}
            className="px-2.5 py-1 border border-border rounded-lg text-xs text-text-muted hover:text-red hover:border-red transition-colors"
          >
            Delete
          </button>
        </div>
      </div>

      {/* Delete confirmation */}
      <Modal open={showDeleteConfirm} onClose={() => setShowDeleteConfirm(false)}>
        <div className="p-6">
          <h3 className="text-text text-lg font-bold mb-2">Delete Instance</h3>
          <p className="text-text-dim text-sm mb-6">
            Delete <span className="text-text font-bold">{instance.name}</span>? This cannot be undone.
          </p>
          <div className="flex justify-end gap-3">
            <button onClick={() => setShowDeleteConfirm(false)}
              className="px-4 py-2 border border-border rounded-lg text-sm text-text-muted hover:text-text transition-colors">
              Cancel
            </button>
            <button onClick={() => { setShowDeleteConfirm(false); onDelete(); }}
              className="px-4 py-2 bg-red text-bg rounded-lg text-sm font-bold hover:opacity-80 transition-opacity">
              Delete
            </button>
          </div>
        </div>
      </Modal>

      {/* Main content */}
      <div className="flex-1 flex min-h-0">
        {/* Chat panel */}
        <div className="w-1/3 min-w-[300px] border-r border-border">
          {instance.status === "running" ? (
            <ChatPanel instanceId={instance.id} onEvent={handleEvent} />
          ) : (
            <div className="flex items-center justify-center h-full text-text-muted text-sm">
              Instance is stopped. Start it to begin chatting.
            </div>
          )}
        </div>

        {/* Right panel — Activity or Fleet graph */}
        <div className="flex-1">
          {view === "activity" ? (
            <ActivityPanel instance={instance} event={latestEvent} onReload={onReload} />
          ) : (
            <FleetGraph threads={graphThreads} activeTools={graphActiveTools} thoughts={graphThoughts} />
          )}
        </div>
      </div>
    </div>
  );
}
