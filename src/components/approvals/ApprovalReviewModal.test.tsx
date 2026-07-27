import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import {
  ApprovalReviewModal,
  parseApprovalReview,
} from "./ApprovalReviewModal";

afterEach(cleanup);

describe("ApprovalReviewModal", () => {
  test("shows the complete request and sends optional feedback with approval", async () => {
    const calls: Array<{ actionId: string; note: string }> = [];
    const approval = parseApprovalReview({
      title: "Publish the Patreon update",
      body: "Approve publishing the completed July update to all paid members. Denying leaves the draft unpublished.",
      context: {
        audience: "Paid members",
        scheduled_for: "Today at 16:00 UTC",
      },
    });

    render(
      <ApprovalReviewModal
        open
        approval={approval}
        agentName="Publishing Agent"
        requestedAt="Jul 27, 2026, 3:30 PM"
        onClose={() => {}}
        onAction={async (actionId, note) => {
          calls.push({ actionId, note });
        }}
      />,
    );

    expect(screen.getByRole("dialog", { name: "Review approval: Publish the Patreon update" })).toBeTruthy();
    expect(screen.getByText(/Approve publishing the completed July update/)).toBeTruthy();
    expect(screen.getByText("Audience")).toBeTruthy();
    expect(screen.getByText("Paid members")).toBeTruthy();

    const note = screen.getByPlaceholderText(/Add context for the agent/);
    const approve = screen.getByRole("button", { name: "Approve" });
    const deny = screen.getByRole("button", { name: "Deny" });
    expect(approve.className).toContain("bg-accent");
    expect(approve.className).toContain("text-bg");
    expect(deny.className).toContain("border-border");
    expect(deny.className).toContain("text-text-muted");
    expect(deny.className).not.toContain("border-red/40");
    fireEvent.input(note, {
      target: { value: "Approve, but send it to the test audience first." },
    });
    fireEvent.click(approve);

    await waitFor(() => {
      expect(calls).toEqual([{
        actionId: "approve",
        note: "Approve, but send it to the test audience first.",
      }]);
    });
  });

  test("keeps feedback available for denial and displays it in the resolved state", () => {
    const approval = parseApprovalReview({
      title: "Delete old exports",
      body: "Delete exports older than 90 days.",
      status: "denied",
      decision: {
        action_id: "deny",
        status: "denied",
        note: "Keep the finance exports for seven years.",
        decided_at: "2026-07-27T14:30:00Z",
      },
    });

    render(
      <ApprovalReviewModal
        open
        approval={approval}
        onClose={() => {}}
        onAction={async () => {}}
      />,
    );

    expect(screen.getByText("Keep the finance exports for seven years.")).toBeTruthy();
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.queryByRole("button", { name: "Approve" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Deny" })).toBeNull();
  });
});
