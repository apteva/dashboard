import { expect, test } from "bun:test";
import { describeAssistantPage } from "./pageContext";

test("app context contains identifiers, never raw query or page data", () => {
  const result = describeAssistantPage("/apps/tickets/page", "?token=secret&row=17", "p", "Project", { app: "tickets", installation_id: 12, panel: "Tickets" });
  expect(result).toEqual({ version: 1, page: "app", project_id: "p", project_name: "Project", app: "tickets", installation_id: 12, panel: "Tickets" });
});
test("viewed agent is distinct from chat target; stale selections are ignored", () => {
  const result = describeAssistantPage("/agents/42", "", "p", "Project", { viewed_agent_id: 42, viewed_agent_name: "Support", thread_id: "thread-2", tab: "memory" });
  expect(result?.viewed_agent_id).toBe(42);
  expect(result?.thread_id).toBe("thread-2");
  expect(describeAssistantPage("/agents/99", "", "p", "Project", { viewed_agent_id: 42, viewed_agent_name: "Support" })?.viewed_agent_name).toBeUndefined();
});
test("settings allowlists section names and unsupported routes share nothing", () => {
  expect(describeAssistantPage("/settings", "?tab=chat-assistant&key=secret", "p")?.tab).toBe("chat-assistant");
  expect(describeAssistantPage("/settings", "?tab=secret", "p")?.tab).toBeUndefined();
  expect(describeAssistantPage("/login", "?token=secret", "p")).toBeUndefined();
});
