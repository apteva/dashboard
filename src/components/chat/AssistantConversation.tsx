import { useCallback, useEffect, useRef, useState, type ComponentProps } from "react";
import { ContributionMount } from "../apps/contributions";
import { HelperPromptSuggestion } from "./HelperPromptSuggestion";
import { composerFallbackReason, type ConversationComposerHandle, type HelperDraftRequest } from "./conversationComposer";

type Props = ComponentProps<typeof ContributionMount> & {
  draftRequest?: HelperDraftRequest;
  onDismissDraft: () => void;
};

/** Host-only bridge. Conversations owns the draft, history and send operation. */
export function AssistantConversation({ draftRequest, onDismissDraft, ...mount }: Props) {
  const [handle, setHandle] = useState<ConversationComposerHandle | null>(null);
  const composerRef = useCallback((value: ConversationComposerHandle | null) => setHandle(() => value), []);
  const [result, setResult] = useState<{ id: string; status: string }>();
  const [retry, setRetry] = useState(0);
  const attempted = useRef(new Set<string>());
  const activeRequest = useRef(draftRequest);
  const mounted = useRef(true);
  const releaseRequest = useRef(onDismissDraft);
  activeRequest.current = draftRequest;
  releaseRequest.current = onDismissDraft;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const matches = draftRequest?.projectId === mount.projectId && draftRequest?.agentId === mount.agentId;

  useEffect(() => {
    if (!draftRequest || !matches || !handle) return;
    const attempt = `${draftRequest.id}:${retry}`;
    if (attempted.current.has(attempt)) return;
    attempted.current.add(attempt);
    setResult({ id: draftRequest.id, status: "inserting" });
    void (async () => {
      try {
        const value = await handle.insertText(draftRequest.text, {
          requestId: draftRequest.id, projectId: draftRequest.projectId, agentId: draftRequest.agentId, focus: true,
        });
        if (!mounted.current || activeRequest.current?.id !== draftRequest.id) return;
        const status = value.requestId === draftRequest.id ? value.status : "error";
        setResult({ id: draftRequest.id, status });
        // Consumed requests must not be replayed after the chat is remounted.
        if (status === "applied" || status === "already_applied") releaseRequest.current();
      } catch {
        if (mounted.current && activeRequest.current?.id === draftRequest.id) setResult({ id: draftRequest.id, status: "error" });
      }
    })();
  }, [draftRequest, matches, handle, retry]);

  const status = !draftRequest || result?.id === draftRequest.id ? result?.status : "unavailable";
  const applied = status === "applied" || status === "already_applied";
  return <div className="flex h-full min-h-0 flex-col">
    {applied && (!draftRequest || matches) && <div role="status" className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-3 py-2 text-xs text-text-muted">
      <span>Added to your draft. Review it before sending.</span>
      <button type="button" className="min-h-9 text-accent" onClick={() => { setResult(undefined); onDismissDraft(); }}>Dismiss</button>
    </div>}
    {draftRequest && matches && !applied && (status === "inserting" ? <p role="status" className="shrink-0 px-3 py-2 text-xs text-text-muted">Adding to your draft…</p> :
      <HelperPromptSuggestion key={draftRequest.id} text={draftRequest.text} reason={composerFallbackReason(status || "unavailable")} onDismiss={onDismissDraft} onRetry={handle ? () => setRetry(value => value + 1) : undefined} />)}
    <div className="min-h-0 flex-1 overflow-hidden"><ContributionMount {...mount} composerRef={composerRef} /></div>
  </div>;
}
