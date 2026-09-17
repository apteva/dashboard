import { apps, auth, platformHelper, type AppRow, type WorkspaceSetupDraft } from "../api";
import { contributionsFor, fetchEligibleContributionKeys } from "../components/apps/contributions";

async function conversationRequest(path: string, query: URLSearchParams, body: unknown) {
  const response = await fetch(`/api/apps/conversations/${path}?${query}`, {
    method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`Could not open Helper's setup conversation. Please try again. (${response.status})`);
  return response.json();
}

export async function openWorkspaceHelper(userId: number, projectId: string, draft: WorkspaceSetupDraft, onProgress?: (message: string) => void) {
  const status = await platformHelper.status();
  if (!status.conversations_installed) {
    onProgress?.("Preparing Conversations for AI setup…");
    let preparing = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      try {
        const current = await auth.onboardingStatus();
        if (preparing && current.workspace_preparation?.status !== "not_installed" && current.workspace_preparation?.message) onProgress?.(current.workspace_preparation.message);
      } catch { /* The preparation request reports actionable errors. */ }
      if (preparing) timer = setTimeout(poll, 750);
    };
    void poll();
    try { await auth.prepareOnboarding("ai"); }
    finally { preparing = false; clearTimeout(timer); }
  }
  onProgress?.("Opening your conversation with Apteva Helper…");
  if (!status.activated) await platformHelper.activate(false);
  const helper = await platformHelper.get();
  if (helper.status !== "running") throw new Error("Apteva Helper could not start. Please try again.");
  const rows = await apps.list(projectId);
  const contribution = contributionsFor(rows, "dashboard.build").find((item) =>
    item.app.name === "conversations" && item.spec.name === "agent-conversations" && !(item.app as AppRow).project_id,
  );
  if (!contribution) throw new Error("Conversations is not ready. Please try again.");
  const eligible = await fetchEligibleContributionKeys(projectId, "dashboard.build", helper.id);
  if (!eligible.has(contribution.key)) throw new Error("Conversations is not attached to Apteva Helper. Check Helper settings and retry.");
  const query = new URLSearchParams({ project_id: projectId, install_id: String(contribution.app.install_id) });
  const key = `workspace-setup:${userId}:${projectId}`;
  const conversation = await conversationRequest("chats", query, {
    agent_id: helper.id, project_id: projectId, title: "Set up my workspace", conversation_key: key, audience: "operator",
  });
  if (!conversation.id) throw new Error("Helper's setup conversation is not ready. Please try again.");
  window.dispatchEvent(new Event("apteva:helper-changed"));
  return { helper, rows, contribution, conversationId: String(conversation.id) };
}
