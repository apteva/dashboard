import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { instances, core, type Instance as InstanceType, type Thread } from "../api";
import { InstanceView } from "../components/InstanceView";

// Instance is the per-id wrapper. Resolves :id from the URL, fetches the
// instance metadata + preloaded threads, and hands off to InstanceView.
// On delete, navigates back to the list at /.
export function Instance() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [instance, setInstance] = useState<InstanceType | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [preloadedThreads, setPreloadedThreads] = useState<Thread[]>([]);
  const [notFound, setNotFound] = useState(false);

  const instanceId = id ? parseInt(id, 10) : 0;

  const load = () => {
    if (!instanceId) return;
    instances
      .get(instanceId)
      .then((inst) => {
        setInstance(inst);
        setLoaded(true);
        setNotFound(false);
        if (inst.status === "running") {
          core.threads(inst.id).then(setPreloadedThreads).catch(() => {});
        } else {
          setPreloadedThreads([]);
        }
      })
      .catch(() => {
        setLoaded(true);
        setNotFound(true);
      });
  };

  useEffect(() => {
    setInstance(null);
    setLoaded(false);
    setNotFound(false);
    setPreloadedThreads([]);
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [instanceId]);

  if (!loaded) return null;

  if (notFound || !instance) {
    return (
      <div className="flex flex-col h-full">
        <div className="border-b border-border px-6 py-4">
          <h1 className="text-text text-lg font-bold">Instance not found</h1>
        </div>
        <div className="flex-1 p-6">
          <p className="text-text-muted text-sm">
            No instance with id <code className="text-text">#{instanceId}</code> in this project.
          </p>
          <button
            onClick={() => navigate("/")}
            className="mt-4 px-4 py-2 border border-border rounded-lg text-sm text-text-muted hover:text-text transition-colors"
          >
            ← Back to instances
          </button>
        </div>
      </div>
    );
  }

  return (
    <InstanceView
      instance={instance}
      initialThreads={preloadedThreads}
      onDelete={async () => {
        await instances.delete(instance.id);
        navigate("/");
      }}
      onReload={load}
    />
  );
}
