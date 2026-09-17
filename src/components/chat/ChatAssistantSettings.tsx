import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useProjects } from "../../hooks/useProjects";
import { useAssistantDirectory, useAssistantPreferences } from "../../hooks/useChatAssistant";
import { targetKey, type AssistantPreferences } from "./assistantModel";

export function ChatAssistantSettings() {
  const { currentProject } = useProjects();
  const projectId = currentProject?.id || "";
  const { preferences, save, saveState } = useAssistantPreferences(projectId);
  const { directory, loading, error, refresh } = useAssistantDirectory(projectId);
  const [draft, setDraft] = useState<AssistantPreferences>(preferences);
  const signature = JSON.stringify(preferences);
  useEffect(() => { setDraft(JSON.parse(signature)); }, [signature, projectId]);
  if (!projectId) return <p className="text-sm text-text-muted">Select a project to configure its chat assistant.</p>;
  const available = !!directory?.contribution;
  const choices = directory?.choices || [];
  const defaultAvailable = choices.some((choice) => targetKey(choice.target) === targetKey(draft.defaultTarget));
  const fieldClass = "grid gap-2 text-sm text-text";
  return <div className="mx-auto max-w-3xl space-y-5">
    <header><h2 className="text-base font-bold text-text">Chat assistant</h2><p className="mt-1 text-sm text-text-muted">Your floating chat button in {currentProject?.name}. Preferences apply to your account in this project.</p></header>
    {loading && <p className="text-xs text-text-muted">Checking available agents…</p>}
    {error && <p role="alert" className="text-sm text-red">{error} <button onClick={refresh} className="underline">Retry</button></p>}
    {!loading && !available && <p className="rounded-lg border border-border p-4 text-sm text-text-muted">Requires Conversations to be installed and running in this project or globally. <Link to="/apps" className="text-accent">Manage apps</Link></p>}
    <section className="grid gap-6 rounded-lg border border-border bg-bg-card p-5">
      <label className="grid gap-1 text-sm text-text"><span className="flex items-center gap-3"><input type="checkbox" checked={draft.sharePageContext} onChange={event => setDraft({ ...draft, sharePageContext: event.target.checked })} />Share current page context</span><span className="text-xs text-text-muted">Shares project and page identifiers with each message, never page contents or form values. You can remove context above the composer.</span></label>
      <label className="flex items-center gap-3 text-sm text-text"><input type="checkbox" checked={draft.enabled} disabled={!available && !draft.enabled} onChange={(event) => setDraft({ ...draft, enabled: event.target.checked })} />Show floating chat button</label>
      <label className={fieldClass}>Default agent
        <select disabled={!available} value={targetKey(draft.defaultTarget)} onChange={(event) => {
          const choice = choices.find((item) => targetKey(item.target) === event.target.value);
          if (choice) setDraft({ ...draft, defaultTarget: choice.target, lastTarget: undefined });
        }} className="rounded-md border border-border bg-bg-input p-2">
          {!defaultAvailable && <option value={targetKey(draft.defaultTarget)}>{draft.defaultTarget.kind === "helper" ? "Apteva Helper — not available" : "Selected agent — not available"}</option>}
          {choices.map((choice) => <option key={targetKey(choice.target)} value={targetKey(choice.target)}>{choice.agent.name}</option>)}
        </select>
        <span className="text-xs text-text-muted">Only agents that can use Conversations appear here.</span>
      </label>
      <label className="flex items-center gap-3 text-sm text-text"><input type="checkbox" checked={draft.allowSwitching} onChange={(event) => setDraft({ ...draft, allowSwitching: event.target.checked, lastTarget: undefined })} />Allow switching agents in the panel</label>
      {draft.allowSwitching && <fieldset className="grid gap-3"><legend className="mb-3 text-xs text-text-muted">Agents available in the picker (your default is always included)</legend>
        <label className="flex items-center gap-3 text-sm text-text"><input type="checkbox" aria-label="Allow all agents in this project" checked={draft.allAgents} onChange={(event) => setDraft({ ...draft, allAgents: event.target.checked, lastTarget: undefined })} />Allow all agents in this project</label>
        {draft.allAgents && <p className="text-xs text-text-muted">Any eligible project agent will appear automatically.</p>}
        {choices.map((choice) => {
          const key = targetKey(choice.target);
          const isDefault = key === targetKey(draft.defaultTarget);
          if (draft.allAgents) return null;
          return <label key={key} className="flex items-center gap-3 text-sm text-text"><input type="checkbox" disabled={isDefault} checked={isDefault || draft.targets.some((target) => targetKey(target) === key)} onChange={(event) => setDraft({ ...draft, lastTarget: undefined, targets: event.target.checked ? [...draft.targets, choice.target] : draft.targets.filter((target) => targetKey(target) !== key) })} />{choice.agent.name}{isDefault && <span className="text-xs text-text-dim">Default</span>}</label>;
        })}
        <label className="mt-2 flex items-center gap-3 text-sm text-text"><input type="checkbox" checked={draft.rememberTarget} onChange={(event) => setDraft({ ...draft, rememberTarget: event.target.checked, lastTarget: undefined })} />Remember my last selected agent</label>
      </fieldset>}
      <div className="flex flex-wrap items-center gap-3 border-t border-border pt-4"><button type="button" disabled={saveState === "saving" || (draft.enabled && (!available || !defaultAvailable))} onClick={() => void save(draft)} className="rounded-md bg-accent px-4 py-2 text-sm font-semibold text-bg disabled:opacity-40">{saveState === "saving" ? "Saving…" : "Save chat assistant"}</button><span aria-live="polite" className={saveState === "error" ? "text-xs text-red" : "text-xs text-text-muted"}>{saveState === "saved" ? "Saved" : saveState === "error" ? "Could not save. Try again." : ""}</span></div>
    </section>
    <p className="text-xs leading-relaxed text-text-muted">Apteva Helper is an optional target. <Link to="/settings?tab=helper" className="text-accent">Configure Apteva Helper</Link> to activate it or change its model and capabilities. Other agents keep their own configuration.</p>
  </div>;
}
