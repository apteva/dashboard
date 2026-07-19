import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import "../../i18n";
import { chat, type ChatRow } from "../../api";
import { ConversationDetails } from "./ConversationDetails";

const first: ChatRow = {
  id: "conv-first",
  instance_id: 286,
  agent_ids: [286],
  project_id: "project-1",
  kind: "direct",
  title: "First conversation",
  created_at: "2026-07-18T10:00:00Z",
  updated_at: "2026-07-18T10:00:00Z",
};

const second: ChatRow = {
  ...first,
  id: "conv-second",
  title: "Second conversation",
};

const originalDeleteConversation = chat.deleteConversation;

afterEach(() => {
  cleanup();
  chat.deleteConversation = originalDeleteConversation;
});

describe("ConversationDetails", () => {
  test("keeps deletion bound to its conversation and closes the modal before selecting the next one", async () => {
    let finishDelete!: () => void;
    chat.deleteConversation = (() => new Promise((resolve) => {
      finishDelete = () => resolve({ deleted: true });
    })) as typeof chat.deleteConversation;

    function Harness() {
      const [conversation, setConversation] = useState(first);
      return (
        <ConversationDetails
          key={conversation.id}
          conversation={conversation}
          agents={[]}
          onChanged={setConversation}
          onRemoved={() => setConversation(second)}
        />
      );
    }

    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(screen.getByRole("dialog", { name: "Delete conversation" })).toBeTruthy();

    const deleteButtons = screen.getAllByRole("button", { name: "Delete" });
    fireEvent.click(deleteButtons[deleteButtons.length - 1]!);

    const pendingDialog = screen.getByRole("dialog", { name: "Delete conversation" });
    expect(pendingDialog.textContent).toContain("First conversation");
    expect(screen.queryByDisplayValue("Second conversation")).toBeNull();
    expect(screen.getByRole("button", { name: "Deleting…" }).hasAttribute("disabled")).toBe(true);

    finishDelete();

    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "Delete conversation" })).toBeNull();
      expect(screen.getByDisplayValue("Second conversation")).toBeTruthy();
    });
  });
});
