export type SettingValue = string | number | boolean;
export interface WidgetSettingsDiscovery {
  route: string;
  query?: Record<
    string,
    | SettingValue
    | null
    | {
        setting: string;
      }
  >;
  response_path?: string;
  value_field?: string;
  label_field?: string;
}
export interface WidgetSettingsUI {
  order?: string[];
  steps?: Array<{
    id: string;
    title: string;
    fields: string[];
  }>;
  advanced?: string[];
  fields?: Record<
    string,
    {
      discovery?: WidgetSettingsDiscovery;
    }
  >;
  preview?: boolean;
}
export interface SettingProperty {
  type?: string;
  title?: string;
  description?: string;
  default?: unknown;
  enum?: unknown[];
  minimum?: number;
  maximum?: number;
}
export function settingProperties(
  schema?: Record<string, unknown>,
): Record<string, SettingProperty> {
  if (
    !schema?.properties ||
    typeof schema.properties !== "object" ||
    Array.isArray(schema.properties)
  )
    return {};
  return Object.fromEntries(
    Object.entries(schema.properties).filter(
      ([, p]) => p && typeof p === "object" && !Array.isArray(p),
    ),
  ) as Record<string, SettingProperty>;
}
export const settingsDefaults = (schema?: Record<string, unknown>) =>
  Object.fromEntries(
    Object.entries(settingProperties(schema))
      .filter(([, p]) => Object.hasOwn(p, "default"))
      .map(([name, p]) => [name, p.default]),
  );
export function settingErrors(
  schema: Record<string, unknown> | undefined,
  settings: Record<string, unknown>,
) {
  const properties = settingProperties(schema);
  const errors: Record<string, string> = {};
  for (const name of (schema?.required || []) as string[])
    if (settings[name] === undefined || settings[name] === null)
      errors[name] = "Required";
  for (const [name, value] of Object.entries(settings)) {
    const p = properties[name];
    if (!p) {
      if (schema?.additionalProperties === false)
        errors[name] = "Unknown setting";
      continue;
    }
    let valid = true;
    if (p.type === "integer")
      valid = typeof value === "number" && Number.isSafeInteger(value);
    else if (p.type === "number")
      valid = typeof value === "number" && Number.isFinite(value);
    else if (p.type === "array") valid = Array.isArray(value);
    else if (p.type === "object")
      valid =
        typeof value === "object" && value !== null && !Array.isArray(value);
    else if (p.type) valid = typeof value === p.type;
    if (!valid) errors[name] = `Expected ${p.type}`;
    else if (
      typeof value === "number" &&
      ((p.minimum !== undefined && value < p.minimum) ||
        (p.maximum !== undefined && value > p.maximum))
    )
      errors[name] = "Outside the allowed range";
    else if (
      p.enum &&
      !p.enum.some((option) => JSON.stringify(option) === JSON.stringify(value))
    )
      errors[name] = "Choose an allowed value";
  }
  return errors;
}
export function discoveryQuery(
  discovery: WidgetSettingsDiscovery,
  settings: Record<string, unknown>,
) {
  const query: Record<string, SettingValue> = {};
  let ready = true;
  for (const [key, entry] of Object.entries(discovery.query || {})) {
    const value =
      entry && typeof entry === "object" ? settings[entry.setting] : entry;
    if (value === null || value === undefined || value === "") {
      if (entry && typeof entry === "object") ready = false;
      continue;
    }
    if (["string", "number", "boolean"].includes(typeof value))
      query[key] = value as SettingValue;
  }
  return { query, ready };
}
