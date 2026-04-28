// Native panel registry. First-party apps register a React component
// per slot here so the dashboard mounts them inline (theme tokens,
// router, auth context all inherited) instead of iframing the
// sidecar's HTML. Third-party apps with no entry here fall back to
// the iframe path in AppPanels / AppProjectPage.
//
// The component contract is small on purpose — every panel receives
// the props the host already has, talks to the sidecar via plain
// fetch() against /api/apps/<name>/* (the proxy forwards with the
// install token injected), and styles itself with the host's
// Tailwind tokens.

import type { ComponentType } from "react";
import { StoragePanel } from "./StoragePanel";
import { CrmPanel } from "./CrmPanel";

export interface NativePanelProps {
  appName: string;
  installId: number;
  projectId: string;
  instanceId?: number;
}

type SlotMap = Partial<Record<string, ComponentType<NativePanelProps>>>;

// appName → slot → component
const REGISTRY: Record<string, SlotMap> = {
  storage: {
    "project.page": StoragePanel,
  },
  crm: {
    "project.page": CrmPanel,
  },
};

export function getNativePanel(
  appName: string,
  slot: string,
): ComponentType<NativePanelProps> | null {
  return REGISTRY[appName]?.[slot] ?? null;
}
