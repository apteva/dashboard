import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import { useProjects } from "../hooks/useProjects";
import { usePageTitle } from "../hooks/usePageTitle";
import { useAssistantPageDetails } from "../components/chat/pageContext";
import { SETTINGS_SECTIONS, SETTINGS_SCREENS, canOpenSettingsScreen, settingsScopeLabel, type SettingsScreen, type SettingsSection } from "./settings/registry";
import { useSettingsDraftGuard } from "./settings/useSettingsDraftGuard";
import { ConnectionSummary } from "./settings/ConnectionSummary";

// Preserve imports used by existing consumers while screens become independent.
export { APIKeysTab, visibleUserManagedKeys, type Key } from "./settings/KeySettings";
export { ProvidersTab } from "./settings/ProviderSettings";
export { primaryRuntimeConnections, groupRuntimeConnectionsByProvider, availableRuntimeEntries } from "./settings/modelUtils";

const Notifications = lazy(() => import("./settings/NotificationSettings").then(m => ({ default: m.NotificationSettings })));
const Appearance = lazy(() => import("./settings/GeneralSettings").then(m => ({ default: m.AppearanceTab })));
const Interface = lazy(() => import("./settings/GeneralSettings").then(m => ({ default: m.InterfaceTab })));
const Account = lazy(() => import("./settings/AccountSettings").then(m => ({ default: m.AccountTab })));
const Projects = lazy(() => import("./settings/ProjectSettings").then(m => ({ default: m.ProjectsTab })));
const Presets = lazy(() => import("../components/projects/PresetSettings").then(m => ({ default: m.PresetSettings })));
const Pages = lazy(() => import("../components/pages/PagesSettings").then(m => ({ default: m.PagesSettings })));
const Providers = lazy(() => import("./settings/ProviderSettings").then(m => ({ default: m.ProvidersTab })));
const Helper = lazy(() => import("./settings/HelperSettings").then(m => ({ default: m.HelperTab })));
const Chat = lazy(() => import("../components/chat/ChatAssistantSettings").then(m => ({ default: m.ChatAssistantSettings })));
const MCP = lazy(() => import("./settings/MCPSettings").then(m => ({ default: m.MCPServersTab })));
const Events = lazy(() => import("./settings/EventSettings").then(m => ({ default: m.SubscriptionsTab })));
const Keys = lazy(() => import("./settings/KeySettings").then(m => ({ default: m.APIKeysTab })));
const Users = lazy(() => import("./settings/UserSettings").then(m => ({ default: m.UsersTab })));
const Server = lazy(() => import("./settings/ServerSettings").then(m => ({ default: m.ServerTab })));
const Maintenance = lazy(() => import("./settings/MaintenanceSettings").then(m => ({ default: m.DataTab })));
const PublicAddress = lazy(() => import("./settings/AdditionalSettings").then(m => ({ default: m.PublicAddressPage })));
const Updates = lazy(() => import("./settings/AdditionalSettings").then(m => ({ default: m.UpdatesPage })));
const Connections = lazy(() => import("./settings/AdditionalSettings").then(m => ({ default: m.ConnectionLinks })));

function Screen({ id }: { id: string }) {
  switch (id) {
    case "notifications": return <Notifications />;
    case "account": return <Account />;
    case "security": return <Account security />;
    case "appearance": return <Appearance />;
    case "interface": return <Interface />;
    case "projects": return <Projects />;
    case "presets": return <Presets />;
    case "pages": return <Pages />;
    case "providers": return <Providers />;
    case "helper": return <Helper />;
    case "chat-assistant": return <Chat />;
    case "mcp": return <MCP />;
    case "subscriptions": return <Events />;
    case "integrations": return <Connections />;
    case "api-keys": return <Keys />;
    case "users": return <Users />;
    case "server": return <PublicAddress />;
    case "updates": return <Updates />;
    case "access-policy": return <Server section="access" />;
    case "agent-lifecycle": return <Server section="lifecycle" />;
    case "geoip": return <Server section="geoip" />;
    case "data": return <Maintenance />;
    default: return null;
  }
}

function SectionIcon({ section }: { section: SettingsSection }) {
  const paths: Record<SettingsSection, string> = {
    general: "M4 6h16M4 12h16M4 18h16M8 3v6M16 9v6M10 15v6",
    workspace: "M3 7h7l2-3h9v16H3V7ZM3 10h18",
    ai: "M8 4h8v3H8V4ZM5 8h14v12H5V8ZM2 11v6M22 11v6M9 12v3M15 12v3M9 18h6",
    connections: "M8 7H5a4 4 0 0 0 0 8h3M16 7h3a4 4 0 0 1 0 8h-3M7 11h10",
    events: "m13 2-9 12h7l-1 8 10-12h-7l1-8Z",
    access: "M12 3 3 7v5c0 5 9 9 9 9s9-4 9-9V7L12 3Zm-4 9 3 3 5-5",
    server: "M3 3h18v7H3V3Zm0 11h18v7H3v-7ZM6 6h2M6 17h2M15 6h3M15 17h3",
  };
  return <svg className="shrink-0 text-accent" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[section]} /></svg>;
}

function RestrictedScreen({ screen }: { screen: SettingsScreen }) {
  const { user } = useAuth();
  return <section className="max-w-3xl rounded-lg border border-border bg-bg-card p-5">
    <h2 className="text-base font-semibold">{screen.title}</h2>
    <p className="mt-2 text-sm text-text-muted">{screen.permission === "admin" ? "Managed by your administrator. Your account can’t change these server-wide settings." : "Your account doesn’t have permission to manage this setting. Contact your administrator for access."}</p>
    {screen.id === "providers" && user && <div className="mt-4 border-t border-border pt-4 text-sm"><h3 className="font-medium">Available AI</h3><p className="mt-2 text-text-muted">{user.managedLLM.configured ? "Your administrator provides AI for this account." : "Your administrator manages provider access."}</p>{user.managedLLM.models.length > 0 && <p className="mt-2 break-words text-xs text-text-muted">Models: {user.managedLLM.models.join(", ")}</p>}</div>}
  </section>;
}

export function Settings() {
  const { user } = useAuth();
  const { currentProject } = useProjects();
  const [params, setParams] = useSearchParams();
  const [query, setQuery] = useState("");
  const tab = params.get("tab");
  const requestedScreen = SETTINGS_SCREENS.find(item => item.id === tab);
  const section = SETTINGS_SECTIONS.find(item => item.id === (requestedScreen?.section || params.get("section"))) || SETTINGS_SECTIONS[0];
  const sectionScreens = SETTINGS_SCREENS.filter(item => item.section === section.id);
  // A section with one screen is already its destination; don't add a card-only landing page.
  const directSection = sectionScreens.length === 1;
  const screen = requestedScreen || (!tab && directSection ? sectionScreens[0] : undefined);
  const root = useRef<HTMLDivElement>(null);
  const scrollArea = useRef<HTMLElement>(null);
  useEffect(() => { if (scrollArea.current) scrollArea.current.scrollTop = 0; }, [screen?.id, section.id]);
  const allowed = !!screen && canOpenSettingsScreen(screen, user);
  const { hasChanges, allowNavigation } = useSettingsDraftGuard(root, !!screen?.guardDraft && allowed, params.toString());
  usePageTitle(["Settings", screen?.title || section.title]);
  useAssistantPageDetails(currentProject?.id || "", { tab: screen?.id || section.id });
  const navigate = (target: URLSearchParams) => {
    if (!allowNavigation()) return;
    setQuery(""); setParams(target);
  };
  const openScreen = (id: string) => {
    // Reading legacy tab URLs is lossless, including page/scope/project IDs.
    // Only an explicit change of screen clears screen-specific parameters.
    navigate(id === tab ? new URLSearchParams(params) : new URLSearchParams({ tab: id }));
  };
  const openSection = (id: string) => navigate(new URLSearchParams({ section: id }));
  const searching = !!query.trim();
  const words = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const entries = SETTINGS_SCREENS.filter(item => searching
    ? words.every(word => `${item.title} ${item.description} ${item.keywords} ${SETTINGS_SECTIONS.find(group => group.id === item.section)?.title}`.toLocaleLowerCase().includes(word))
    : item.section === section.id);
  const cards = <div className="grid gap-3 xl:grid-cols-2">{entries.map(item => {
    const accessible = canOpenSettingsScreen(item, user);
    return <button key={item.id} type="button" onClick={() => openScreen(item.id)} className="flex min-w-0 cursor-pointer items-start gap-3 rounded-lg border border-border bg-bg-card p-4 text-left transition-colors hover:border-accent hover:bg-bg-hover focus-visible:outline-2 focus-visible:outline-accent">
      <span className="rounded-lg border border-border p-2"><SectionIcon section={item.section} /></span>
      <span className="min-w-0 flex-1"><span className="block text-sm font-semibold text-text">{item.title}</span><span className="mt-1 block text-xs leading-relaxed text-text-muted">{item.description}</span><span className="mt-3 block text-[11px] text-text-dim">{settingsScopeLabel(item, currentProject?.name)}{!accessible ? " · Administrator access" : ""}</span></span><span className="mt-2 text-text-dim" aria-hidden="true">→</span>
    </button>;
  })}</div>;

  return <div className="flex h-full min-h-0 flex-col">
    <header className="flex shrink-0 flex-wrap items-center gap-3 border-b border-border px-4 py-3 sm:px-6">
      <h1 className="text-lg font-bold">Settings</h1>
      <label className="relative ml-auto min-w-0 flex-1 sm:w-80 sm:flex-none"><span className="sr-only">Search settings</span><input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Search settings…" className="min-h-10 w-full rounded-lg border border-border bg-bg-input px-3 text-base focus:border-accent focus:outline-none sm:text-sm" /></label>
      <div className="relative w-full md:hidden">
        <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center"><SectionIcon section={section.id} /></span>
        <label className="sr-only" htmlFor="mobile-settings-section">Settings section</label>
        <select id="mobile-settings-section" value={section.id} onChange={event => openSection(event.target.value)} className="min-h-11 w-full appearance-none rounded-lg border border-border bg-bg-input py-2 pl-11 pr-10 text-base text-text focus:border-accent focus:outline-none">
          {SETTINGS_SECTIONS.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}
        </select>
        <svg className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-text-muted" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
      </div>
    </header>
    <div className="flex min-h-0 flex-1">
      <nav className="hidden w-60 shrink-0 flex-col gap-1 overflow-y-auto border-r border-border p-3 md:flex" aria-label="Settings sections">
        {SETTINGS_SECTIONS.map(item => <button key={item.id} type="button" onClick={() => openSection(item.id)} aria-current={section.id === item.id && !searching ? "page" : undefined} className={`flex min-h-11 cursor-pointer items-center gap-3 rounded-lg px-3 py-3 text-left text-sm transition-colors focus-visible:outline-accent ${section.id === item.id && !searching ? "bg-accent/10 font-semibold text-accent" : "text-text-muted hover:bg-bg-hover hover:text-text"}`}><SectionIcon section={item.id} />{item.title}</button>)}
        <p className="mt-auto px-3 pt-6 text-[11px] leading-relaxed text-text-dim">Settings stay available in every interface mode. Your account permissions control what you can change.</p>
      </nav>
      <main ref={scrollArea} className="page-safe-bottom min-w-0 flex-1 overflow-y-auto p-4 sm:p-6">
        <div className="mx-auto w-full max-w-6xl">
          {searching ? <section className="space-y-4"><h2 className="text-base font-semibold">{entries.length} setting{entries.length === 1 ? "" : "s"} found</h2>{entries.length ? cards : <p className="text-sm text-text-muted">No settings match “{query}”. Try “public URL”, “Helper”, or “password”.</p>}<button onClick={() => setQuery("")} className="text-sm text-accent">Clear search</button></section> : <>
            {screen && <div className="mb-5 flex flex-wrap items-center gap-3">{!directSection && <button onClick={() => openSection(section.id)} className="min-h-9 text-xs text-accent hover:underline">← {section.title}</button>}<span className="text-xs text-text-dim">{settingsScopeLabel(screen, currentProject?.name)}</span>{hasChanges && <span role="status" className="text-xs text-warn">Unsaved changes</span>}</div>}
            {!screen && !tab && <section className="flex flex-col gap-5"><div><h2 className="text-lg font-semibold">{section.title}</h2><p className="mt-1 text-sm text-text-muted">{section.description}</p></div>{(section.id === "general" || section.id === "server") && <div className={section.id === "general" ? "order-last md:order-none" : undefined}><ConnectionSummary compact /></div>}{cards}</section>}
            {tab && !screen && <div className="rounded-lg border border-border p-5"><h2 className="font-semibold">Setting not found</h2><p className="mt-2 text-sm text-text-muted">Choose a section or search for the setting you need.</p></div>}
          </>}
          <div ref={root} hidden={searching} key={screen?.id}>
            {screen && (user === null ? <p role="status" className="text-sm text-text-muted">Loading permissions…</p> : allowed ? <Suspense fallback={<p role="status" className="text-sm text-text-muted">Loading settings…</p>}><Screen id={screen.id} /></Suspense> : <RestrictedScreen screen={screen} />)}
          </div>
        </div>
      </main>
    </div>
  </div>;
}
