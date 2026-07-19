import { useEffect, useState } from "react";
import { chat, instances, type Agent, type ChatRow, type RealtimeAvailability } from "../../api";
import { ChatPanel } from "../ChatPanel";
import type { SubscribeFn } from "../AgentView";
import { useProjects } from "../../hooks/useProjects";

interface Props {
  instance: Agent;
  subscribe: SubscribeFn;
  realtime?: RealtimeAvailability;
}

export function AgentConversationPanel({ instance, subscribe, realtime }: Props) {
  const { currentProject } = useProjects();
  const [conversations, setConversations] = useState<ChatRow[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [projectAgents, setProjectAgents] = useState<Agent[]>([instance]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    chat.listChats(instance.id).then((rows) => {
      if (cancelled) return;
      const visible = rows.filter((row) => !row.id.startsWith("default-"));
      setConversations(visible);
      setConversationId(visible[0]?.id || null);
    }).catch((reason) => {
      if (!cancelled) {
        setConversations([]);
        setConversationId(null);
        setError(reason instanceof Error ? reason.message : String(reason));
      }
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, [instance.id]);

  useEffect(() => {
    const projectId = instance.project_id || currentProject?.id;
    if (!projectId) {
      setProjectAgents([instance]);
      return;
    }
    let cancelled = false;
    instances.list(projectId).then((rows) => {
      if (!cancelled) setProjectAgents(rows);
    }).catch(() => {
      if (!cancelled) setProjectAgents([instance]);
    });
    return () => { cancelled = true; };
  }, [currentProject?.id, instance.id, instance.name, instance.project_id, instance.status]);

  const selectedConversation = conversations.find((row) => row.id === conversationId);
  const selectedParticipants = selectedConversation
    ? projectAgents.filter((agent) => selectedConversation.agent_ids.includes(agent.id))
    : [instance];

  const createConversation = async () => {
    const projectId = instance.project_id || currentProject?.id;
    if (!projectId || creating) return;
    setCreating(true);
    setError(null);
    try {
      const created = await chat.createConversation(projectId, [instance.id], instance.name);
      setConversations((current) => [created, ...current.filter((row) => row.id !== created.id)]);
      setConversationId(created.id);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex min-h-10 items-center gap-2 border-b border-border px-3 py-1.5">
        <select
          value={conversationId || ""}
          onChange={(event) => setConversationId(event.target.value)}
          className="min-w-0 flex-1 rounded border border-border bg-bg-input px-2 py-1 text-xs text-text focus:border-accent focus:outline-none"
          aria-label="Conversation"
          disabled={conversations.length === 0}
        >
          {conversations.length === 0 && <option value="">No conversations</option>}
          {conversations.map((conversation) => <option key={conversation.id} value={conversation.id}>{conversation.title}</option>)}
        </select>
        <button type="button" onClick={() => void createConversation()} disabled={creating} className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded border border-border text-base text-accent hover:border-accent hover:bg-accent/10 disabled:opacity-40" title="New conversation" aria-label="New conversation">+</button>
      </div>
      <div className="min-h-0 flex-1">
        {conversationId ? (
          <ChatPanel
            key={conversationId}
            instanceId={instance.id}
            conversationId={conversationId}
            agentName={instance.name}
            agentNames={Object.fromEntries(selectedParticipants.map((agent) => [agent.id, agent.name]))}
            participantIds={selectedParticipants.map((agent) => agent.id)}
            subscribe={subscribe}
            realtime={realtime}
          />
        ) : (
          <div className="flex h-full items-center justify-center p-6">
            <div className="max-w-xs text-center">
              <div className="text-sm font-medium text-text">{loading ? "Loading conversations…" : "No conversation yet"}</div>
              {!loading && <p className="mt-1 text-xs text-text-muted">Start a conversation when you want to talk to this agent.</p>}
              {!loading && <button type="button" onClick={() => void createConversation()} disabled={creating} className="mt-4 rounded border border-accent px-3 py-2 text-xs font-semibold text-accent hover:bg-accent/10 disabled:opacity-40">{creating ? "Creating…" : "Start conversation"}</button>}
              {error && <div className="mt-3 text-xs text-red">{error}</div>}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
