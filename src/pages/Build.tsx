import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { apps, platformHelper, type Agent, type AppRow } from "../api";
import {
  ContributionMount,
  contributionsFor,
  fetchEligibleContributionKeys,
  type Contribution,
  type ResolvedWidgetInstance,
} from "../components/apps/contributions";
import { usePageTitle } from "../hooks/usePageTitle";
import { useProjects } from "../hooks/useProjects";

const BUILD_SLOT = "dashboard.build";
const BUILD_COMPONENT = "agent-conversations";

interface BuildSurface {
  rows: AppRow[];
  instance: ResolvedWidgetInstance;
}

export function selectBuildConversationsContribution(
  rows: AppRow[],
  projectId: string,
): Contribution | null {
  const matches = contributionsFor(rows, BUILD_SLOT).filter(
    (item) => item.app.name === "conversations" && item.spec.name === BUILD_COMPONENT,
  );
  return (
    matches.find((item) => (item.app as AppRow).project_id === projectId) ||
    matches.find((item) => !(item.app as AppRow).project_id) ||
    null
  );
}

export function Build() {
  usePageTitle("Build");
  const navigate = useNavigate();
  const { currentProject } = useProjects();
  const projectId = currentProject?.id || "";
  const [surface, setSurface] = useState<BuildSurface | null>(null);
  const [helper, setHelper] = useState<Agent | null>(null);
  const [loading, setLoading] = useState(true);
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    if (!projectId) {
      setSurface(null);
      setHelper(null);
      setLoading(false);
      setUnavailable(true);
      return;
    }

    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setUnavailable(false);
      setSurface(null);
      setHelper(null);
      try {
        // Resolving the platform Helper is the activation check on this API;
        // activated Helpers are also started lazily by this request.
        const activeHelper = await platformHelper.get();
        if (cancelled) return;

        const rows = await apps.list(projectId);
        if (cancelled) return;
        const contribution = selectBuildConversationsContribution(rows, projectId);
        if (!contribution) {
          setUnavailable(true);
          return;
        }

        const eligible = await fetchEligibleContributionKeys(
          projectId,
          BUILD_SLOT,
          activeHelper.id,
        );
        if (cancelled) return;
        if (!eligible.has(contribution.key)) {
          setHelper(activeHelper);
          setUnavailable(true);
          return;
        }

        setHelper(activeHelper);
        setSurface({
          rows,
          instance: {
            id: `build:${contribution.key}:${activeHelper.id}`,
            component: contribution.key,
            size: "full",
            settings: {},
            contribution,
          },
        });
      } catch {
        if (!cancelled) setUnavailable(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void load();
    const reload = () => void load();
    window.addEventListener("apteva:apps-changed", reload);
    return () => {
      cancelled = true;
      window.removeEventListener("apteva:apps-changed", reload);
    };
  }, [navigate, projectId]);

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-bg">
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3 sm:px-6">
        <div className="min-w-0">
          <h1 className="text-lg font-bold text-text">Build</h1>
          <p className="mt-0.5 text-xs text-text-muted">
            Work with Apteva Helper through Conversations.
          </p>
        </div>
        {helper && (
          <div className="inline-flex items-center gap-2 rounded-md border border-border px-2.5 py-1.5 text-[10px] font-semibold text-text-muted">
            <span className={`h-1.5 w-1.5 rounded-full ${helper.status === "running" ? "bg-green" : "bg-text-dim"}`} />
            {helper.name} · {helper.status}
          </div>
        )}
      </header>

      <main className="min-h-0 flex-1 overflow-hidden">
        {loading ? (
          <BuildState title="Loading Build…" detail="Opening Conversations and Apteva Helper." />
        ) : surface && helper ? (
          <ContributionMount
            instance={surface.instance}
            apps={surface.rows}
            slot={BUILD_SLOT}
            projectId={projectId}
            agentId={helper.id}
          />
        ) : unavailable ? (
          <BuildState
            title="Conversations is unavailable"
            detail="Build needs the Agent conversations component attached to Apteva Helper. Install or attach Conversations, then return here."
            action={{ to: "/apps", label: "Open Apps" }}
          />
        ) : (
          <BuildState title="Build is unavailable" detail="The Conversations component could not be resolved." />
        )}
      </main>
    </div>
  );
}

function BuildState({
  title,
  detail,
  action,
}: {
  title: string;
  detail: string;
  action?: { to: string; label: string };
}) {
  return (
    <div className="grid h-full place-items-center p-6">
      <div className="max-w-lg text-center">
        <h2 className="text-base font-bold text-text">{title}</h2>
        <p className="mt-2 text-sm leading-relaxed text-text-muted">{detail}</p>
        {action && (
          <Link
            to={action.to}
            className="mt-5 inline-flex h-9 items-center rounded-md bg-accent px-4 text-xs font-bold text-bg hover:bg-accent-hover"
          >
            {action.label}
          </Link>
        )}
      </div>
    </div>
  );
}
