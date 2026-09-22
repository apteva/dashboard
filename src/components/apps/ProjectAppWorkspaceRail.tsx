import { AppIcon } from "@apteva/ui-kit";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { NativePanelWorkspaceRailProps } from "./nativePanels";
import {
  ContributionManager,
  ContributionMount,
  contributionsFor,
  useEligibleContributionKeys,
  useProjectUILayout,
  widgetInstancesFor,
} from "./contributions";
import { useInstalledApps } from "./chatComponents";

const THREAD_SIDEBAR_SLOT = "dashboard.thread_sidebar";

/**
 * Host-owned workspace rail for native project pages. The app supplies its
 * Details view while the host owns contextual widgets and layout persistence.
 */
export function ProjectAppWorkspaceRail({
  projectId,
  agentId,
  threadId,
  context,
  children,
}: NativePanelWorkspaceRailProps) {
  const { t } = useTranslation();
  const [tab, setTab] = useState("details");
  const apps = useInstalledApps(projectId);
  const { project } = useProjectUILayout(projectId);
  const eligibleKeys = useEligibleContributionKeys(
    projectId,
    THREAD_SIDEBAR_SLOT,
    agentId,
    threadId,
  );
  const contributions = useMemo(
    () => contributionsFor(apps, THREAD_SIDEBAR_SLOT).filter(
      (item) => !eligibleKeys || eligibleKeys.has(item.key),
    ),
    [apps, eligibleKeys],
  );
  const widgets = widgetInstancesFor(contributions, THREAD_SIDEBAR_SLOT, project);
  const activeWidget = widgets.find((widget) => widget.id === tab);

  useEffect(() => {
    if (tab !== "details" && !widgets.some((widget) => widget.id === tab)) {
      setTab("details");
    }
  }, [tab, widgets]);

  return (
    <div className="flex h-full min-h-0 flex-col bg-bg" data-project-app-workspace-rail>
      <div
        className="flex h-10 shrink-0 items-end gap-4 border-b border-border px-4"
        role="tablist"
        aria-label="Conversation workspace"
      >
        <WorkspaceTab active={tab === "details"} onClick={() => setTab("details")}>
          {t("chat.panel.details")}
        </WorkspaceTab>
        {widgets.map((widget) => (
          <WorkspaceTab
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
          </WorkspaceTab>
        ))}
        <div className="ml-auto pb-1">
          <ContributionManager
            slot={THREAD_SIDEBAR_SLOT}
            projectId={projectId}
            agentId={agentId}
            threadId={threadId}
            label="+"
            compact
          />
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">
        {tab === "details" ? (
          <div className="h-full overflow-y-auto overscroll-contain">{children}</div>
        ) : activeWidget ? (
          <div className="h-full overflow-y-auto overscroll-contain p-3">
            <ContributionMount
              instance={activeWidget}
              apps={apps}
              slot={THREAD_SIDEBAR_SLOT}
              projectId={projectId}
              agentId={agentId}
              threadId={threadId}
              workspaceContext={context}
            />
          </div>
        ) : null}
      </div>
    </div>
  );
}

function WorkspaceTab({
  active,
  onClick,
  children,
  icon,
}: {
  active: boolean;
  onClick: () => void;
  children: string;
  icon?: ReactNode;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`flex h-10 min-w-0 items-center gap-1.5 border-b-2 text-[11px] font-bold ${
        active
          ? "border-accent text-text"
          : "border-transparent text-text-muted hover:text-text"
      }`}
    >
      {icon}
      <span className="max-w-24 truncate">{children}</span>
    </button>
  );
}
