import type { AuthUser } from "../../hooks/useAuth";

export const SETTINGS_SECTIONS = [
  { id: "general", title: "General", description: "Your account, appearance, language, and interface." },
  { id: "workspace", title: "Workspace", description: "Organize projects, people, pages, and presets." },
  { id: "ai", title: "AI & Helper", description: "Connect AI and configure your assistant." },
  { id: "connections", title: "Connections", description: "Connect services, apps, and tool servers." },
  { id: "events", title: "Events", description: "Route app and integration events to agents." },
  { id: "access", title: "Access & security", description: "Protect your account and manage access." },
  { id: "server", title: "Server", description: "Public address, HTTPS, updates, and maintenance." },
] as const;
export type SettingsSection = typeof SETTINGS_SECTIONS[number]["id"];
type Permission = "admin" | "provider_management" | "custom_mcp" | "api_keys";
export interface SettingsScreen {
  id: string; section: SettingsSection; title: string; description: string;
  scope: "account" | "project" | "projects" | "server" | "connections";
  keywords: string; permission?: Permission; guardDraft?: boolean;
}
export const SETTINGS_SCREENS: SettingsScreen[] = [
 { id: "notifications", section: "general", title: "Notifications", description: "Choose app events, filters, desktop alerts, tab badges and mobile push.", scope: "account", keywords: "subscribe following bell unread mobile notifications desktop", guardDraft: true },
  { id: "account", section: "general", title: "Your account", description: "Profile, usage allowance, and sign out.", scope: "account", keywords: "email profile logout quota limits" },
  { id: "appearance", section: "general", title: "Appearance & language", description: "Theme, light or dark mode, and display language.", scope: "account", keywords: "theme colors colour font translation" },
  { id: "interface", section: "general", title: "Interface & guide", description: "Personal, Business, or Developer experience and the product tour.", scope: "account", keywords: "onboarding explore tour personal business developer" },
  { id: "projects", section: "workspace", title: "Projects & members", description: "Organize projects and manage their members and invitations.", scope: "projects", keywords: "team invite permissions owner roles", guardDraft: true },
  { id: "pages", section: "workspace", title: "Pages & widgets", description: "Build personal pages using native and app widgets.", scope: "account", keywords: "dashboard layout builder global page", guardDraft: true },
  { id: "presets", section: "workspace", title: "Presets", description: "Browse starting points and save reusable project setups.", scope: "projects", keywords: "templates setup agents", guardDraft: true },
  { id: "providers", section: "ai", title: "Providers & defaults", description: "Connected AI providers, models, service tiers, and new-agent defaults.", scope: "connections", keywords: "openai claude anthropic codex gemini login model priority tokens", permission: "provider_management", guardDraft: true },
  { id: "helper", section: "ai", title: "Apteva Helper", description: "Activate Helper and choose its model and capabilities, including A2A.", scope: "account", keywords: "assistant collaboration agent to agent a2a tools skills", guardDraft: true },
  { id: "chat-assistant", section: "ai", title: "Chat button", description: "Show or hide the floating chat button and choose its agents.", scope: "account", keywords: "helper launcher bottom conversations default agent", guardDraft: true },
  { id: "integrations", section: "connections", title: "Connected services & apps", description: "Open existing integration and app management screens.", scope: "connections", keywords: "oauth credentials connections install marketplace apps" },
  { id: "mcp", section: "connections", title: "Custom MCP servers", description: "Manage additional tool servers and their connections.", scope: "connections", keywords: "tools transport sse endpoint integration", permission: "custom_mcp", guardDraft: true },
  { id: "subscriptions", section: "events", title: "Events & webhooks", description: "Choose app and integration events to send to your agents.", scope: "project", keywords: "subscriptions triggers notifications filters topics", guardDraft: true },
  { id: "security", section: "access", title: "Account security", description: "Password, two-factor authentication, and recovery codes.", scope: "account", keywords: "mfa 2fa totp passkey password recovery", guardDraft: true },
  { id: "api-keys", section: "access", title: "API keys", description: "Manage programmatic access, scopes, and expiry.", scope: "account", keywords: "token developer authentication private public client", permission: "api_keys", guardDraft: true },
  { id: "users", section: "access", title: "Users", description: "Manage accounts and administrator roles on this server.", scope: "server", keywords: "members people admin password reset", permission: "admin", guardDraft: true },
  { id: "access-policy", section: "access", title: "Registration & access policy", description: "Registration, account limits, managed AI, and workspace expiry.", scope: "server", keywords: "hosted users invitations signup provisioning managed model limits", permission: "admin", guardDraft: true },
  { id: "server", section: "server", title: "Public address & HTTPS", description: "Your public URL, domain, secure connection, and OAuth callback address.", scope: "server", keywords: "domain ssl tls certificate cloudflare public url https proxy tunnel", guardDraft: true },
  { id: "updates", section: "server", title: "Updates", description: "Installed version, available releases, and update progress.", scope: "server", keywords: "version upgrade release restart" },
  { id: "agent-lifecycle", section: "server", title: "Agent startup & restarts", description: "Control how agents resume on boot and during updates.", scope: "server", keywords: "lifecycle rolling preserve staggered delay boot", permission: "admin", guardDraft: true },
  { id: "geoip", section: "server", title: "Visitor country", description: "Configure country lookup for incoming requests.", scope: "server", keywords: "geoip maxmind dbip location database", permission: "admin", guardDraft: true },
  { id: "data", section: "server", title: "Telemetry cleanup", description: "Clear recorded model, tool, and thread activity.", scope: "server", keywords: "data wipe maintenance delete events logs", permission: "admin" },
];
export function canOpenSettingsScreen(screen: SettingsScreen, user: AuthUser | null | false): boolean {
  if (!user) return false;
  if (!screen.permission || user.role === "admin") return true;
  return screen.permission !== "admin" && !!user.capabilities[screen.permission];
}
export function settingsScopeLabel(screen: SettingsScreen, projectName?: string): string {
  switch (screen.scope) {
    case "account": return "Your account";
    case "server": return "Entire server";
    case "projects": return "Projects you can access";
    case "project": return projectName ? `Project: ${projectName}` : "All accessible projects";
    case "connections": return projectName ? `Project: ${projectName} · global connections also available` : "Global connections";
  }
}
