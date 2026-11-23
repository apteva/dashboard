import { afterEach, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { instances, type Agent, type AgentTemplateStatus } from "../api";
import { AgentTemplateModal, AgentTemplateNoticeBar, agentTemplateNotice } from "./AgentTemplate";

const originalInstances = { ...instances };
afterEach(() => {
  cleanup();
  Object.assign(instances, originalInstances);
});

const agent = {
  id: 7, user_id: 1, name: "Support Agent", directive: "Help.", mode: "learn", config: "{}",
  port: 4100, pid: 1, status: "running", created_at: "2026-11-23T00:00:00Z", icon: "headset",
} as Agent;

function status(extra: Partial<AgentTemplateStatus> = {}): AgentTemplateStatus {
  return {
    linked: true, template_id: "support", template_name: "Support", template_source: "user",
    version: 2, latest_version: 3, follow_latest: false, changed_locally: false, update_available: true,
    ...extra,
  };
}

function conflict(current: AgentTemplateStatus) {
  return Object.assign(new Error("changed"), { status: 409, body: { error: "changed", status: current } });
}

test("the agent page only speaks up when the template needs an operator", () => {
  expect(agentTemplateNotice(null)).toBeNull();
  expect(agentTemplateNotice({ linked: false, follow_latest: false, changed_locally: false, update_available: false })).toBeNull();
  // Up to date, or following and about to be updated by the rollout.
  expect(agentTemplateNotice(status({ version: 3, update_available: false }))).toBeNull();
  expect(agentTemplateNotice(status({ follow_latest: true }))).toBeNull();

  const pinned = agentTemplateNotice(status());
  expect(pinned?.tone).toBe("info");
  expect(pinned?.message).toContain("This agent is on version 2");
  expect(pinned?.apply).toEqual({ label: "Update to version 3", change: { version: 3 } });

  // Local changes are never replaced from the bar: it only offers Review.
  const held = agentTemplateNotice(status({ follow_latest: true, changed_locally: true }));
  expect(held?.title).toBe("Template update held");
  expect(held?.apply).toBeUndefined();
  expect(agentTemplateNotice(status({ changed_locally: true }))?.apply).toBeUndefined();

  const failed = agentTemplateNotice(status({ follow_latest: true, last_error: "core unavailable", update_available: false }));
  expect(failed?.tone).toBe("error");
  expect(failed?.message).toContain("core unavailable");
  expect(failed?.apply?.change).toEqual({ follow_latest: true });
});

test("Update moves a pinned agent, and a refusal over local changes opens the review", async () => {
  const updated = status({ version: 3, update_available: false });
  const set = mock(async () => updated);
  instances.template = { ...originalInstances.template, set };
  const changed = mock(() => {});
  const review = mock(() => {});
  render(<AgentTemplateNoticeBar agent={agent} status={status()} onChanged={changed} onReview={review} />);
  fireEvent.click(screen.getByRole("button", { name: "Update to version 3" }));
  await waitFor(() => expect(changed).toHaveBeenCalledWith(updated));
  expect(set).toHaveBeenCalledWith(7, { version: 3 });
  expect(review).not.toHaveBeenCalled();

  cleanup();
  const current = status({ changed_locally: true });
  instances.template = { ...originalInstances.template, set: mock(async () => { throw conflict(current); }) };
  render(<AgentTemplateNoticeBar agent={agent} status={status()} onChanged={changed} onReview={review} />);
  fireEvent.click(screen.getByRole("button", { name: "Update to version 3" }));
  await waitFor(() => expect(review).toHaveBeenCalled());
  expect(changed).toHaveBeenLastCalledWith(current);
});

function renderModal(current: AgentTemplateStatus | null, onChanged = mock(() => {})) {
  render(
    <MemoryRouter>
      <AgentTemplateModal open onClose={() => {}} agent={agent} status={current} onChanged={onChanged} />
    </MemoryRouter>,
  );
  return onChanged;
}

test("following asks before replacing the agent's own changes", async () => {
  const held = status({ follow_latest: true, changed_locally: true });
  const set = mock(async (_id: number, change: any) => {
    if (!change.overwrite_local_changes) throw conflict(held);
    return status({ follow_latest: true, version: 3, update_available: false });
  });
  instances.template = { ...originalInstances.template, set };
  const changed = renderModal(status({ changed_locally: true }));
  expect(screen.getByText(/so new versions are not applied over them/)).toBeTruthy();

  fireEvent.click(screen.getByRole("radio", { name: /Follow new versions/ }));
  const replace = await screen.findByRole("button", { name: "Replace with version 3" });
  expect(set).toHaveBeenCalledTimes(1);
  expect(set.mock.calls[0]![1]).toEqual({ follow_latest: true });
  expect(changed).toHaveBeenCalledWith(held);

  fireEvent.click(replace);
  await screen.findByText("Moved to version 3.");
  expect(set.mock.calls[1]![1]).toEqual({ follow_latest: true, overwrite_local_changes: true });
});

test("reset and version moves pin the agent, and keeping changes cancels", async () => {
  const set = mock(async () => status({ version: 1, update_available: true }));
  instances.template = { ...originalInstances.template, set };
  renderModal(status({ changed_locally: true }));

  // Reset only asks; nothing changes until the operator confirms.
  fireEvent.click(screen.getByRole("button", { name: "Reset to version 2" }));
  expect(set).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Keep this agent's changes" }));
  expect(screen.queryByRole("button", { name: /Replace with version/ })).toBeNull();

  fireEvent.change(screen.getByLabelText("Move to a version"), { target: { value: "1" } });
  fireEvent.click(screen.getByRole("button", { name: "Use version 1" }));
  await waitFor(() => expect(set).toHaveBeenCalledWith(7, { version: 1 }));
});

test("unlinking confirms first, and an unlinked agent can be saved as a template", async () => {
  const unlink = mock(async () => ({ linked: false, follow_latest: false, changed_locally: false, update_available: false }));
  instances.template = { ...originalInstances.template, unlink };
  const changed = renderModal(status());
  fireEvent.click(screen.getByRole("button", { name: "Unlink" }));
  expect(unlink).not.toHaveBeenCalled();
  expect(screen.getByText(/gets no more versions/)).toBeTruthy();
  fireEvent.click(screen.getAllByRole("button", { name: "Unlink" }).at(-1)!);
  await waitFor(() => expect(unlink).toHaveBeenCalledWith(7));
  expect(changed).toHaveBeenCalled();

  cleanup();
  const saved = status({ template_id: "custom", template_name: "Triage", version: 1, latest_version: 1, follow_latest: true, update_available: false });
  const save = mock(async () => ({ template: { id: "custom", name: "Triage" } as any, status: saved }));
  instances.template = { ...originalInstances.template, save };
  const onSaved = renderModal({ linked: false, follow_latest: false, changed_locally: false, update_available: false });
  expect(screen.getByText("Support Agent isn't linked to a template.")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Save as template" }));
  fireEvent.change(screen.getByLabelText("Template name"), { target: { value: "Triage" } });
  fireEvent.change(screen.getByLabelText("Description"), { target: { value: "Sorts tickets." } });
  fireEvent.click(screen.getByRole("button", { name: "Save template" }));
  await screen.findByText("Saved as Triage. This agent follows it.");
  expect(save).toHaveBeenCalledWith(7, { name: "Triage", description: "Sorts tickets.", icon: "headset" });
  expect(onSaved).toHaveBeenCalledWith(saved);
});
