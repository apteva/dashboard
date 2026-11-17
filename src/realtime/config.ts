import type { RealtimeExecutionConfig } from "../api";

export interface RealtimeCapabilities {
  continuous_conversation?: boolean;
  provider_execution?: boolean;
  core_execution?: boolean;
  transcript_fragments?: boolean;
  provider_interruption?: boolean;
  audio_truncation?: boolean;
}
export interface CoreProviderConfig {
  name: string;
  default?: boolean;
  models?: Record<string, string>;
  realtime_models?: Record<string, string>;
  realtime_voice?: string;
  realtime_execution?: RealtimeExecutionConfig;
  service_tier?: string;
}
export interface RealtimeProviderConfig extends CoreProviderConfig {
  integration: string;
  capabilities?: Record<string, RealtimeCapabilities>;
}
export interface RealtimeConfig {
  providers?: CoreProviderConfig[];
  realtime_providers?: Array<{ integration: string; provider: string; models: Record<string, string>; capabilities?: Record<string, RealtimeCapabilities> }>;
  realtime_provider?: string;
  realtime_model?: string;
  realtime_voice?: string;
}

// Core metadata is authoritative. The suffix adapter is only for older Core.
export function realtimeProviders(config: RealtimeConfig): RealtimeProviderConfig[] {
  const providers = config.providers || [];
  if (config.realtime_providers !== undefined && config.realtime_providers !== null) {
    return config.realtime_providers.map((info) => {
      const adapter = providers.find((p) => p.name === info.provider);
      const integration = providers.find((p) => p.name === info.integration);
      return { ...adapter, name: info.provider, integration: info.integration, models: info.models,
        capabilities: info.capabilities, realtime_voice: integration?.realtime_voice || adapter?.realtime_voice,
        realtime_execution: adapter?.realtime_execution || integration?.realtime_execution };
    });
  }
  return providers.filter((p) => p.name.endsWith("-realtime")).map((p) => ({ ...p, integration: p.name.replace(/-realtime$/, "") }));
}
export function realtimeSelection(config: RealtimeConfig) {
  const providers = realtimeProviders(config);
  const provider = providers.find((p) => p.name === config.realtime_provider || p.integration === config.realtime_provider)
    || providers.find((p) => p.default) || providers[0];
  const model = config.realtime_model || provider?.models?.large || "";
  const modelTier = (["large", "medium", "small"] as const).find((tier) => provider?.models?.[tier] === model) || "large";
  return { providers, provider, model, modelTier,
    voice: config.realtime_voice || provider?.realtime_voice || "",
    execution: provider?.realtime_execution };
}
