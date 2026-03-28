import { useState, useEffect } from "react";
import { core, type Thread } from "../api";
import { StatusDot } from "../components/StatusDot";

export function Threads() {
  const [threads, setThreads] = useState<Thread[]>([]);

  useEffect(() => {
    const poll = () => core.threads().then(setThreads).catch(() => {});
    poll();
    const interval = setInterval(poll, 3000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="flex flex-col h-full">
      <div className="border-b border-border px-4 py-3">
        <span className="text-text-muted text-xs">// THREADS</span>
        <span className="text-text-dim text-xs ml-3">{threads.length} active</span>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {threads.length === 0 && (
          <div className="text-text-muted text-xs">no threads running</div>
        )}
        {threads.map((t) => (
          <div key={t.id} className="border border-border rounded p-4 bg-bg-card hover:bg-bg-hover transition-colors">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <StatusDot status={t.rate} />
                <span className="text-text font-bold text-sm">{t.id}</span>
              </div>
              <span className="text-text-muted text-xs">
                {t.rate}/{t.model} #{t.iteration}
              </span>
            </div>

            {t.directive && (
              <div className="text-text-dim text-xs mb-2 truncate">
                {t.directive}
              </div>
            )}

            {t.tools && t.tools.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {t.tools.map((tool) => (
                  <span
                    key={tool}
                    className="text-xs px-1.5 py-0.5 bg-bg rounded border border-border text-text-muted"
                  >
                    {tool}
                  </span>
                ))}
              </div>
            )}

            <div className="text-text-muted text-xs mt-2">{t.age}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
