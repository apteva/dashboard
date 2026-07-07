import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  instances,
  platformHelper,
  type Agent,
  type ChatMessageContext,
} from "../api";
import { ChatPanel } from "../components/ChatPanel";
import type { EventListener, SubscribeFn } from "../components/AgentView";
import { usePageTitle } from "../hooks/usePageTitle";
import { useProjects } from "../hooks/useProjects";

export function Build() {
  const { currentProject } = useProjects();
  const [helper, setHelper] = useState<Agent | null>(null);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  usePageTitle("Build");

  const messageContext = useMemo<ChatMessageContext>(
    () => ({
      source: "dashboard-build",
      project_id: currentProject?.id,
      project_name: currentProject?.name,
      route: "/build",
      title: "Build",
      detail: "Project build workspace",
      page_kind: "build",
      chips: ["dashboard", "build", "project"],
    }),
    [currentProject?.id, currentProject?.name],
  );

  const subscribeHelper = useCallback<SubscribeFn>(
    (listener: EventListener) => {
      if (typeof window === "undefined" || !helper?.id) return () => {};
      return window.__aptevaTelemetryBus?.subscribe(helper.id, listener) ?? (() => {});
    },
    [helper?.id],
  );

  const loadHelper = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const row = await platformHelper.get();
      setHelper(row);
    } catch (e) {
      setHelper(null);
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadHelper();
  }, [loadHelper]);

  const startHelper = async () => {
    if (!helper) return;
    setStarting(true);
    setError(null);
    try {
      await instances.start(helper.id);
      await loadHelper();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setStarting(false);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <div className="shrink-0 border-b border-border px-4 py-3 sm:px-6">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h1 className="truncate text-lg font-bold text-text">Build</h1>
            <div className="mt-0.5 flex min-w-0 items-center gap-2 text-xs text-text-muted">
              <span className="truncate">{currentProject?.name || "Current project"}</span>
              {helper && (
                <>
                  <span className="text-text-dim">-</span>
                  <span className="truncate">{helper.name}</span>
                  <StatusDot status={helper.status} />
                </>
              )}
            </div>
          </div>
          {helper && (
            <Link
              to={`/agents/${helper.id}`}
              className="shrink-0 rounded border border-border px-2.5 py-1.5 text-xs text-text-muted hover:bg-bg-hover hover:text-text"
            >
              Open helper
            </Link>
          )}
        </div>
      </div>

      {error && (
        <div className="shrink-0 border-b border-red/40 bg-red/10 px-4 py-2 text-xs text-red sm:px-6">
          {error}
        </div>
      )}

      <div className="min-h-0 flex-1">
        {loading ? (
          <div className="flex h-full items-center justify-center text-sm text-text-muted">
            Loading...
          </div>
        ) : helper && helper.status !== "running" ? (
          <div className="flex h-full items-center justify-center p-4">
            <div className="flex w-full max-w-lg items-center justify-between gap-3 border border-border bg-bg-card p-3">
              <span className="text-xs text-text-muted">Apteva Helper is stopped.</span>
              <button
                type="button"
                onClick={startHelper}
                disabled={starting}
                className="rounded border border-accent px-3 py-1.5 text-xs font-semibold text-accent hover:bg-accent hover:text-bg disabled:opacity-50"
              >
                {starting ? "Starting..." : "Start"}
              </button>
            </div>
          </div>
        ) : helper ? (
          <div className="mx-auto flex h-full w-full max-w-5xl flex-col border-x border-border">
            <ChatPanel
              key={helper.id}
              instanceId={helper.id}
              subscribe={subscribeHelper}
              autoConnect
              messageContext={messageContext}
              historyLimit={100}
            />
          </div>
        ) : (
          <div className="flex h-full items-center justify-center p-4 text-sm text-text-muted">
            Apteva Helper is unavailable.
          </div>
        )}
      </div>
    </div>
  );
}

function StatusDot({ status }: { status: string }) {
  const cls =
    status === "running"
      ? "bg-green"
      : status === "stopped"
        ? "bg-text-dim"
        : "bg-yellow";
  return <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${cls}`} title={status} />;
}

function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  try {
    return JSON.stringify(e);
  } catch {
    return String(e);
  }
}
