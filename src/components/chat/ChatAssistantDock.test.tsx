import { afterAll, afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { defaultAssistantPreferences, type AssistantPreferences } from "./assistantModel";

let projectId = "project-one";
let preferences: AssistantPreferences = { ...defaultAssistantPreferences };
let directory: any = null;
let voiceSession: any = null;
const save = mock(async (_value: AssistantPreferences) => {});
const mounts = mock((_props: any) => {});
const originals = {
  projects: { ...await import("../../hooks/useProjects") },
  assistant: { ...await import("../../hooks/useChatAssistant") },
  voice: { ...await import("../../state/RealtimeVoiceContext") },
  contributions: { ...await import("../apps/contributions") },
  show: HTMLDialogElement.prototype.show,
  close: HTMLDialogElement.prototype.close,
};
mock.module("../../hooks/useProjects", () => ({ useProjects: () => ({ currentProject: { id: projectId, name: "Test project" } }) }));
mock.module("../../hooks/useChatAssistant", () => ({
  ASSISTANT_CHAT_SLOT: "dashboard.build",
  useAssistantPreferences: () => ({ preferences, save, saveState: "idle" }),
  useAssistantDirectory: () => ({ directory, loading: false, error: "", refresh: () => {} }),
}));
mock.module("../../state/RealtimeVoiceContext", () => ({ useRealtimeVoice: () => ({ session: voiceSession }) }));
mock.module("../apps/contributions", () => ({ ContributionMount: (props: any) => {
  mounts(props);
  return <div>Conversations app: {props.projectId}/{props.agentId}</div>;
} }));
const { ChatAssistantDock } = await import("./ChatAssistantDock");
const { ChatAssistantSettings } = await import("./ChatAssistantSettings");
// happy-dom does not implement native dialog lifecycle.
HTMLDialogElement.prototype.show = function () { this.setAttribute("open", ""); };
HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); };
beforeEach(() => {
  projectId = "project-one";
  voiceSession = null;
  preferences = { ...defaultAssistantPreferences, enabled: true, targets: [{ kind: "helper" }, { kind: "agent", id: 2 }] };
  directory = { rows: [], contribution: { key: "conversations:agent-conversations" }, choices: [
    { target: { kind: "helper" }, agent: { id: 1, name: "Apteva Helper" } },
    { target: { kind: "agent", id: 2 }, agent: { id: 2, name: "Research" } },
  ] };
  mounts.mockClear(); save.mockClear();
});
afterEach(cleanup);
afterAll(() => {
  mock.module("../../hooks/useProjects", () => originals.projects);
  mock.module("../../hooks/useChatAssistant", () => originals.assistant);
  mock.module("../../state/RealtimeVoiceContext", () => originals.voice);
  mock.module("../apps/contributions", () => originals.contributions);
  HTMLDialogElement.prototype.show = originals.show;
  HTMLDialogElement.prototype.close = originals.close;
});
function Dock() { return <MemoryRouter><ChatAssistantDock /></MemoryRouter>; }
describe("Conversations-powered chat assistant", () => {
  test("page sharing is on by default, independent of chat target, and can be disabled", () => {
    const view = render(<Dock />);
    fireEvent.click(screen.getByRole("button", { name: "Open chat assistant" }));
    expect(mounts.mock.calls.at(-1)?.[0].pageContext).toMatchObject({ page: "dashboard", project_id: "project-one" });
    preferences = { ...preferences, sharePageContext: false };
    view.rerender(<Dock />);
    expect(mounts.mock.calls.at(-1)?.[0].pageContext).toBeUndefined();
  });
  test("does not mount any conversation until opened and hides without the dependency", () => {
    const view = render(<Dock />);
    expect(screen.getByRole("button", { name: "Open chat assistant" })).toBeTruthy();
    expect(mounts).not.toHaveBeenCalled();
    directory = null;
    view.rerender(<Dock />);
    expect(screen.queryByRole("button", { name: "Open chat assistant" })).toBeNull();
  });
  test("opens Helper through the app component; switching preserves exact agent/project scope", async () => {
    preferences.rememberTarget = true;
    render(<Dock />);
    fireEvent.click(screen.getByRole("button", { name: "Open chat assistant" }));
    expect(await screen.findByText("Conversations app: project-one/1")).toBeTruthy();
    expect(mounts.mock.calls.at(-1)?.[0]).toMatchObject({ slot: "dashboard.build", agentId: 1, instance: { component: "conversations:agent-conversations", settings: { display_mode: "single", composer_layout: "compact", show_new_conversation: true } } });
    fireEvent.click(screen.getByRole("button", { name: "Chat agent" }));
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Research" }));
    expect(await screen.findByText("Conversations app: project-one/2")).toBeTruthy();
    expect(save.mock.calls.at(-1)?.[0].lastTarget).toEqual({ kind: "agent", id: 2 });
    fireEvent.click(screen.getByRole("button", { name: "Close chat assistant" }));
    expect(screen.queryByText("Conversations app: project-one/2")).toBeNull();
  });
  test("turning off switching ignores a remembered agent and uses the default", () => {
    preferences = { ...preferences, allowSwitching: false, rememberTarget: true, lastTarget: { kind: "agent", id: 2 } };
    render(<Dock />);
    fireEvent.click(screen.getByRole("button", { name: "Open chat assistant" }));
    expect(screen.getByText("Conversations app: project-one/1")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Chat agent" })).toBeNull();
  });
  test("a single available agent is a plain heading, not a dropdown", () => {
    directory.choices = [directory.choices[0]];
    render(<Dock />);
    fireEvent.click(screen.getByRole("button", { name: "Open chat assistant" }));
    expect(screen.getByRole("heading", { name: "Apteva Helper" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Chat agent" })).toBeNull();
  });
  test("the themed picker supports keyboard navigation and Escape closes only the menu", () => {
    render(<Dock />);
    fireEvent.click(screen.getByRole("button", { name: "Open chat assistant" }));
    const trigger = screen.getByRole("button", { name: "Chat agent" });
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    const helper = screen.getByRole("menuitemradio", { name: "Apteva Helper" });
    const research = screen.getByRole("menuitemradio", { name: "Research" });
    expect(helper.getAttribute("aria-checked")).toBe("true");
    expect(document.activeElement).toBe(helper);
    fireEvent.keyDown(helper, { key: "ArrowDown" });
    expect(document.activeElement).toBe(research);
    fireEvent.keyDown(research, { key: "Home" });
    expect(document.activeElement).toBe(helper);
    fireEvent.keyDown(helper, { key: "End" });
    expect(document.activeElement).toBe(research);
    fireEvent.keyDown(research, { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(trigger);
    expect(screen.getByText("Conversations app: project-one/1")).toBeTruthy();
  });
  test("outside interaction and tabbing away dismiss the picker", () => {
    render(<Dock />);
    fireEvent.click(screen.getByRole("button", { name: "Open chat assistant" }));
    const trigger = screen.getByRole("button", { name: "Chat agent" });
    fireEvent.click(trigger);
    fireEvent.pointerDown(screen.getByText("Conversations app: project-one/1"));
    expect(screen.queryByRole("menu")).toBeNull();
    fireEvent.click(trigger);
    fireEvent.blur(screen.getByRole("menuitemradio", { name: "Apteva Helper" }), {
      relatedTarget: screen.getByRole("link", { name: "Chat assistant settings" }),
    });
    expect(screen.queryByRole("menu")).toBeNull();
  });
  test("project switch closes the old chat; disabling preferences removes the launcher", () => {
    const view = render(<Dock />);
    fireEvent.click(screen.getByRole("button", { name: "Open chat assistant" }));
    projectId = "project-two";
    view.rerender(<Dock />);
    expect(screen.queryByText("Conversations app: project-one/1")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Open chat assistant" }));
    expect(screen.getByText("Conversations app: project-two/1")).toBeTruthy();
    preferences = { ...preferences, enabled: false };
    view.rerender(<Dock />);
    expect(screen.queryByRole("button", { name: "Open chat assistant" })).toBeNull();
  });
  test("losing target eligibility unmounts chat without substituting another agent", () => {
    const view = render(<Dock />);
    fireEvent.click(screen.getByRole("button", { name: "Open chat assistant" }));
    directory = { ...directory, choices: [directory.choices[1]] };
    view.rerender(<Dock />);
    expect(screen.queryByText("Conversations app: project-one/1")).toBeNull();
    expect(screen.queryByText("Conversations app: project-one/2")).toBeNull();
    expect(screen.getByText(/This agent is unavailable/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Chat agent" }));
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Research" }));
    expect(screen.getByText("Conversations app: project-one/2")).toBeTruthy();
  });
  test("Escape closes the panel and active voice reserves dock space", async () => {
    voiceSession = { agentId: 1 };
    render(<Dock />);
    fireEvent.click(screen.getByRole("button", { name: "Open chat assistant" }));
    expect(screen.getByRole("dialog", { name: "Chat assistant" }).className).toContain("bottom-40");
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(screen.queryByText("Conversations app: project-one/1")).toBeNull());
  });
  test("settings saves a generic agent default and configurable picker", () => {
    render(<MemoryRouter><ChatAssistantSettings /></MemoryRouter>);
    fireEvent.change(screen.getByRole("combobox", { name: /Default agent/ }), { target: { value: "agent:2" } });
    fireEvent.click(screen.getByRole("checkbox", { name: "Allow switching agents in the panel" }));
    fireEvent.click(screen.getByRole("button", { name: "Save chat assistant" }));
    expect(save.mock.calls.at(-1)?.[0]).toMatchObject({ defaultTarget: { kind: "agent", id: 2 }, allowSwitching: false });
  });
});
