export interface RuntimeProviderSelection {
  name: string;
  default?: boolean;
}

function providerKey(value: string): string {
  return value.toLowerCase().trim().replace(/\s+/g, "-");
}

function savedDefaultProvider(configJSON: string): string {
  try {
    const config = JSON.parse(configJSON || "{}");
    return typeof config.default_provider === "string"
      ? providerKey(config.default_provider)
      : "";
  } catch {
    return "";
  }
}

export function resolveEffectiveAgentProvider(
  agentConfigJSON: string,
  runtimeProviders?: RuntimeProviderSelection[],
): string {
  const textProviders = (runtimeProviders || []).filter(
    (provider) => !providerKey(provider.name).endsWith("-realtime"),
  );
  const runtimeDefault = textProviders.find((provider) => provider.default) || textProviders[0];
  if (runtimeDefault) return providerKey(runtimeDefault.name);
  return savedDefaultProvider(agentConfigJSON);
}

/** The model this agent pins for `providerName`, or "" for the provider's
 *  own Large/Medium/Small models. The server keeps one override and only
 *  applies it while its provider is the agent's default. */
export function savedAgentModelOverride(agentConfigJSON: string, providerName: string): string {
  try {
    const override = JSON.parse(agentConfigJSON || "{}")?.model_override;
    if (!override || providerKey(String(override.provider || "")) !== providerKey(providerName)) return "";
    return String(override.model || "").trim();
  } catch {
    return "";
  }
}
