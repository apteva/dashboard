import type { Audience } from "../../hooks/useAudience";

export interface TourStep {
  id: string;
  title: string;
  description: string;
  target: string;
  route?: string;
  navigation?: boolean;
  audiences?: Audience[];
  requiresNav?: string;
  unlessNav?: string;
}

// Edit this registry to change the tour. Targets are stable data-tour hooks,
// never translated labels or CSS classes. A new id gives a tour fresh history.
export const PRODUCT_TOUR = {
  id: "explore-apteva-v1",
  enabled: true,
  title: "Make yourself at home",
  description: "Take a quick look around your workspace, agents, and apps. You can skip at any time.",
  steps: [
    { id: "workspace", title: "Your workspace", target: "workspace", navigation: true,
      description: "Projects keep your agents, apps, and connected accounts organized. Use this menu to switch between the workspaces you can access." },
    { id: "agents", title: "Agents do the work", target: "nav-/agents", route: "/agents", navigation: true, requiresNav: "/agents",
      description: "An agent has a role, instructions, and attached capabilities. Open one to see its activity, configure its behavior, and choose what it can use." },
    { id: "personal-agents", title: "Your agents, close at hand", target: "personal-agents", navigation: true, audiences: ["personal"],
      description: "Your workspace's agents appear here. Each agent has its own role, instructions, and capabilities supplied by the apps you choose to attach." },
    { id: "apps", title: "Apps add capabilities", target: "nav-/apps", route: "/apps", navigation: true, requiresNav: "/apps",
      description: "Apps are building blocks for your workspace. An app can provide tools for agents, its own pages, and dashboard widgets. Install the apps you need, then attach their capabilities to the relevant agents." },
    { id: "personal-apps", title: "Apps make your agent more useful", target: "workspace", navigation: true, unlessNav: "/apps",
      description: "Apps add tools, pages, and widgets to your workspace. You choose which apps to install. Attaching an app gives an agent access to its capabilities; connecting an external account supplies the access those tools need." },
    { id: "integrations", title: "Connect your accounts", target: "nav-/integrations", route: "/integrations", navigation: true, requiresNav: "/integrations",
      description: "Integrations connect services such as email or a CRM using your account credentials. Apps provide the experience and tools; integrations provide access to external services. Choose which connections an agent can use." },
    { id: "widgets", title: "Make Home useful to you", target: "add-widget", route: "/", audiences: ["business", "developer"], requiresNav: "/",
      description: "Widgets show activity, results, and views supplied by installed apps. Add the ones you need and use Edit layout to arrange or resize them. Agent overviews have their own widgets too." },
    { id: "settings", title: "Explore at your own pace", target: "nav-/settings", route: "/settings?tab=interface", navigation: true,
      description: "Settings lets you choose your interface and appearance. You can replay this guide here anytime. Finish returns you to where you started." },
  ] satisfies TourStep[],
};

export const PRODUCT_TOUR_EVENT = "apteva:explore";
export function requestProductTour() { window.dispatchEvent(new Event(PRODUCT_TOUR_EVENT)); }
