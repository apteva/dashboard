import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import {
  chat,
  type AlertMessageRow,
  type ApprovalMessageRow,
  type ChatMessageRow,
  type ReportMessageRow,
} from "../../api";
import { AptevaInbox } from "./AptevaInbox";

const approvalMessage: ChatMessageRow = {
  id: 41,
  chat_id: "internal-agent-14",
  role: "agent",
  agent_id: 14,
  thread_id: "chat-conv-patreon",
  status: "final",
  content: "Approval requested: Publish Patreon update",
  created_at: "2026-07-27T14:30:00Z",
  components: [{
    app: "channel-chat",
    name: "approval-card",
    props: {
      message_id: 41,
      title: "Publish Patreon update",
      body: "Publish the July update to all paid Patreon members.",
      status: "pending",
      actions: [
        { id: "approve", label: "Approve", style: "primary" },
        { id: "deny", label: "Deny", style: "danger" },
      ],
    },
  }],
};

const approvalRow: ApprovalMessageRow = {
  message: approvalMessage,
  instance_id: 14,
  instance_name: "Patreon Agent",
  project_id: "default",
  title: "Publish Patreon update",
  body: "Publish the July update to all paid Patreon members.",
  status: "pending",
};

function reportRow(id: number): ReportMessageRow {
  return {
    message: {
      ...approvalMessage,
      id,
      content: `Report ${id}`,
      components: [{ app: "channel-chat", name: "report-card", props: { title: `Report ${id}` } }],
    },
    instance_id: 14,
    instance_name: "Patreon Agent",
    project_id: "default",
    title: `Report ${id}`,
    summary: `Report summary ${id}`,
  };
}

const alertRow: AlertMessageRow = {
  message: {
    ...approvalMessage,
    id: 2,
    content: "Publishing is blocked",
    components: [{ app: "channel-chat", name: "alert-card", props: { title: "Publishing is blocked", severity: "error" } }],
  },
  instance_id: 14,
  instance_name: "Patreon Agent",
  project_id: "default",
  title: "Publishing is blocked",
  body: "The publishing credential expired.",
  severity: "error",
};

const originalApprovalMessages = chat.approvalMessages;
const originalReportMessages = chat.reportMessages;
const originalAlertMessages = chat.alertMessages;
const originalMessageAction = chat.messageAction;
const originalMessageDismiss = chat.messageDismiss;

afterEach(() => {
  cleanup();
  chat.approvalMessages = originalApprovalMessages;
  chat.reportMessages = originalReportMessages;
  chat.alertMessages = originalAlertMessages;
  chat.messageAction = originalMessageAction;
  chat.messageDismiss = originalMessageDismiss;
});

describe("AptevaInbox approvals", () => {
  test("ranks the complete inbox before applying the Home display limit", async () => {
    const requestedLimits: number[] = [];
    chat.approvalMessages = (async (_projectId, _status, limit) => {
      requestedLimits.push(limit ?? -1);
      return [{ ...approvalRow, message: { ...approvalMessage, id: 1 } }];
    }) as typeof chat.approvalMessages;
    chat.alertMessages = (async (_projectId, limit) => {
      requestedLimits.push(limit ?? -1);
      return [alertRow];
    }) as typeof chat.alertMessages;
    chat.reportMessages = (async (_projectId, limit) => {
      requestedLimits.push(limit ?? -1);
      return [101, 102, 103, 104, 105, 106].map(reportRow);
    }) as typeof chat.reportMessages;

    const { container } = render(
      <MemoryRouter><AptevaInbox allProjects limit={5} variant="home" /></MemoryRouter>,
    );

    await waitFor(() => expect(screen.getByText("View all 8 →")).toBeTruthy());
    expect(requestedLimits).toEqual([100, 100, 100]);
    const visibleTitles = Array.from(container.querySelectorAll("article"))
      .map((row) => row.textContent || "");
    expect(visibleTitles).toHaveLength(5);
    expect(visibleTitles[0]).toContain("Publish Patreon update");
    expect(visibleTitles[1]).toContain("Publishing is blocked");
    expect(visibleTitles[2]).toContain("Report 106");
    expect(screen.queryByText("Report 101")).toBeNull();
    expect(screen.getByText("3 more items across all projects →")).toBeTruthy();
  });

  test("opens Monitor with the same explicit project scope", async () => {
    chat.approvalMessages = (async () => []) as typeof chat.approvalMessages;
    chat.reportMessages = (async () => []) as typeof chat.reportMessages;
    chat.alertMessages = (async () => []) as typeof chat.alertMessages;

    render(
      <MemoryRouter><AptevaInbox projectId="project with space" variant="home" /></MemoryRouter>,
    );
    await waitFor(() => expect(screen.getByText("You're all caught up")).toBeTruthy());
    expect(screen.getByRole("link", { name: "View operations →" }).getAttribute("href"))
      .toBe("/monitor?project=project%20with%20space");
  });

  test("stretches with neighboring Home widgets instead of capping its height", async () => {
    chat.approvalMessages = (async () => []) as typeof chat.approvalMessages;
    chat.reportMessages = (async () => []) as typeof chat.reportMessages;
    chat.alertMessages = (async () => []) as typeof chat.alertMessages;

    const { container } = render(<MemoryRouter><AptevaInbox variant="home" /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText("You're all caught up")).toBeTruthy());
    const panel = container.querySelector("section");
    expect(panel?.className).toContain("h-full");
    expect(panel?.className).toContain("xl:min-h-[520px]");
    expect(panel?.className).not.toContain("xl:h-[60vh]");
    expect(panel?.className).not.toContain("xl:max-h-[680px]");
  });

  test("keeps Dismiss on the row and moves decisions into Review with feedback", async () => {
    chat.approvalMessages = (async () => [approvalRow]) as typeof chat.approvalMessages;
    chat.reportMessages = (async () => []) as typeof chat.reportMessages;
    chat.alertMessages = (async () => []) as typeof chat.alertMessages;
    const actions: Array<{ messageId: number; actionId: string; note?: string }> = [];
    chat.messageAction = (async (messageId, actionId, note) => {
      actions.push({ messageId, actionId, note });
      const approved: ChatMessageRow = {
        ...approvalMessage,
        components: [{
          app: "channel-chat",
          name: "approval-card",
          props: {
            ...(approvalMessage.components?.[0]?.props || {}),
            status: "approved",
            decision: { action_id: actionId, status: "approved", note },
          },
        }],
      };
      return { message: approved, status: "approved", forwarded: true };
    }) as typeof chat.messageAction;

    render(<AptevaInbox allProjects />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Review" })).toBeTruthy();
    });
    expect(screen.getByRole("button", { name: "Dismiss" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Approve" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Deny" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Review" }));
    expect(screen.getAllByText("Publish the July update to all paid Patreon members.")).toHaveLength(2);
    fireEvent.input(screen.getByRole("textbox"), {
      target: { value: "Approve after verifying all links." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));

    await waitFor(() => {
      expect(actions).toEqual([{
        messageId: 41,
        actionId: "approve",
        note: "Approve after verifying all links.",
      }]);
    });
  });

  test("dismisses a pending approval without deciding it", async () => {
    chat.approvalMessages = (async () => [approvalRow]) as typeof chat.approvalMessages;
    chat.reportMessages = (async () => []) as typeof chat.reportMessages;
    chat.alertMessages = (async () => []) as typeof chat.alertMessages;
    const dismissed: number[] = [];
    chat.messageDismiss = (async (messageId) => {
      dismissed.push(messageId);
      return { message: approvalMessage, dismissed: true };
    }) as typeof chat.messageDismiss;

    render(<AptevaInbox allProjects />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Dismiss" })).toBeTruthy();
    });
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));

    await waitFor(() => {
      expect(dismissed).toEqual([41]);
    });
  });
});
