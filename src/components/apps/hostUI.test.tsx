import { afterEach, describe, expect, test } from "bun:test";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Component, useEffect, useState, type ReactNode } from "react";
import { connectAppHost } from "@apteva/ui-kit";
import type { AppHost, HostUI } from "@apteva/ui-kit";
import { AppHostSurface, HostUILease, HostUIProvider, HostUIRegistry, attachHostUIFrame, isHostUIRequest, useHostLauncherHidden } from "./hostUI";

afterEach(cleanup);

describe("scoped host presentation requests", () => {
  test("runtime requests override inherited policy, release restores prior requests, disposal rejects stale callbacks", () => {
    const registry = new HostUIRegistry();
    const lease = new HostUILease(registry, "route", "project", "hidden_on_compact");
    lease.mount();
    expect(registry.policy("route", "project")).toBe("hidden_on_compact");
    const release = lease.host.ui.request({ chatAssistant: { launcher: "hidden" } });
    const reset = lease.host.ui.request({ chatAssistant: { launcher: "auto" } });
    expect(registry.policy("route", "project")).toBe("auto");
    reset(); reset();
    expect(registry.policy("route", "project")).toBe("hidden");
    release();
    expect(registry.policy("route", "project")).toBe("hidden_on_compact");
    lease.dispose();
    lease.host.ui.request({ chatAssistant: { launcher: "hidden" } });
    expect(registry.policy("route", "project")).toBe("auto");
  });
  test("background surfaces cannot suppress; project and navigation epochs are isolated", () => {
    const registry = new HostUIRegistry();
    const background = new HostUILease(registry, "route", "project", "hidden", false);
    background.mount();
    background.host.ui.request({ chatAssistant: { launcher: "hidden" } });
    expect(background.host.capabilities.ui.chatAssistantLauncher).toBe(false);
    expect(registry.policy("route", "project")).toBe("auto");
    const foreground = new HostUILease(registry, "route", "project", "hidden");
    foreground.mount();
    expect(registry.policy("other-route", "project")).toBe("auto");
    expect(registry.policy("route", "other-project")).toBe("auto");
    expect(registry.policy("route", "project")).toBe("hidden");
    foreground.dispose();
  });
  test("a global app affects its active host scope without leaking to another navigation epoch", () => {
    const registry = new HostUIRegistry();
    const global = new HostUILease(registry,"project-one-route","","hidden");
    global.mount();
    expect(registry.policy("project-one-route","project-one")).toBe("hidden");
    expect(registry.policy("project-two-route","project-two")).toBe("auto");
    global.dispose();
  });
  test("requests are bounded and only launcher presentation is accepted", () => {
    expect(isHostUIRequest({ chatAssistant: { launcher: "hidden", enabled: false } })).toBe(false);
    expect(isHostUIRequest({ chatAssistant: { launcher: "hidden" }, projectId: "other" })).toBe(false);
    expect(isHostUIRequest({ chatAssistant: { launcher: "show" } })).toBe(false);
    const registry = new HostUIRegistry();
    const lease = new HostUILease(registry, "route", "project");
    lease.mount();
    const releases = Array.from({ length: 32 }, () => lease.host.ui.request({ chatAssistant: { launcher: "hidden" } }));
    lease.host.ui.request({ chatAssistant: { launcher: "auto" } });
    expect(registry.policy("route", "project")).toBe("hidden");
    releases.forEach(release => release());
    expect(registry.policy("route", "project")).toBe("auto");
  });
});

function State() { return <span data-testid="policy">{String(useHostLauncherHidden("project"))}</span>; }
function Client({ host, request }: { host: AppHost; request?: "hidden" | "auto" | "hidden_on_compact" }) {
  useEffect(() => { if (request) host.ui.request({ chatAssistant: { launcher: request } }); }, [host, request]); // Intentionally missed release.
  const [draft,setDraft] = useState("");
  return <label>App draft<input value={draft} onChange={event => setDraft(event.target.value)} /></label>;
}
function Surface({ request, foreground = true, installId = 1, hostUI }: { request?: "hidden" | "auto" | "hidden_on_compact"; foreground?: boolean; installId?: number; hostUI?: HostUI }) {
  return <AppHostSurface projectId="project" installId={installId} surface="panel" foreground={foreground} hostUI={hostUI}>{host => <Client host={host} request={request} />}</AppHostSurface>;
}

describe("host-owned surface lifecycle", () => {
  test("foreground changes preserve the app's own view state", () => {
    const view = render(<HostUIProvider scope="route"><State /><Surface request="hidden" /></HostUIProvider>);
    fireEvent.change(screen.getByRole("textbox",{name:"App draft"}),{target:{value:"Unsent app draft"}});
    view.rerender(<HostUIProvider scope="route"><State /><Surface foreground={false} /></HostUIProvider>);
    expect((screen.getByRole("textbox",{name:"App draft"}) as HTMLInputElement).value).toBe("Unsent app draft");
    expect(screen.getByTestId("policy").textContent).toBe("false");
  });
  test("render failure removes the failed surface's requests", () => {
    class Boundary extends Component<{children:ReactNode},{failed:boolean}> {
      state={failed:false};
      static getDerivedStateFromError() { return {failed:true}; }
      render() { return this.state.failed ? <span>Failed panel</span> : this.props.children; }
    }
    function Failing({failed}:{failed:boolean}) { if (failed) throw new Error("Fixture render failure"); return <Surface request="hidden" />; }
    const view = render(<HostUIProvider scope="route"><State /><Boundary><Failing failed={false} /></Boundary></HostUIProvider>);
    expect(screen.getByTestId("policy").textContent).toBe("true");
    view.rerender(<HostUIProvider scope="route"><State /><Boundary><Failing failed /></Boundary></HostUIProvider>);
    expect(screen.getByText("Failed panel")).toBeTruthy();
    expect(screen.getByTestId("policy").textContent).toBe("false");
  });

  test("unmount and inactive views clean up even without app release", () => {
    const view = render(<HostUIProvider scope="route"><State /><Surface request="hidden" /></HostUIProvider>);
    expect(screen.getByTestId("policy").textContent).toBe("true");
    view.rerender(<HostUIProvider scope="route"><State /><Surface foreground={false} /></HostUIProvider>);
    expect(screen.getByTestId("policy").textContent).toBe("false");
    view.rerender(<HostUIProvider scope="route"><State /><Surface request="hidden" /></HostUIProvider>);
    expect(screen.getByTestId("policy").textContent).toBe("true");
    view.rerender(<HostUIProvider scope="route"><State /></HostUIProvider>);
    expect(screen.getByTestId("policy").textContent).toBe("false");
  });
  test("installation and navigation changes discard runtime overrides", () => {
    const view = render(<HostUIProvider scope="route"><State /><Surface request="hidden" /></HostUIProvider>);
    view.rerender(<HostUIProvider scope="route"><State /><Surface installId={2} /></HostUIProvider>);
    expect(screen.getByTestId("policy").textContent).toBe("false");
    view.rerender(<HostUIProvider scope="new-route"><State /><Surface installId={2} /></HostUIProvider>);
    expect(screen.getByTestId("policy").textContent).toBe("false");
  });
  test("hidden ancestor panes cannot retain suppression", async () => {
    const view = render(<HostUIProvider scope="route"><State /><div data-testid="pane"><Surface request="hidden" /></div></HostUIProvider>);
    expect(screen.getByTestId("policy").textContent).toBe("true");
    act(() => { screen.getByTestId("pane").hidden = true; });
    await waitFor(() => expect(screen.getByTestId("policy").textContent).toBe("false"));
    view.unmount();
  });
  test("compact policy responds to the host breakpoint while desktop retains launcher", async () => {
    const original = window.matchMedia;
    let compact = false;
    const changes = new Set<() => void>();
    window.matchMedia = (() => ({ get matches() { return compact; }, addEventListener: (_:string, callback:()=>void) => changes.add(callback), removeEventListener: (_:string, callback:()=>void) => changes.delete(callback) })) as any;
    try {
      render(<HostUIProvider scope="route"><State /><Surface hostUI={{chat_assistant:{launcher:"hidden_on_compact"}}} /></HostUIProvider>);
      expect(screen.getByTestId("policy").textContent).toBe("false");
      act(() => { compact = true; changes.forEach(update => update()); });
      expect(screen.getByTestId("policy").textContent).toBe("true");
      act(() => { compact = false; changes.forEach(update => update()); });
      expect(screen.getByTestId("policy").textContent).toBe("false");
    } finally { cleanup(); window.matchMedia = original; }
  });
  test("unsupported hosts preserve ordinary rendering", () => {
    let supported = true;
    render(<AppHostSurface projectId="project" installId={1} surface="panel" foreground>{host => { supported = host.capabilities.ui.chatAssistantLauncher; host.ui.request({chatAssistant:{launcher:"hidden"}})(); return <span>legacy</span>; }}</AppHostSurface>);
    expect(supported).toBe(false);
    expect(screen.getByText("legacy")).toBeTruthy();
  });
});

test("iframe messages require registered source, origin, current channel and valid settings; cleanup releases", () => {
  const frame = document.createElement("iframe");
  document.body.appendChild(frame);
  Object.defineProperty(frame,"src",{value:"http://localhost/app"});
  const registry = new HostUIRegistry();
  const lease = new HostUILease(registry, "route", "project");
  lease.mount();
  const posted: any[] = [];
  const contentWindow = frame.contentWindow!;
  const original = contentWindow.postMessage;
  contentWindow.postMessage = ((message:any) => posted.push(message)) as any;
  const detach = attachHostUIFrame(frame, lease.host);
  const dispatch = (data:any, origin = "http://localhost", source:MessageEventSource|null = contentWindow) => window.dispatchEvent(new MessageEvent("message", { data:{protocol:"apteva.host",version:1,...data}, origin, source }));
  try {
    dispatch({type:"ready"},"https://wrong.example");
    dispatch({type:"ready"},"http://localhost",window);
    expect(posted.length).toBe(1); // initial registered-frame capabilities only
    dispatch({type:"ready"});
    const channel = posted[0].channel;
    const data = {type:"request",channel,requestId:"one",settings:{chatAssistant:{launcher:"hidden"}}};
    dispatch({...data,channel:"old-channel"});
    dispatch({...data,settings:{chatAssistant:{launcher:"hidden",enabled:false}}});
    expect(registry.policy("route","project")).toBe("auto");
    dispatch(data);
    expect(registry.policy("route","project")).toBe("hidden");
    dispatch({type:"release",channel,requestId:"one"});
    expect(registry.policy("route","project")).toBe("auto");
    dispatch({...data,requestId:"two"});
    detach();
    expect(registry.policy("route","project")).toBe("auto");
    dispatch({...data,requestId:"three"});
    expect(registry.policy("route","project")).toBe("auto");
  } finally { detach(); contentWindow.postMessage = original; frame.remove(); lease.dispose(); }
});

test("iframe SDK adapter exposes the same scoped API and revokes requests when its channel changes", async () => {
  const original = window.postMessage;
  const posted:any[] = [];
  window.postMessage = ((value:any) => posted.push(value)) as any;
  const dispatch = (channel:string, origin="http://localhost") => window.dispatchEvent(new MessageEvent("message", {source:window,origin,data:{protocol:"apteva.host",version:1,type:"init",channel,capabilities:{ui:{chatAssistantLauncher:true}}}}));
  try {
    const ready = connectAppHost({parentOrigin:"http://localhost"});
    expect(posted[0].type).toBe("ready");
    dispatch("one");
    const host = await ready;
    expect(host.capabilities.ui.chatAssistantLauncher).toBe(true);
    const oldRelease = host.ui.request({chatAssistant:{launcher:"hidden_on_compact"}});
    expect(posted.at(-1)).toMatchObject({type:"request",channel:"one",settings:{chatAssistant:{launcher:"hidden_on_compact"}}});
    let changes=0;
    host.subscribe(() => changes++);
    dispatch("forged","https://wrong.example");
    expect(changes).toBe(0);
    dispatch("two");
    expect(changes).toBe(1);
    const count=posted.length;
    oldRelease();
    expect(posted.length).toBe(count);
    host.ui.request({chatAssistant:{launcher:"hidden"}});
    expect(posted.at(-1).channel).toBe("two");
    host.dispose(); host.dispose();
    expect(posted.at(-1)).toMatchObject({type:"release",channel:"two"});
    expect(host.capabilities.ui.chatAssistantLauncher).toBe(false);
    host.ui.request({chatAssistant:{launcher:"hidden"}});
    expect(posted.at(-1).type).toBe("release");
  } finally { window.postMessage=original; }
});

test("iframe SDK adapter falls back safely on an unsupported host", async () => {
  const original = window.postMessage;
  window.postMessage = (() => {}) as any;
  try {
    const host = await connectAppHost({parentOrigin:"http://localhost",timeoutMs:5});
    expect(host.capabilities.ui.chatAssistantLauncher).toBe(false);
    host.ui.request({chatAssistant:{launcher:"hidden"}})();
    host.dispose();
  } finally { window.postMessage=original; }
});
