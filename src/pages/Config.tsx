import { useState, useEffect } from "react";
import { core, type Status } from "../api";

export function Config() {
  const [directive, setDirective] = useState("");
  const [original, setOriginal] = useState("");
  const [status, setStatus] = useState<Status | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    core.config().then((c) => {
      setDirective(c.directive);
      setOriginal(c.directive);
    });
    core.status().then(setStatus);
  }, []);

  const handleSave = async () => {
    await core.updateConfig(directive);
    setOriginal(directive);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const hasChanges = directive !== original;

  return (
    <div className="flex flex-col h-full">
      <div className="border-b border-border px-4 py-3">
        <span className="text-text-muted text-xs">// CONFIG</span>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-6">
        {/* Directive */}
        <div>
          <label className="text-text-muted text-xs block mb-2">directive</label>
          <textarea
            value={directive}
            onChange={(e) => setDirective(e.target.value)}
            className="w-full h-40 bg-bg-input border border-border rounded p-3 text-sm text-text focus:outline-none focus:border-accent resize-none"
          />
          <div className="flex items-center gap-3 mt-2">
            <button
              onClick={handleSave}
              disabled={!hasChanges}
              className={`text-xs px-3 py-1.5 rounded transition-colors ${
                hasChanges
                  ? "bg-accent text-bg hover:bg-accent-hover"
                  : "bg-bg-hover text-text-muted cursor-not-allowed"
              }`}
            >
              save
            </button>
            {saved && <span className="text-green text-xs">saved ✓</span>}
            {hasChanges && <span className="text-accent text-xs">unsaved changes</span>}
          </div>
        </div>

        {/* Status */}
        {status && (
          <div>
            <label className="text-text-muted text-xs block mb-2">status</label>
            <div className="border border-border rounded p-4 bg-bg-card space-y-1">
              <div className="flex justify-between text-xs">
                <span className="text-text-muted">uptime</span>
                <span className="text-text">{Math.floor(status.uptime_seconds / 60)}m</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-text-muted">iteration</span>
                <span className="text-text">#{status.iteration}</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-text-muted">rate</span>
                <span className="text-text">{status.rate}</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-text-muted">model</span>
                <span className="text-text">{status.model}</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-text-muted">threads</span>
                <span className="text-text">{status.threads}</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-text-muted">memories</span>
                <span className="text-text">{status.memories}</span>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
