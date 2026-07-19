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
