import { AssistantConversation } from "../chat/AssistantConversation";
import { helperDraftRequest, helperWelcomeSettings, type HelperDraftRequest } from "../chat/conversationComposer";
import { Link } from "react-router-dom";
import { useEffect, useState } from "react";
import { ASSISTANT_CHAT_SLOT, useAssistantDirectory, useAssistantPreferences } from "../../hooks/useChatAssistant";
import { allowedAssistantChoices } from "../chat/assistantModel";
import type { SystemWidgetProps } from "./SystemWidgets";
import type { WidgetContext } from "../apps/widgetContext";

/** Hosts the existing Conversations contribution; owns no chat transport or history. */
export function HelperWidget(props: SystemWidgetProps) {
  const { context, actions } = props.renderContext || { context: props.widgetContext, actions: props.widgetActions };
  const { preferences } = useAssistantPreferences(context.projectId);
  const { directory, loading, error } = useAssistantDirectory(context.projectId || "", !!context.projectId);
  const helper = allowedAssistantChoices(preferences, directory?.choices || []).find(choice => choice.target.kind === "helper");
  const [draftRequest, setDraftRequest] = useState<HelperDraftRequest>();
  useEffect(() => { setDraftRequest(undefined); }, [context.projectId, context.pageId]);
  useEffect(() => {
    const receive = (event: Event) => {
      const detail = (event as CustomEvent<{ prompt?: string; context?: WidgetContext; handled?: boolean; inline?: boolean }>).detail;
      if (!detail || detail.handled || !detail.inline || detail.context?.projectId !== context.projectId || detail.context?.pageId !== context.pageId || !helper || !directory?.contribution) return;
      detail.handled = true; setDraftRequest(helperDraftRequest(detail.prompt, context.projectId!, helper.agent.id));
    };
    window.addEventListener("apteva:helper-prompt", receive);
    return () => window.removeEventListener("apteva:helper-prompt", receive);
  }, [helper, directory, context.projectId, context.pageId]);
  const selected = context.selected;
  return <section aria-label="Apteva Helper" className="flex h-full min-h-0 flex-col overflow-hidden rounded-lg border border-border bg-bg-card">
    <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border px-3 py-1">
      <button type="button" disabled={!helper || !context.projectId} title="Prepare an idea in Helper’s draft" className="min-h-9 text-xs font-semibold text-accent disabled:opacity-40" onClick={() => setDraftRequest(helperDraftRequest("I want to build something new in this project. Ask me what I want to achieve, then help me shape a small first version using the agents and apps available.", context.projectId!, helper!.agent.id))}>Start an idea →</button>
      <span className="text-[10px] text-text-dim">Review before sending</span>
    </div>
    {!context.projectId ? <p className="p-4 text-xs text-text-muted">Add Helper to a project page to choose its workspace.</p> : loading && !directory ? <p className="p-4 text-xs text-text-muted">Loading Helper…</p> : !helper || !directory?.contribution ? <div className="space-y-2 p-4 text-xs text-text-muted"><p>{error || "Helper needs to be enabled and available through Conversations for this project."}</p><Link className="inline-block text-accent" to="/settings?tab=helper">Helper settings →</Link><Link className="ml-3 inline-block text-accent" to="/settings?tab=chat-assistant">Chat assistant settings →</Link></div> : <>
      <div data-inline-workspace-helper={context.presentation === "workspace" ? "true" : undefined} className={context.presentation === "workspace" ? "workspace-chat min-h-0 flex-1 overflow-hidden" : "h-[min(560px,70dvh)] min-h-80 overflow-hidden"}><AssistantConversation key={`${context.projectId}:${context.pageId || "home"}:${helper.agent.id}`} draftRequest={draftRequest} onDismissDraft={() => setDraftRequest(undefined)} projectId={context.projectId} agentId={helper.agent.id} apps={directory.rows} slot={ASSISTANT_CHAT_SLOT}

        pageContext={preferences.sharePageContext ? { version: 1, page: selected?.type === "agent" ? "agent" : "dashboard", project_id: context.projectId, ...(selected?.type === "agent" ? { viewed_agent_id: Number(selected.id), viewed_agent_name: selected.label } : {}) } : undefined}
        widgetContext={preferences.sharePageContext ? { ...context, preview: undefined } : { scope: context.scope, projectId: context.projectId }} widgetActions={actions}
        instance={{ id: `page-helper:${context.pageId || "home"}`, component: directory.contribution.key, contribution: directory.contribution, size: "full", settings: { ...helperWelcomeSettings, experience: "personal", display_mode: "single", composer_layout: "compact", show_new_conversation: true, show_page_context: preferences.sharePageContext } }} /></div>
    </>}
  </section>;
}
