import { createContext, useCallback, useContext, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode, type RefObject } from "react";
import { isHostUIRequest } from "@apteva/ui-kit";
export { isHostUIRequest } from "@apteva/ui-kit";
import type { AppHost, ChatAssistantLauncher, HostUI } from "@apteva/ui-kit";
import { useMediaQuery } from "../../hooks/useMediaQuery";

const noop = () => {};
const unsupported: AppHost = { capabilities: { ui: { chatAssistantLauncher: false } }, ui: { request: () => noop } };
/** Only host mounts can create leases. App requests contain no scope/identity. */
export class HostUIRegistry {
  private leases = new Set<HostUILease>();
  private listeners = new Set<() => void>();
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  changed = () => { for (const listener of this.listeners) listener(); };
  mount(lease: HostUILease) { this.leases.add(lease); this.changed(); }
  remove(lease: HostUILease) { this.leases.delete(lease); this.changed(); }
  policy(epoch: string, projectId: string): ChatAssistantLauncher {
    // Foreground selection belongs to the host. Nested mounts/focused panes
    // take precedence; background widgets never enter this registry.
    let policy: ChatAssistantLauncher = "auto";
    for (const lease of this.leases) {
      if (lease.epoch === epoch && (lease.projectId === projectId || lease.projectId === "")) policy = lease.policy;
    }
    return policy;
  }
  focus(lease: HostUILease) {
    if (!this.leases.delete(lease)) return;
    this.leases.add(lease); this.changed();
  }
}

export class HostUILease {
  private mounted = false;
  private requests = new Map<symbol, ChatAssistantLauncher>();
  readonly host: AppHost;
  constructor(private registry: HostUIRegistry, readonly epoch: string, readonly projectId: string, private inherited: ChatAssistantLauncher = "auto", private eligible = true) {
    this.host = { capabilities: { ui: { chatAssistantLauncher: eligible } }, ui: { request: (settings) => {
      if (!this.mounted || !isHostUIRequest(settings) || this.requests.size >= 32) return noop;
      const id = Symbol();
      this.requests.set(id, settings.chatAssistant.launcher); this.registry.changed();
      return () => { if (this.requests.delete(id)) this.registry.changed(); };
    } } };
  }
  get policy() { return [...this.requests.values()].at(-1) ?? this.inherited; }
  mount() { if (this.eligible) { this.mounted = true; this.registry.mount(this); } }
  dispose() { this.mounted = false; this.requests.clear(); this.registry.remove(this); }
  focus() { this.registry.focus(this); }
}

const HostContext = createContext<{ registry: HostUIRegistry; epoch: string } | null>(null);
export function HostUIProvider({ scope, children }: { scope: string; children: ReactNode }) {
  const [registry] = useState(() => new HostUIRegistry());
  const value = useMemo(() => ({ registry, epoch: scope }), [registry, scope]);
  return <HostContext.Provider value={value}>{children}</HostContext.Provider>;
}

export function useHostLauncherHidden(projectId: string) {
  const context = useContext(HostContext);
  const subscribe = context?.registry.subscribe ?? (() => noop);
  const snapshot = useCallback(() => context?.registry.policy(context.epoch, projectId) ?? "auto", [context, projectId]);
  const policy = useSyncExternalStore(subscribe, snapshot, () => "auto" as const);
  // Matches Dashboard's md navigation breakpoint; apps never inspect devices.
  const compact = useMediaQuery("(max-width: 767px)");
  return policy === "hidden" || (policy === "hidden_on_compact" && compact);
}

function useVisible(ref: RefObject<HTMLDivElement | null>, enabled: boolean) {
  const [visible, setVisible] = useState(enabled);
  useLayoutEffect(() => {
    if (!enabled) { setVisible(false); return; }
    const node = ref.current;
    if (!node) return;
    const inspect = () => {
      let visible = node.isConnected;
      for (let element: HTMLElement | null = node; element && visible; element = element.parentElement) {
        const style = getComputedStyle(element);
        visible = !element.hidden && !element.inert && element.getAttribute("aria-hidden") !== "true" && style.display !== "none" && style.visibility !== "hidden" && style.visibility !== "collapse";
      }
      setVisible(visible);
    };
    inspect();
    const observer = new MutationObserver(inspect);
    for (let element: HTMLElement | null = node; element; element = element.parentElement) observer.observe(element, { attributes: true, attributeFilter: ["class", "style", "hidden", "inert", "aria-hidden"] });
    window.addEventListener("resize", inspect);
    return () => { observer.disconnect(); window.removeEventListener("resize", inspect); };
  }, [ref, enabled]);
  return visible;
}

/** Inside the renderer's error boundary: a failed/suspended app loses its lease. */
export function AppHostSurface({ projectId, installId, surface, foreground = false, hostUI, children }: {
  projectId: string; installId: number; surface: string; foreground?: boolean; hostUI?: HostUI;
  children: (host: AppHost) => ReactNode;
}) {
  const context = useContext(HostContext);
  const ref = useRef<HTMLDivElement>(null);
  const visible = useVisible(ref, foreground);
  const inherited = hostUI?.chat_assistant?.launcher ?? "auto";
  const eligible = foreground && visible;
  const lease = useMemo(() => context ? new HostUILease(context.registry, context.epoch, projectId, inherited, eligible) : null,
    [context, projectId, installId, surface, inherited, eligible]);
  useLayoutEffect(() => { lease?.mount(); return () => lease?.dispose(); }, [lease]);
  return <div ref={ref} className="contents" onPointerDownCapture={() => lease?.focus()} onFocusCapture={() => lease?.focus()}>{children(lease?.host ?? unsupported)}</div>;
}

const FRAME_PROTOCOL = "apteva.host";
/** Source, origin and per-load channel are all checked; no caller-chosen scope. */
export function attachHostUIFrame(frame: HTMLIFrameElement, host: AppHost): () => void {
  const origin = new URL(frame.src, window.location.href).origin;
  const channel = crypto.randomUUID();
  const requests = new Map<string, () => void>();
  const initialize = () => frame.contentWindow?.postMessage({ protocol: FRAME_PROTOCOL, version: 1, type: "init", channel, capabilities: host.capabilities }, origin);
  const receive = (event: MessageEvent) => {
    if (event.source !== frame.contentWindow || event.origin !== origin) return;
    const msg = event.data;
    if (!msg || msg.protocol !== FRAME_PROTOCOL || msg.version !== 1) return;
    if (msg.type === "ready") {
      initialize();
      return;
    }
    if (msg.channel !== channel || typeof msg.requestId !== "string" || !msg.requestId || msg.requestId.length > 128) return;
    if (msg.type === "request" && isHostUIRequest(msg.settings) && requests.size < 32 && !requests.has(msg.requestId)) {
      requests.set(msg.requestId, host.ui.request(msg.settings));
    } else if (msg.type === "release") {
      requests.get(msg.requestId)?.(); requests.delete(msg.requestId);
    }
  };
  window.addEventListener("message", receive);
  initialize();
  return () => { window.removeEventListener("message", receive); for (const release of requests.values()) release(); requests.clear(); };
}

export function AppHostFrame({ src, title, projectId, installId, surface, foreground, hostUI }: {
  src: string; title: string; projectId: string; installId: number; surface: string; foreground?: boolean; hostUI?: HostUI;
}) {
  return <AppHostSurface key={src} projectId={projectId} installId={installId} surface={surface} foreground={foreground} hostUI={hostUI}>
    {host => <BoundHostFrame src={src} title={title} host={host} />}
  </AppHostSurface>;
}
function BoundHostFrame({ src, title, host }: { src: string; title: string; host: AppHost }) {
  const ref = useRef<HTMLIFrameElement>(null);
  const [load, setLoad] = useState(0);
  useLayoutEffect(() => ref.current ? attachHostUIFrame(ref.current, host) : undefined, [host, load]);
  return <iframe ref={ref} src={src} title={title} onLoad={() => setLoad(value => value + 1)} className="h-full w-full border-0" sandbox="allow-scripts allow-same-origin" />;
}
