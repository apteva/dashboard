import { useState } from "react";
import type { Agent, ChatRow } from "../../api";
import { AppContributionArea } from "../apps/contributions";
import { AgentContextCard } from "./AgentContextCard";
import { ConversationDetails } from "./ConversationDetails";

type ContextTab = "details" | "apps";

export function ConversationContextPanel({
  conversation,
  agents,
  instance,
  onChanged,
  onRemoved,
}: {
  conversation: ChatRow;
  agents: Agent[];
  instance: Agent;
  onChanged: (conversation: ChatRow) => void;
  onRemoved: (conversationId: string) => void;
}) {
  const [tab, setTab] = useState<ContextTab>("details");

  return (
    <div className="flex h-full min-h-0 flex-col bg-bg">
      <div
        className="flex h-10 shrink-0 items-end gap-4 border-b border-border px-4"
        role="tablist"
        aria-label="Conversation context"
      >
        <ContextTabButton
          active={tab === "details"}
          onClick={() => setTab("details")}
        >
          Details
        </ContextTabButton>
        <ContextTabButton
          active={tab === "apps"}
          onClick={() => setTab("apps")}
        >
          Apps
        </ContextTabButton>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">
        {tab === "details" ? (
          <div className="h-full overflow-y-auto overscroll-contain">
            <ConversationDetails
              key={conversation.id}
              conversation={conversation}
              agents={agents}
              onChanged={onChanged}
              onRemoved={onRemoved}
            />
            <AgentContextCard instance={instance} chatId={conversation.id} />
          </div>
        ) : (
          <div className="h-full overflow-y-auto overscroll-contain">
            <AppContributionArea
              slot="dashboard.thread_sidebar"
              projectId={conversation.project_id}
              agentId={instance.id}
              threadId={conversation.thread_id}
              className="block"
              empty={
                <p className="p-4 text-xs text-text-dim">
                  No app components are available for this thread.
                </p>
              }
            />
          </div>
        )}
      </div>
    </div>
  );
}

function ContextTabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: string;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`h-10 border-b-2 text-[11px] font-bold ${active ? "border-accent text-text" : "border-transparent text-text-muted hover:text-text"}`}
    >
      {children}
    </button>
  );
}
