import { useState, useEffect } from "react";
import { core, providers } from "../api";
import { useProjects } from "../hooks/useProjects";

// ComputerPanel mirrors the CLI `/computer` command in the dashboard. It
// shows the current browser/computer environment attached to a running
// instance and lets the user switch between off / local / browserbase /
// service (existing CDP). Credentials never reach the client — the user
// picks a mode and the server enriches the PUT with the matching saved
// provider's data before forwarding to the core.
//
// Renders nothing when the instance is stopped, same as MCPPanel. The core
// hot-attaches/detaches in place; no restart needed.

interface Props {
  instanceId: number;
  running: boolean;
}

type Mode = "off" | "local" | "browserbase" | "service";

interface CurrentState {
  type: string; // "" when off
  connected: boolean;
  width?: number;
  height?: number;
}

export function ComputerPanel({ instanceId, running }: Props) {
  const { currentProject } = useProjects();
  const [current, setCurrent] = useState<CurrentState>({ type: "", connected: false });
  const [hasBrowserbase, setHasBrowserbase] = useState(false);
  const [hasLocal, setHasLocal] = useState(false);
  const [hasCDP, setHasCDP] = useState(false); // saved "service" via CDP_URL
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // Service / CDP URL input shows up only when the user picks "service"
  // and there's no saved provider for it.
  const [showCDPInput, setShowCDPInput] = useState(false);
  const [cdpURL, setCDPURL] = useState("");

  const loadCurrent = () => {
    if (!running) {
      setCurrent({ type: "", connected: false });
      return;
    }
    core
      .config(instanceId)
      .then((c) => {
        if (c.computer && c.computer.connected) {
          setCurrent({
            type: c.computer.type || "",
            connected: true,
            width: c.computer.display?.width,
            height: c.computer.display?.height,
          });
        } else {
          setCurrent({ type: "", connected: false });
        }
      })
      .catch(() => {});
  };

  // Detect activated providers so the chips only show what's actually
  // available in this project. Each activated provider maps to exactly
  // one chip via its provider_type_id (8 = Browserbase, 11 = Local
  // Browser, 12 = Remote CDP). Anything else is hidden — the user
  // hasn't set it up, so showing it would just produce an error on
  // click. The "off" chip is always present.
  const loadProviders = () => {
    providers
      .list(currentProject?.id)
      .then((rows) => {
        let bb = false;
        let local = false;
        let cdp = false;
        for (const p of rows || []) {
          switch (p.provider_type_id) {
            case 8:
              bb = true;
              break;
            case 11:
              local = true;
              break;
            case 12:
              cdp = true;
              break;
          }
        }
        setHasBrowserbase(bb);
        setHasLocal(local);
        setHasCDP(cdp);
      })
      .catch(() => {});
  };

  useEffect(() => {
    loadCurrent();
    loadProviders();
    if (!running) return;
    // Poll every 5s so the panel reflects state if another client (CLI,
    // another dashboard tab) flips the computer config out from under us.
    const t = setInterval(loadCurrent, 5000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [instanceId, running, currentProject?.id]);

  if (!running) return null;

  const setMode = async (mode: Mode) => {
    setBusy(true);
    setError("");
    try {
      if (mode === "off") {
        await core.setComputer(instanceId, { type: "" });
      } else if (mode === "local") {
        await core.setComputer(instanceId, { type: "local" });
      } else if (mode === "browserbase") {
        await core.setComputer(instanceId, { type: "browserbase" });
      } else if (mode === "service") {
        if (cdpURL.trim()) {
          await core.setComputer(instanceId, {
            type: "service",
            url: cdpURL.trim(),
          });
          setShowCDPInput(false);
          setCDPURL("");
        } else if (hasCDP) {
          await core.setComputer(instanceId, { type: "service" });
        } else {
          setShowCDPInput(true);
          setBusy(false);
          return;
        }
      }
      loadCurrent();
    } catch (err: any) {
      setError(err?.message || "Failed to update computer");
    } finally {
      setBusy(false);
    }
  };

  const isActive = (mode: Mode): boolean => {
    if (mode === "off") return !current.connected;
    return current.connected && current.type === mode;
  };

  // Render a single mode chip. Only modes with an activated provider
  // get rendered (filtering happens in the parent), so we no longer
  // need disabled / badge state — every visible chip is clickable.
  const ModeChip = ({ mode, label }: { mode: Mode; label: string }) => {
    const active = isActive(mode);
    return (
      <button
        onClick={() => setMode(mode)}
        disabled={busy}
        className={`text-[10px] px-2 py-1 rounded transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
          active
            ? "bg-accent text-bg font-bold"
            : "bg-bg-hover text-text-muted hover:text-text"
        }`}
        title={`Switch to ${label}`}
      >
        {label}
      </button>
    );
  };

  return (
    <div className="px-4 py-3 border-b border-border">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-text-muted font-bold uppercase tracking-wide text-[10px]">
          Computer
        </h3>
        {current.connected && current.width && current.height && (
          <span className="text-text-dim text-[10px]">
            {current.width}×{current.height}
          </span>
        )}
      </div>

      {error && <div className="text-red text-[10px] mb-2">{error}</div>}

      {/* Status line */}
      <div className="flex items-center gap-1.5 mb-2">
        <span
          className={`w-1.5 h-1.5 rounded-full shrink-0 ${
            current.connected ? "bg-green" : "bg-text-dim"
          }`}
        />
        <span className="text-text text-[11px]">
          {current.connected ? current.type || "connected" : "disconnected"}
        </span>
      </div>

      {/* Mode chips — only show modes that have a saved provider in this
          project. "off" is always available. If no browser provider exists
          at all, render a hint pointing to Settings → Providers. */}
      <div className="flex flex-wrap gap-1.5">
        <ModeChip mode="off" label="off" />
        {hasLocal && <ModeChip mode="local" label="local" />}
        {hasBrowserbase && <ModeChip mode="browserbase" label="browserbase" />}
        {hasCDP && <ModeChip mode="service" label="service" />}
      </div>
      {!hasLocal && !hasBrowserbase && !hasCDP && (
        <p className="text-text-dim text-[10px] mt-2">
          No browser provider activated — add one in Settings → Providers →
          Browser.
        </p>
      )}

      {/* CDP URL input — appears when the user picks "service" without a
          saved provider. Submitted on Enter or via the inline button. */}
      {showCDPInput && (
        <div className="mt-2 flex gap-1">
          <input
            value={cdpURL}
            onChange={(e) => setCDPURL(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                setMode("service");
              } else if (e.key === "Escape") {
                setShowCDPInput(false);
                setCDPURL("");
              }
            }}
            autoFocus
            placeholder="ws://… or http://… (CDP endpoint)"
            className="flex-1 bg-bg-input border border-border rounded px-2 py-1 text-[10px] text-text font-mono focus:outline-none focus:border-accent min-w-0"
          />
          <button
            onClick={() => setMode("service")}
            disabled={busy || !cdpURL.trim()}
            className="text-[10px] px-2 py-1 bg-accent text-bg rounded font-bold hover:bg-accent-hover disabled:opacity-40"
          >
            connect
          </button>
        </div>
      )}
    </div>
  );
}
