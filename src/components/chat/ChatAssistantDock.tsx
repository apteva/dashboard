import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useProjects } from "../../hooks/useProjects";
import { ASSISTANT_CHAT_SLOT, useAssistantDirectory, useAssistantPreferences } from "../../hooks/useChatAssistant";
import { ContributionMount } from "../apps/contributions";
import { useRealtimeVoice } from "../../state/RealtimeVoiceContext";
import { instances } from "../../api";
import { AgentMark } from "../AgentMark";
import { ChatAgentPicker } from "./ChatAgentPicker";
import { useAssistantPageContext } from "./pageContext";
import { allowedAssistantChoices, initialAssistantTarget, targetKey } from "./assistantModel";

export function ChatAssistantDock() {
  const { currentProject } = useProjects();
  const projectId = currentProject?.id || "";
  return <ProjectChatAssistant key={projectId} projectId={projectId} />;
}
function ProjectChatAssistant({ projectId }: { projectId: string }) {
  const { currentProject } = useProjects();
  const pageContext = useAssistantPageContext(projectId, currentProject?.name);
  const { preferences, save } = useAssistantPreferences(projectId);
  const { session: voiceSession } = useRealtimeVoice();
  const { directory, loading, error, refresh } = useAssistantDirectory(projectId, preferences.enabled);
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState("");
  const panel = useRef<HTMLDialogElement>(null);
  const launcher = useRef<HTMLButtonElement>(null);
  const choices = allowedAssistantChoices(preferences, directory?.choices || []);
  const activeKey = selected || initialAssistantTarget(preferences, directory?.choices || []);
  useEffect(() => { setStartError(""); }, [activeKey]);
  const choice = choices.find((item) => targetKey(item.target) === activeKey);
  const available = preferences.enabled && !!directory?.contribution;
  // A preference change must not leave a previously allowed target mounted.
  const configuration = JSON.stringify([preferences.defaultTarget, preferences.allowSwitching, preferences.targets]);
  useEffect(() => { setSelected(null); }, [configuration]);
  useEffect(() => { if (!available) setOpen(false); }, [available]);
  useEffect(() => {
    if (open && available) { panel.current?.show(); panel.current?.focus(); }
    else panel.current?.close();
    return () => { panel.current?.close(); };
  }, [open, available]);
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented) setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);
  if (!available) return null;
  return <>
    <button ref={launcher} type="button" onClick={() => { setSelected(null); refresh(); setOpen(true); }} className="floating-chat-launcher-safe touch-target fixed z-40 flex h-12 w-12 items-center justify-center rounded-full border border-accent/50 bg-accent text-bg shadow-xl hover:bg-accent-hover" title="Chat assistant" aria-label="Open chat assistant" aria-haspopup="dialog">
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.4 8.4 0 0 1 3.8-.9h.5a8.5 8.5 0 0 1 8 8v.5Z" /></svg>
    </button>
    <dialog ref={panel} tabIndex={-1} aria-label="Chat assistant" onCancel={() => setOpen(false)} onClose={() => { setOpen(false); launcher.current?.focus(); }} className={`fixed inset-auto right-0 z-50 m-0 w-full max-w-full overflow-hidden rounded-t-xl border border-border bg-bg p-0 text-text shadow-2xl sm:right-4 sm:w-[520px] sm:max-w-[calc(100vw-2rem)] sm:rounded-xl ${voiceSession ? "bottom-40 h-[min(620px,calc(100dvh-12rem))]" : "bottom-0 h-[90dvh] max-h-[90dvh] sm:bottom-4 sm:h-[min(720px,85dvh)]"}`}>
      {open && <div className="flex h-full min-h-0 flex-col">
        <header className="flex min-h-14 shrink-0 items-center gap-2 border-b border-border px-3">
          <AgentMark size="sm" />
          {preferences.allowSwitching && (choices.length > 1 || (!choice && choices.length > 0)) ? <ChatAgentPicker choices={choices} activeKey={activeKey} onSelect={(next) => {
            setSelected(targetKey(next.target));
            if (preferences.rememberTarget) void save({ ...preferences, lastTarget: next.target });
          }} /> : <h2 className="min-w-0 flex-1 truncate text-sm font-semibold">{choice?.agent.name || "Chat assistant"}</h2>}
          <Link to="/settings?tab=chat-assistant" onClick={() => setOpen(false)} className="flex h-10 w-10 shrink-0 items-center justify-center rounded text-text-muted hover:text-text" aria-label="Chat assistant settings" title="Chat assistant settings">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true"><path d="M4 7h16M4 17h16M9 4v6M15 14v6" /></svg>
          </Link>
          <button type="button" onClick={() => setOpen(false)} className="h-10 w-10 shrink-0 rounded text-xl text-text-muted hover:bg-bg-hover" aria-label="Close chat assistant">×</button>
        </header>
        {error && <p role="alert" className="p-3 text-sm text-red">{error}</p>}
        {choice?.agent.status && choice.agent.status !== "running" && <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2 text-xs text-text-muted">
          <span className="flex-1">Agent {choice.agent.status}</span>
          <button type="button" disabled={starting} onClick={async () => {
            setStarting(true); setStartError("");
            try { await instances.start(choice.agent.id); refresh(); }
            catch (reason) { setStartError(reason instanceof Error ? reason.message : "Could not start agent."); }
            finally { setStarting(false); }
          }} className="rounded border border-accent px-3 py-1.5 text-accent disabled:opacity-40">{starting ? "Starting…" : "Start agent"}</button>
          {startError && <span role="alert" className="w-full text-red">{startError}</span>}
        </div>}
        {choice && directory?.contribution ? <div className="min-h-0 flex-1 overflow-hidden"><ContributionMount key={`${projectId}:${choice.agent.id}`} projectId={projectId} agentId={choice.agent.id} pageContext={preferences.sharePageContext ? pageContext : undefined} slot={ASSISTANT_CHAT_SLOT} apps={directory.rows} instance={{ id: `chat-assistant:${choice.agent.id}`, component: directory.contribution.key, contribution: directory.contribution, size: "full", settings: { experience: "personal", display_mode: "single", composer_layout: "compact", show_new_conversation: true, show_page_context: false } }} /></div>
          : <p className="p-5 text-sm text-text-muted">{loading ? "Checking agent availability…" : "This agent is unavailable. Choose another agent or update Chat assistant settings."}</p>}
      </div>}
    </dialog>
  </>;
}
