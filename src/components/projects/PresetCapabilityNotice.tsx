import type { ProjectPresetAgent } from "../../api";

export function PresetCapabilityNotice({ agents }: { agents: ProjectPresetAgent[] }) {
  const grants = agents.flatMap((agent) => (agent.capabilities || []).map((capability) => ({ agent, capability })));
  if (!grants.length) return null;
  return <section aria-label="Agent permissions" className="rounded-lg border border-border p-3 text-xs leading-5 text-text-muted">
    <h3 className="font-semibold text-text">Agent permissions</h3>
    {grants.map(({agent, capability}) => <div key={`${agent.key}:${capability.name}`} className="mt-2">
      <p>{agent.name}: {capability.name === "apteva-server" ? "Apteva Server — can create and configure ordinary agents in this project when you request it. New agents do not inherit this management access." : capability.name}</p>
      <details className="mt-1"><summary className="cursor-pointer">Allowed tools</summary><p className="mt-1 break-words">{capability.allowed_tools.join(", ") || "None"}</p></details>
    </div>)}
    <p className="mt-2">External actions and connected accounts remain subject to their existing permissions.</p>
  </section>;
}
