import { AppIcon } from "@apteva/ui-kit";
import { useEffect, useMemo, useState } from "react";
import type { Agent, ChatRow } from "../../api";
import {
  ContributionManager,
  ContributionMount,
  contributionsFor,
  useEligibleContributionKeys,
  useProjectUILayout,
  widgetInstancesFor,
} from "../apps/contributions";
import { useInstalledApps } from "../apps/chatComponents";
import { AgentContextCard } from "./AgentContextCard";
import { ConversationDetails } from "./ConversationDetails";

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
  const [tab, setTab] = useState("details");
  const apps = useInstalledApps(conversation.project_id);
  const { project } = useProjectUILayout(conversation.project_id);
  const eligibleKeys = useEligibleContributionKeys(
    conversation.project_id,
    "dashboard.thread_sidebar",
    instance.id,
    conversation.thread_id,
  );
  const contributions = useMemo(
    () => contributionsFor(apps, "dashboard.thread_sidebar").filter(
      (item) => !eligibleKeys || eligibleKeys.has(item.key),
    ),
    [apps, eligibleKeys],
  );
  const widgets = widgetInstancesFor(
    contributions,
    "dashboard.thread_sidebar",
    project,
  );
  const activeWidget = widgets.find((widget) => widget.id === tab);

  useEffect(() => {
    if (tab !== "details" && !widgets.some((widget) => widget.id === tab)) {
      setTab("details");
    }
  }, [tab, widgets]);

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
        {widgets.map((widget) => (
          <ContextTabButton
            key={widget.id}
            active={tab === widget.id}
            onClick={() => setTab(widget.id)}
            icon={
              <AppIcon
                name={widget.contribution.app.display_name || widget.contribution.app.name}
                src={widget.contribution.app.icon}
                iconStyle={widget.contribution.app.icon_style}
                size="xs"
              />
            }
          >
            {widget.contribution.spec.label || widget.contribution.spec.name}
          </ContextTabButton>
        ))}
        <div className="ml-auto pb-1">
          <ContributionManager
            slot="dashboard.thread_sidebar"
            projectId={conversation.project_id}
            agentId={instance.id}
            threadId={conversation.thread_id}
            label="+"
            compact
          />
        </div>
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
        ) : activeWidget ? (
          <div className="h-full overflow-y-auto overscroll-contain p-3">
            <ContributionMount
              instance={activeWidget}
              apps={apps}
              slot="dashboard.thread_sidebar"
              projectId={conversation.project_id}
              agentId={instance.id}
              threadId={conversation.thread_id}
            />
          </div>
        ) : null}
      </div>
    </div>
  );
}

function ContextTabButton({
  active,
  onClick,
  children,
  icon,
}: {
  active: boolean;
  onClick: () => void;
  children: string;
  icon?: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`flex h-10 min-w-0 items-center gap-1.5 border-b-2 text-[11px] font-bold ${active ? "border-accent text-text" : "border-transparent text-text-muted hover:text-text"}`}
    >
      {icon}
      <span className="max-w-24 truncate">{children}</span>
    </button>
  );
}
