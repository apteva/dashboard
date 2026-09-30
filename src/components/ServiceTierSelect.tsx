import { useId } from "react";
import type { RuntimeConnection } from "../api";

export function agentServiceTiers(config?: string): Record<string, string | null> {
  try { return JSON.parse(config || "{}").service_tier_overrides || {}; }
  catch { return {}; }
}

// Send only edited keys: unrelated saves must preserve overrides added elsewhere.
export function serviceTierPatch(config: string | undefined, values: Record<string, string | null>): Record<string, string | null> {
  const saved = agentServiceTiers(config);
  return Object.fromEntries(Object.entries(values).filter(([key, value]) => (saved[key] ?? null) !== value));
}

export function ServiceTierSelect({ connection, value, onChange, inherit = false, disabled = false }: {
  connection?: RuntimeConnection | null;
  value?: string | null;
  onChange: (value: string | null) => void;
  inherit?: boolean;
  disabled?: boolean;
}) {
  const id = useId();
  if (!connection?.service_tiers?.length) return null;
  const label = (tier: string) => tier === "priority" ? "Priority requested" : tier;
  const inherited = connection.runtime_config?.service_tier;
  return <div className="grid gap-1.5">
    <label htmlFor={id} className="text-xs font-semibold text-text-muted">Service tier</label>
    <select id={id} value={value == null ? (inherit ? "inherit" : "") : value} disabled={disabled}
      onChange={(event) => onChange(event.target.value === "inherit" ? null : event.target.value)}
      className="min-h-10 w-full rounded-lg border border-border bg-bg-input px-3 text-sm text-text focus:border-accent focus:outline-none disabled:opacity-50">
      {inherit && <option value="inherit">Inherit connection ({inherited ? label(inherited) : "Default"})</option>}
      <option value="">Default</option>
      {connection.service_tiers.map((tier) => <option key={tier} value={tier}>{label(tier)}</option>)}
    </select>
    <p className="text-[11px] leading-relaxed text-text-dim">Requests the selected processing tier. Falls back to default if the provider rejects it.{!inherit && " Existing agents pick up this default when their configuration is applied or they restart."}</p>
  </div>;
}
