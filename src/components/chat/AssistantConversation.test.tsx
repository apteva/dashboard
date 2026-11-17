import { afterAll, afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { StrictMode, useEffect, useState } from "react";
import type { ConversationComposerHandle, HelperDraftRequest } from "./conversationComposer";
import { helperDraftRequest, helperWelcomeSettings } from "./conversationComposer";

const original = { ...await import("../apps/contributions") };
let ready = true;
let status = "applied";
let reject = false;
const insert = mock(async (_text: string, _options: any) => {});
const sent = mock(() => {});
mock.module("../apps/contributions", () => ({ ...original, ContributionMount: (props: any) => {
  const [draft, setDraft] = useState("Existing draft");
  useEffect(() => {
    if (!ready) return;
    const handle: ConversationComposerHandle = { insertText: async (text, options) => {
      await insert(text, options);
      if (reject) throw new Error("Unavailable");
      if (status === "applied") setDraft(current => `${current} ${text}`);
      return { requestId: options!.requestId!, status };
    } };
    props.composerRef?.(handle);
    return () => props.composerRef?.(null);
  }, [props.composerRef, ready]);
  return <><textarea aria-label="Conversation draft" value={draft} onChange={e => setDraft(e.target.value)} /><button onClick={sent}>Send</button></>;
} }));
const { AssistantConversation } = await import("./AssistantConversation");
const mount = { projectId: "p1", agentId: 1, apps: [], slot: "dashboard.build", instance: {} as any };
const request: HelperDraftRequest = { id: "request-1", projectId: "p1", agentId: 1, text: "Adjust this output" };
beforeEach(() => { ready = true; status = "applied"; reject = false; insert.mockClear(); sent.mockClear(); });
afterEach(cleanup);
afterAll(() => mock.module("../apps/contributions", () => original));

describe("Conversations host draft bridge", () => {
  test("Strict Mode inserts once and acknowledges the draft", async () => {
    render(<StrictMode><AssistantConversation {...mount} draftRequest={request} onDismissDraft={() => {}} /></StrictMode>);
    await screen.findByText("Added to your draft. Review it before sending.");
    expect(insert).toHaveBeenCalledTimes(1);
  });
  test("inserts once with exact scope and preserves existing draft without sending", async () => {
    const view = render(<AssistantConversation {...mount} draftRequest={request} onDismissDraft={() => {}} />);
    await screen.findByText("Added to your draft. Review it before sending.");
    expect((screen.getByLabelText("Conversation draft") as HTMLTextAreaElement).value).toBe("Existing draft Adjust this output");
    expect(insert.mock.calls[0]).toEqual([request.text, { requestId: request.id, projectId: "p1", agentId: 1, focus: true }]);
    view.rerender(<AssistantConversation {...mount} draftRequest={{ ...request }} onDismissDraft={() => {}} />);
    expect(insert).toHaveBeenCalledTimes(1);
    expect(sent).not.toHaveBeenCalled();
  });
  test("waits for a lazily mounted composer and retains a copy fallback", async () => {
    ready = false;
    const view = render(<AssistantConversation {...mount} draftRequest={request} onDismissDraft={() => {}} />);
    expect(screen.getByRole("button", { name: "Copy suggestion" })).toBeTruthy();
    expect(insert).not.toHaveBeenCalled();
    ready = true;
    view.rerender(<AssistantConversation {...mount} draftRequest={request} onDismissDraft={() => {}} />);
    await screen.findByText("Added to your draft. Review it before sending.");
    expect(insert).toHaveBeenCalledTimes(1);
  });
  test("does not insert a request belonging to a different project or agent", () => {
    const view = render(<AssistantConversation {...mount} projectId="p2" draftRequest={request} onDismissDraft={() => {}} />);
    view.rerender(<AssistantConversation {...mount} agentId={2} draftRequest={request} onDismissDraft={() => {}} />);
    expect(insert).not.toHaveBeenCalled();
    expect(screen.queryByLabelText("Suggested message")).toBeNull();
  });
  for (const [code, message] of [
    ["wrong_project", "This conversation belongs to another project."],
    ["wrong_agent", "This conversation is for another agent."],
    ["conversation_not_open", "Open or create a conversation"],
    ["archived", "This conversation is archived."],
    ["voice_active", "Finish the voice session"],
  ]) test(`keeps a recoverable suggestion for ${code}`, async () => {
    status = code!;
    render(<AssistantConversation {...mount} draftRequest={request} onDismissDraft={() => {}} />);
    await screen.findByText(new RegExp(message!));
    expect(screen.getByRole("button", { name: "Copy suggestion" })).toBeTruthy();
    status = "applied";
    fireEvent.click(screen.getByRole("button", { name: "Try inserting again" }));
    await screen.findByText("Added to your draft. Review it before sending.");
    expect(insert.mock.calls[1]?.[1].requestId).toBe(request.id);
    expect(sent).not.toHaveBeenCalled();
  });
  test("already_applied is acknowledged and unexpected errors remain copyable", async () => {
    status = "already_applied";
    const view = render(<AssistantConversation {...mount} draftRequest={request} onDismissDraft={() => {}} />);
    await screen.findByText("Added to your draft. Review it before sending.");
    reject = true;
    view.rerender(<AssistantConversation {...mount} draftRequest={{ ...request, id: "request-2" }} onDismissDraft={() => {}} />);
    await screen.findByText(/The suggestion could not be inserted/);
    expect(screen.getByLabelText("Suggested message")).toBeTruthy();
  });
  test("dismissal clears fallback and ignores a late acknowledgement", async () => {
    let finish!: () => void;
    insert.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
    const view = render(<AssistantConversation {...mount} draftRequest={request} onDismissDraft={() => {}} />);
    await waitFor(() => expect(insert).toHaveBeenCalled());
    view.rerender(<AssistantConversation {...mount} onDismissDraft={() => {}} />);
    await act(async () => finish());
    expect(screen.queryByText("Added to your draft. Review it before sending.")).toBeNull();
  });
  test("each user action gets a distinct request ID; starters contain only prompts", () => {
    expect(helperDraftRequest("same", "p1", 1).id).not.toBe(helperDraftRequest("same", "p1", 1).id);
    expect(helperWelcomeSettings.suggestions).toHaveLength(3);
    expect(helperWelcomeSettings.suggestions.every(item => item.id && item.label && item.text)).toBe(true);
  });
});
