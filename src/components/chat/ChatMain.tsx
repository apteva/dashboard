// Conversation pane for /chat. ChatPanel owns the single integrated header so
// connection state and conversation actions never create a second mobile bar.

import { useCallback, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ChatPanel } from "../ChatPanel";
import { Modal } from "../Modal";
import { AgentContextCard } from "./AgentContextCard";
import type { Agent } from "../../api";
import type { SubscribeFn } from "../AgentView";
import { useRealtimeAvailability } from "../../hooks/useRealtimeAvailability";

interface Props {
  chatId: string | null;
  instance: Agent | null;
  onBack: () => void;
  onToggleRightPane: () => void;
  rightPaneOpen: boolean;
}

export function ChatMain({
  chatId,
  instance,
  onBack,
  onToggleRightPane,
  rightPaneOpen,
}: Props) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [contextOpen, setContextOpen] = useState(false);
  const instanceId = instance?.id;
  const realtime = useRealtimeAvailability(instanceId, instance?.status === "running");
  const subscribe = useCallback<SubscribeFn>(
    (listener) => {
      if (typeof instanceId !== "number") return () => {};
      return window.__aptevaTelemetryBus?.subscribe(instanceId, listener) ?? (() => {});
    },
    [instanceId],
  );

  if (!chatId || !instance) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <div className="text-center">
          <button type="button" onClick={onBack} className="touch-target mb-4 rounded-lg border border-border px-4 text-sm text-text md:hidden">
            Back to conversations
          </button>
          <div className="mb-1 text-sm text-text-dim">{t("chat.main.noChatSelected")}</div>
          <div className="text-xs text-text-muted">{t("chat.main.pickAgent")}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <div className="min-h-0 flex-1 overflow-hidden">
        <ChatPanel
          key={chatId}
          instanceId={instance.id}
          agentName={instance.name}
          realtime={realtime}
          subscribe={subscribe}
          autoConnect
          header={{
            title: instance.name,
            subtitle: `#${instance.id} · ${instance.mode} · ${instance.status}`,
            running: instance.status === "running",
            onBack,
            onOpenAgent: () => navigate(`/agents/${instance.id}`),
            onOpenContext: () => setContextOpen(true),
            onToggleDesktopContext: onToggleRightPane,
            desktopContextOpen: rightPaneOpen,
          }}
        />
      </div>

      <Modal open={contextOpen} onClose={() => setContextOpen(false)} width="max-w-md" ariaLabel={`${instance.name} context`}>
        <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
          <div className="min-w-0">
            <div className="text-[10px] font-bold uppercase tracking-wide text-accent">Agent context</div>
            <h2 className="mt-0.5 truncate text-base font-semibold text-text">{instance.name}</h2>
          </div>
          <button type="button" onClick={() => setContextOpen(false)} className="touch-target inline-flex h-11 w-11 items-center justify-center rounded text-xl text-text-muted hover:bg-bg-hover hover:text-text" aria-label="Close context">
            ×
          </button>
        </div>
        <div className="page-safe-bottom min-h-0 overflow-y-auto">
          <AgentContextCard instance={instance} chatId={chatId} />
        </div>
      </Modal>
    </div>
  );
}
