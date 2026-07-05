// Main pane for /chat — header above an embedded ChatPanel.

import { useCallback } from "react";
import { ChatPanel } from "../ChatPanel";
import type { Agent } from "../../api";
import type { SubscribeFn } from "../AgentView";
import { Link } from "react-router-dom";

interface Props {
  chatId: string | null;
  instance: Agent | null;
  onToggleRightPane: () => void;
  rightPaneOpen: boolean;
}

export function ChatMain({
  chatId,
  instance,
  onToggleRightPane,
  rightPaneOpen,
}: Props) {
  const instanceId = instance?.id;
  const subscribe = useCallback<SubscribeFn>(
    (listener) => {
      if (typeof instanceId !== "number") return () => {};
      return window.__aptevaTelemetryBus?.subscribe(instanceId, listener) ?? (() => {});
    },
    [instanceId],
  );

  if (!chatId || !instance) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center">
          <div className="text-text-dim text-sm mb-1">No chat selected</div>
          <div className="text-text-muted text-xs">
            Pick an agent on the left, or press <kbd className="px-1 bg-bg-input rounded">⌘K</kbd>
          </div>
        </div>
      </div>
    );
  }

  const running = instance.status === "running";

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex items-center gap-3 px-4 py-3 border-b border-border">
        <span
          className={`w-2 h-2 rounded-full shrink-0 ${
            running ? "bg-green" : "bg-text-dim"
          }`}
          title={instance.status}
        />
        <div className="flex-1 min-w-0">
          <div className="text-sm text-text font-medium truncate">{instance.name}</div>
          <div className="text-[11px] text-text-muted">
            #{instance.id} · {instance.mode} · {instance.status}
          </div>
        </div>
        <div className="flex items-center gap-1">
          <Link
            to={`/agents/${instance.id}`}
            className="text-xs text-text-muted hover:text-text border border-border rounded px-2 py-1"
            title="Open agent page"
          >
            agent →
          </Link>
          <button
            onClick={onToggleRightPane}
            className="hidden lg:inline-block text-xs text-text-muted hover:text-text border border-border rounded px-2 py-1"
            title={rightPaneOpen ? "Hide context pane" : "Show context pane"}
          >
            {rightPaneOpen ? "›" : "‹"}
          </button>
        </div>
      </div>

      <div className="flex-1 min-h-0">
        <ChatPanel
          key={chatId /* reset state when switching chats */}
          instanceId={instance.id}
          subscribe={subscribe}
          autoConnect
        />
      </div>
    </div>
  );
}
