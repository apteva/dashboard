// Compact agent tile grid for the project root dashboard. One tile
// per instance in the current project; click → /instances/:id. The
// goal is "I can see all my agents at once" without the controls
// /create form weight that lives on /agents.
//
// Status is communicated by a coloured dot and a tone class on the
// border. Live activity (chat unread, errored thread) layers on top.

import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { instances, type Instance } from "../../api";
import { useProjects } from "../../hooks/useProjects";
import { notifications } from "../../state/notifications";

const REFRESH_MS = 5000;

export function AgentsGrid() {
  const { currentProject } = useProjects();
  const projectId = currentProject?.id;

  const [list, setList] = useState<Instance[]>([]);
  const [unread, setUnread] = useState<Map<number, number>>(new Map());

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      instances.list(projectId).then((l) => {
        if (!cancelled) setList(l);
      }).catch(() => {});
    };
    load();
    const t = setInterval(load, REFRESH_MS);
    return () => { cancelled = true; clearInterval(t); };
  }, [projectId]);

  // Subscribe to the chat-unread notification stream so a freshly
  // arrived message lights up the corresponding tile without needing
  // a list refresh tick. Notifications are keyed by `chat:default-<id>`
  // (see chatNotifications.ts); we extract the instance id and total
  // unread per id. The store is a pure observer with `() => void`
  // listeners — we recompute from getSnapshot() on every tick.
  useEffect(() => {
    const recompute = () => {
      const m = new Map<number, number>();
      for (const n of notifications.getSnapshot()) {
        const match = n.id.match(/^chat:default-(\d+)$/);
        if (!match || !match[1]) continue;
        const id = parseInt(match[1], 10);
        if (!Number.isFinite(id)) continue;
        m.set(id, (m.get(id) || 0) + Math.max(1, n.count || 0));
      }
      setUnread(m);
    };
    recompute();
    return notifications.subscribe(recompute);
  }, []);

  if (list.length === 0) {
    return (
      <div className="border border-border rounded-lg p-6 flex items-center justify-center min-h-[180px]">
        <div className="text-center">
          <div className="text-text-dim text-sm mb-2">No agents yet</div>
          <Link
            to="/agents"
            className="text-accent text-sm hover:underline"
          >
            Create your first agent →
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="border border-border rounded-lg p-3">
      <div className="flex items-center justify-between mb-3 px-1">
        <div className="text-xs text-text-dim uppercase tracking-wide">
          Agents · {list.length}
        </div>
        <Link
          to="/agents"
          className="text-xs text-text-muted hover:text-text"
        >
          manage →
        </Link>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
        {list.map((inst) => (
          <AgentTile
            key={inst.id}
            instance={inst}
            unread={unread.get(inst.id) || 0}
          />
        ))}
      </div>
    </div>
  );
}

function AgentTile({ instance, unread }: { instance: Instance; unread: number }) {
  const running = instance.status === "running";
  const dot = running ? "bg-green" : "bg-text-dim";
  const border = running ? "border-border" : "border-border-dim";

  return (
    <Link
      to={`/instances/${instance.id}`}
      className={`relative block border ${border} rounded-md p-2.5 hover:bg-bg-hover transition-colors group`}
      title={`${instance.name} · ${instance.status}`}
    >
      <div className="flex items-center gap-1.5 mb-1">
        <div className={`w-1.5 h-1.5 rounded-full ${dot}`} />
        <span className="text-[10px] uppercase tracking-wide text-text-dim">
          {instance.mode}
        </span>
      </div>
      <div className="text-sm text-text font-medium truncate">{instance.name}</div>
      <div className="text-[11px] text-text-muted mt-0.5">#{instance.id}</div>
      {unread > 0 && (
        <div className="absolute top-1.5 right-1.5 min-w-[18px] h-[18px] px-1 rounded-full bg-accent text-bg text-[10px] font-bold flex items-center justify-center">
          {unread > 99 ? "99+" : unread}
        </div>
      )}
    </Link>
  );
}
