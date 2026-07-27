import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { chat, type ChatMessageRow } from "../../api";
import { ChatComponentMount } from "./chatComponents";

const originalMessageAction = chat.messageAction;

afterEach(() => {
  cleanup();
  chat.messageAction = originalMessageAction;
});

describe("chat approval cards", () => {
  test("uses the same review modal and sends feedback with either decision", async () => {
    const calls: Array<{ messageId: number; actionId: string; note?: string }> = [];
    const updated: ChatMessageRow = {
      id: 73,
      chat_id: "conv-approval",
      role: "agent",
      status: "final",
      content: "Approval requested",
      created_at: "2026-07-27T14:30:00Z",
      components: [],
    };
    chat.messageAction = (async (messageId, actionId, note) => {
      calls.push({ messageId, actionId, note });
      return { message: updated, status: "denied", forwarded: true };
    }) as typeof chat.messageAction;

    render(
      <ChatComponentMount
        comp={{
          app: "channel-chat",
          name: "approval-card",
          props: {
            title: "Replace the production campaign",
            body: "Replace the active campaign with the newly generated version.",
          },
        }}
        apps={[]}
        projectId="default"
        messageId={73}
      />,
    );

    expect(screen.queryByRole("button", { name: "Approve" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Deny" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Review" }));

    fireEvent.input(screen.getByRole("textbox"), {
      target: { value: "Do not replace it until legal reviews the copy." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Deny" }));

    await waitFor(() => {
      expect(calls).toEqual([{
        messageId: 73,
        actionId: "deny",
        note: "Do not replace it until legal reviews the copy.",
      }]);
    });
  });
});
