import { useEffect, useLayoutEffect, useId, useState } from "react";
import { useAppDiscovery } from "./appDiscovery";
import {
  discoveryQuery,
  settingErrors,
  settingProperties,
  type SettingProperty,
  type WidgetSettingsDiscovery,
  type WidgetSettingsUI,
} from "./widgetSettings";
const input =
  "min-h-10 w-full rounded-lg border border-border bg-bg-input px-3 py-2 text-sm text-text focus:border-accent focus:outline-none";
interface Props {
  schema?: Record<string, unknown>;
  settings: Record<string, unknown>;
  onChange: (value: Record<string, unknown>) => void;
  ui?: WidgetSettingsUI;
  app?: string;
  installId?: number;
  projectId?: string;
  fields?: string[];
  onFieldStatus?: (name: string, error: string) => void;
}
function DynamicSetting({
  name,
  property,
  discovery,
  settings,
  app,
  installId,
  projectId,
  onChange,
  onFieldStatus,
  required,
}: {
  name: string;
  property: SettingProperty;
  discovery: WidgetSettingsDiscovery;
  settings: Record<string, unknown>;
  app?: string;
  installId?: number;
  projectId?: string;
  onChange: (value: unknown) => void;
  onFieldStatus?: Props["onFieldStatus"];
  required: boolean;
}) {
  const id = useId();
  const { query, ready } = discoveryQuery(discovery, settings);
  const lookup = useAppDiscovery({
    app,
    route: discovery.route,
    installId,
    projectId,
    query,
    responsePath: discovery.response_path,
    valueField: discovery.value_field,
    labelField: discovery.label_field,
    enabled: ready && !!installId,
    maxOptions: 1000,
  });
  const value = settings[name] ?? property.default;
  const options = lookup.options.filter(
    (option) =>
      !property.type ||
      (property.type === "integer"
        ? typeof option.value === "number" && Number.isSafeInteger(option.value)
        : typeof option.value === property.type),
  );
  const index = options.findIndex((option) => option.value === value);
  const chosen = value !== undefined && value !== null && value !== "";
  const error =
    !app || !installId
      ? "Widget installation is unavailable"
      : !ready
        ? "Choose the preceding options first"
        : lookup.loading
          ? "Loading options…"
          : lookup.error ||
            (!options.length
              ? "No options available"
              : chosen && index < 0
                ? "The current value is unavailable; choose another option"
                : required && !chosen
                  ? "Choose an option"
                  : "");
  useLayoutEffect(() => {
    onFieldStatus?.(name, required || chosen ? error : "");
    return () => onFieldStatus?.(name, "");
  }, [name, error, onFieldStatus, required, chosen]);
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="block text-sm text-text">
        {property.title || name.replaceAll("_", " ")}
      </label>
      <select
        id={id}
        value={index < 0 ? "" : String(index)}
        disabled={!ready || lookup.loading || !installId}
        onChange={(e) =>
          onChange(
            e.target.value === ""
              ? undefined
              : options[Number(e.target.value)].value,
          )
        }
        className={input}
      >
        <option value="">
          {chosen && index < 0 ? `Current: ${String(value)}` : "Choose…"}
        </option>
        {options.map((option, i) => (
          <option value={i} key={i}>
            {option.label}
          </option>
        ))}
      </select>
      {property.description && (
        <p className="text-xs text-text-muted">{property.description}</p>
      )}
      {error && (
        <p
          role={lookup.error || (chosen && index < 0) ? "alert" : "status"}
          className="text-xs text-text-muted"
        >
          {error}
        </p>
      )}
      {!lookup.loading && ready && (
        <button
          type="button"
          className="text-xs text-accent"
          onClick={lookup.retry}
        >
          Refresh options
        </button>
      )}
    </div>
  );
}
function JSONSetting({
  name,
  label,
  value,
  onChange,
  onFieldStatus,
}: {
  name: string;
  label: string;
  value: unknown;
  onChange: (value: unknown) => void;
  onFieldStatus?: Props["onFieldStatus"];
}) {
  const [text, setText] = useState(() =>
    JSON.stringify(value ?? null, null, 2),
  );
  useEffect(() => () => onFieldStatus?.(name, ""), [name, onFieldStatus]);
  return (
    <label className="block text-sm">
      {label}
      <textarea
        className={`${input} mt-1 font-mono`}
        value={text}
        onChange={(event) => {
          setText(event.target.value);
          try {
            onChange(JSON.parse(event.target.value));
            onFieldStatus?.(name, "");
          } catch {
            onFieldStatus?.(name, "Enter valid JSON");
          }
        }}
      />
    </label>
  );
}
export function WidgetSettingsEditor({
  schema,
  settings,
  onChange,
  ui,
  app,
  installId,
  projectId,
  fields,
  onFieldStatus,
}: Props) {
  const properties = settingProperties(schema);
  const errors = settingErrors(schema, settings);
  const ordered = [
    ...new Set([...(ui?.order || []), ...Object.keys(properties)]),
  ].filter((name) => properties[name]);
  const set = (name: string, value: unknown) => {
    const next = { ...settings };
    if (value === undefined) delete next[name];
    else next[name] = value;
    onChange(next);
  };
  const render = (name: string) => {
    const p = properties[name];
    const label = p.title || name.replaceAll("_", " ");
    const value = settings[name] ?? p.default;
    const discovery = ui?.fields?.[name]?.discovery;
    return (
      <div
        key={name}
        hidden={!!fields && !fields.includes(name)}
        className="min-w-0 space-y-1"
      >
        {discovery ? (
          <DynamicSetting
            name={name}
            property={p}
            required={((schema?.required || []) as string[]).includes(name)}
            discovery={discovery}
            settings={settings}
            app={app}
            installId={installId}
            projectId={projectId}
            onChange={(v) => set(name, v)}
            onFieldStatus={onFieldStatus}
          />
        ) : p.enum?.length ? (
          <label className="block text-sm">
            {label}
            <select
              className={`${input} mt-1`}
              value={
                p.enum.findIndex(
                  (option) => JSON.stringify(option) === JSON.stringify(value),
                ) < 0
                  ? ""
                  : String(
                      p.enum.findIndex(
                        (option) =>
                          JSON.stringify(option) === JSON.stringify(value),
                      ),
                    )
              }
              onChange={(e) =>
                set(
                  name,
                  e.target.value === ""
                    ? undefined
                    : p.enum![Number(e.target.value)],
                )
              }
            >
              <option value="">Choose…</option>
              {p.enum.map((option, i) => (
                <option key={i} value={i}>
                  {String(option)}
                </option>
              ))}
            </select>
          </label>
        ) : p.type === "boolean" ? (
          <label className="flex min-h-10 items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={value === true}
              onChange={(e) => set(name, e.target.checked)}
              className="accent-accent"
            />
            {label}
          </label>
        ) : p.type === "object" || p.type === "array" ? (
          <JSONSetting
            name={name}
            label={label}
            value={value}
            onChange={(v) => set(name, v)}
            onFieldStatus={onFieldStatus}
          />
        ) : (
          <label className="block text-sm">
            {label}
            <input
              className={`${input} mt-1`}
              type={
                p.type === "integer" || p.type === "number" ? "number" : "text"
              }
              min={p.minimum}
              max={p.maximum}
              step={
                p.type === "integer"
                  ? 1
                  : p.type === "number"
                    ? "any"
                    : undefined
              }
              value={String(value ?? "")}
              onChange={(e) =>
                set(
                  name,
                  p.type === "integer" || p.type === "number"
                    ? e.target.value === ""
                      ? undefined
                      : Number(e.target.value)
                    : e.target.value,
                )
              }
            />
          </label>
        )}
        {!discovery && p.description && (
          <p className="text-xs text-text-muted">{p.description}</p>
        )}
        {errors[name] && (
          <p role="alert" className="text-xs text-red">
            {errors[name]}
          </p>
        )}
      </div>
    );
  };
  const advanced = ordered.filter((name) => ui?.advanced?.includes(name));
  return (
    <div className="space-y-4">
      {ordered.filter((name) => !advanced.includes(name)).map(render)}
      {advanced.length > 0 && (
        <details
          hidden={!!fields && !advanced.some((name) => fields.includes(name))}
        >
          <summary className="min-h-10 cursor-pointer text-sm text-text-muted">
            Advanced
            {advanced.some((name) => errors[name]) ? " · check settings" : ""}
          </summary>
          <div className="space-y-4">{advanced.map(render)}</div>
        </details>
      )}
    </div>
  );
}
