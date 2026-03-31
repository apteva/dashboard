import { useState, useEffect, useRef } from "react";
import { instances, type Instance, type TelemetryEvent } from "../api";
import { useSSE } from "../hooks/useSSE";
import { useProjects } from "../hooks/useProjects";

export function Events() {
  const { currentProject } = useProjects();
  const [instance, setInstance] = useState<Instance | null>(null);

  useEffect(() => {
    instances
      .list(currentProject?.id)
      .then((list) => setInstance(list.length > 0 ? list[0] : null))
      .catch(() => {});
  }, [currentProject?.id]);

  const events = useSSE(instance?.id ?? null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [events]);

  const typeColor = (type: string) => {
    if (type.startsWith("llm.")) return "text-accent";
    if (type === "thread.spawn") return "text-green";
    if (type === "thread.done" || type.includes("error")) return "text-red";
    if (type === "thread.message") return "text-blue";
    if (type === "tool.pending") return "text-yellow";
    if (type === "tool.approved") return "text-green";
    if (type === "tool.rejected") return "text-red";
    if (type.startsWith("tool.")) return "text-text-muted";
    if (type === "mode.changed") return "text-blue";
    return "text-text-dim";
  };

  const formatDetail = (e: TelemetryEvent): string => {
    const d = e.data || {};
    switch (e.type) {
      case "llm.done":
        return d.tokens_in
          ? `${d.tokens_in}→${d.tokens_out} tok · ${d.duration_ms}ms${d.cost_usd ? ` · $${d.cost_usd.toFixed(4)}` : ""}`
          : "";
      case "tool.call":
      case "tool.pending":
      case "tool.approved":
      case "tool.rejected":
        return d.name ? `${d.name}${d.args && typeof d.args === "object" ? `(${formatArgs(d.args)})` : ""}` : "";
      case "tool.result": {
        const status = d.success ? "ok" : "FAIL";
        return `${d.name} · ${status} · ${d.duration_ms}ms`;
      }
      case "thread.spawn":
        return d.directive ? `spawned — ${d.directive}` : "spawned";
      case "thread.done":
        return d.result || "done";
      case "thread.message":
        return `${d.from} → ${d.to}`;
      case "llm.error":
        return d.error || "";
      case "mode.changed":
        return d.mode || "";
      default:
        return d.message || d.result || d.error || "";
    }
  };

  const formatArgs = (args: Record<string, string>): string => {
    const entries = Object.entries(args);
    if (entries.length === 0) return "";
    return entries
      .map(([k, v]) => {
        const val = typeof v === "string" && v.length > 40 ? v.slice(0, 40) + "…" : v;
        return `${k}=${val}`;
      })
      .join(", ");
  };

  return (
    <div className="flex flex-col h-full">
      <div className="border-b border-border px-4 py-3 flex items-center justify-between">
        <div>
          <span className="text-text-muted text-xs">// EVENTS</span>
          {instance && <span className="text-text-dim text-xs ml-3">{instance.name}</span>}
          <span className="text-text-dim text-xs ml-3">{events.length} events</span>
        </div>
        {instance && <span className="text-green text-xs">● live</span>}
        {!instance && <span className="text-text-dim text-xs">no instance</span>}
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 font-mono">
        {!instance && (
          <div className="text-text-muted text-xs">No running instance found.</div>
        )}
        {instance && events.length === 0 && (
          <div className="text-text-muted text-xs">waiting for events...</div>
        )}
        {events.map((e, i) => {
          const time = e.time ? new Date(e.time).toLocaleTimeString() : "";
          const detail = formatDetail(e);
          const result = e.type === "tool.result" && e.data?.result;

          return (
            <div key={i} className="py-0.5 hover:bg-bg-hover">
              <div className="flex gap-3 text-xs">
                <span className="text-text-muted w-16 shrink-0">{time}</span>
                <span className={`w-24 shrink-0 font-bold ${typeColor(e.type)}`}>{e.type}</span>
                <span className="text-text-dim w-16 shrink-0 truncate">{e.thread_id}</span>
                <span className="text-text truncate">{detail}</span>
              </div>
              {result && (
                <div className="ml-[13.5rem] text-xs text-text-dim truncate opacity-70">
                  ↳ {typeof result === "string" && result.length > 120 ? result.substring(0, 120) + "..." : result}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
