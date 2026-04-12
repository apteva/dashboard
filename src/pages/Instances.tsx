import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { instances, core, type Instance, type Status } from "../api";
import { useProjects } from "../hooks/useProjects";

// Instances is the fleet-list view: all instances in the current project,
// with status + quick lifecycle actions + a create form. Clicking a row
// navigates to /instances/:id which renders the full InstanceView.
export function Instances() {
  const { currentProject } = useProjects();
  const projectId = currentProject?.id;

  const [list, setList] = useState<Instance[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState("");
  const [directive, setDirective] = useState("");
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);

  // Per-instance live thread count, keyed by instance id. Updated every
  // poll from core.status so the list reflects how active each instance is
  // without needing full thread data.
  const [liveStatus, setLiveStatus] = useState<Record<number, { threads: number; iter: number; rate: string } | null>>({});

  const load = () => {
    instances
      .list(projectId)
      .then((items) => {
        setList(items || []);
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  };

  useEffect(() => {
    if (!projectId) return;
    setList([]);
    setLoaded(false);
    setLiveStatus({});
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  // Poll core status for running instances so the list shows live activity.
  useEffect(() => {
    if (list.length === 0) return;
    const refresh = () => {
      list.forEach((inst) => {
        if (inst.status !== "running") {
          setLiveStatus((prev) => ({ ...prev, [inst.id]: null }));
          return;
        }
        core
          .status(inst.id)
          .then((s: Status) => {
            setLiveStatus((prev) => ({
              ...prev,
              [inst.id]: { threads: s.threads, iter: s.iteration, rate: s.rate },
            }));
          })
          .catch(() => {});
      });
    };
    refresh();
    const t = setInterval(refresh, 5000);
    return () => clearInterval(t);
  }, [list]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setError("");
    setCreating(true);
    try {
      // Create without auto-starting. The user can click Start on the row
      // (or on the instance page) when they want it running. Avoids having
      // a fresh instance consume tokens before the user has had a chance
      // to configure directive / MCPs / channels.
      await instances.create(name.trim(), directive.trim(), "autonomous", projectId, false);
      setName("");
      setDirective("");
      setShowCreate(false);
      load();
    } catch (err: any) {
      setError(err?.message || "Failed to create instance");
    } finally {
      setCreating(false);
    }
  };

  const handleStart = async (id: number) => {
    try {
      await instances.start(id);
      load();
    } catch {}
  };

  const handleStop = async (id: number) => {
    try {
      await instances.stop(id);
      load();
    } catch {}
  };

  if (!loaded) return null;

  return (
    <div className="flex flex-col h-full">
      <div className="border-b border-border px-6 py-4 flex items-center justify-between">
        <div>
          <h1 className="text-text text-lg font-bold">Instances</h1>
          <p className="text-text-muted text-sm mt-1">
            {list.length === 0
              ? "No instances yet. Create one to get started."
              : `${list.length} instance${list.length === 1 ? "" : "s"} in this project.`}
          </p>
        </div>
        {!showCreate && (
          <button
            onClick={() => setShowCreate(true)}
            className="px-4 py-2 bg-accent text-bg rounded-lg font-bold text-sm hover:bg-accent-hover transition-colors"
          >
            + New Instance
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-6 space-y-4">
        {showCreate && (
          <form
            onSubmit={handleCreate}
            className="border border-border rounded-lg p-5 bg-bg-card space-y-4 max-w-2xl"
          >
            <h2 className="text-text text-base font-bold">Create instance</h2>
            <div>
              <label className="block text-text-muted text-sm mb-2">Name</label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full bg-bg-input border border-border rounded-lg px-4 py-3 text-base text-text focus:outline-none focus:border-accent"
                placeholder="supervisor"
                required
                autoFocus
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
            <div className="flex gap-3">
              <button
                type="submit"
                disabled={creating}
                className="px-5 py-2.5 bg-accent text-bg rounded-lg font-bold text-sm hover:bg-accent-hover transition-colors disabled:opacity-50"
              >
                {creating ? "Creating..." : "Create"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowCreate(false);
                  setError("");
                }}
                className="px-5 py-2.5 border border-border rounded-lg text-sm text-text-muted hover:text-text transition-colors"
              >
                Cancel
              </button>
            </div>
          </form>
        )}

        {list.length === 0 && !showCreate && (
          <div className="text-text-muted text-sm">No instances. Click + New Instance.</div>
        )}

        <div className="space-y-2">
          {list.map((inst) => {
            const live = liveStatus[inst.id];
            const isRunning = inst.status === "running";
            return (
              <div
                key={inst.id}
                className="border border-border rounded-lg bg-bg-card hover:border-accent transition-colors overflow-hidden"
              >
                <Link to={`/instances/${inst.id}`} className="block px-5 py-4">
                  <div className="flex items-center gap-3">
                    <span
                      className={`inline-block w-2.5 h-2.5 rounded-full shrink-0 ${
                        isRunning ? "bg-green" : "bg-red"
                      }`}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-3">
                        <span className="text-text text-base font-bold truncate">{inst.name}</span>
                        <span className="text-text-dim text-xs">#{inst.id}</span>
                        <span
                          className={`text-[10px] px-1.5 py-0.5 rounded uppercase tracking-wide ${
                            inst.mode === "autonomous"
                              ? "bg-accent/20 text-accent"
                              : "bg-bg-hover text-text-muted"
                          }`}
                        >
                          {inst.mode}
                        </span>
                      </div>
                      {inst.directive && (
                        <p className="text-text-muted text-xs mt-1 line-clamp-2">
                          {inst.directive}
                        </p>
                      )}
                      {live && (
                        <div className="flex items-center gap-4 mt-2 text-[10px] text-text-dim">
                          <span>{live.threads} threads</span>
                          <span>#{live.iter}</span>
                          <span>{live.rate}</span>
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {isRunning ? (
                        <button
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            handleStop(inst.id);
                          }}
                          className="px-3 py-1 border border-border rounded-lg text-xs text-text-muted hover:text-red hover:border-red transition-colors"
                        >
                          Stop
                        </button>
                      ) : (
                        <button
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            handleStart(inst.id);
                          }}
                          className="px-3 py-1 border border-accent rounded-lg text-xs text-accent hover:bg-accent hover:text-bg transition-colors"
                        >
                          Start
                        </button>
                      )}
                      <span className="text-text-dim text-xs">→</span>
                    </div>
                  </div>
                </Link>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
