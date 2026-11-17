// AppDiscoverySelect — type=select_from_app config field renderer.
//
// Fetches options from a sibling app's HTTP route over the dashboard's
// same-origin session, then renders a <select>. Used at install time
// (InstallModal's renderConfigField in Apps.tsx) AND post-install
// (SettingsSection's FieldRow). Lived inline in Apps.tsx originally;
// extracted so both call sites can share it without duplication.
//
// Failure semantics mirror IntegrationDiscoverySelect: on any error
// AND field.fallback === "text", collapse to a plain text input
// with a one-line warning explaining what went wrong. The common
// failure mode is the named sibling app not being installed yet
// (404 from the fetch) — surfaced explicitly so the operator knows
// what to install.
//
// The fetch goes to /api/apps/{field.app}{field.discovery.route}.
// The route must be something the app exposes on its HTTPRoutes()
// surface — typically a list endpoint already used by the app's own
// panel.
import { useAppDiscovery } from "./appDiscovery";
export { pluckList, pluckField } from "./appDiscovery";
export interface AppDiscoveryField {
  name?: string;
  app?: string;
  fallback?: "text" | "";
  discovery?: {
    route?: string;
    response_path?: string;
    value_field?: string;
    label_field?: string;
  };
}
export function AppDiscoverySelect({
  field,
  value,
  onChange,
  installId,
  projectId,
  requiresBinding = false,
}: {
  field: AppDiscoveryField;
  value: string;
  onChange: (value: string) => void;
  installId?: number;
  projectId?: string;
  requiresBinding?: boolean;
}) {
  const d = field.discovery;
  const { options, error, loading, retry } = useAppDiscovery({
    app: field.app,
    route: d?.route,
    installId,
    projectId,
    responsePath: d?.response_path,
    valueField: d?.value_field,
    labelField: d?.label_field,
    enabled: !requiresBinding || !!installId,
  });
  if (requiresBinding && !installId)
    return <p className="text-xs text-red">Connect the required app first.</p>;
  if (loading) return <p className="text-xs text-text-dim">Loading options…</p>;
  if (!options.length)
    return (
      <div className="space-y-2">
        <p className="text-xs text-text-muted">
          {error || "No options returned by discovery."}
        </p>
        <button type="button" onClick={retry} className="text-xs text-accent">
          Retry
        </button>
        {field.fallback === "text" && (
          <input
            type="text"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            className="w-full rounded border border-border bg-bg-card px-2 py-1 text-sm"
          />
        )}
      </div>
    );
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full rounded border border-border bg-bg-card px-2 py-1 text-sm"
    >
      <option value="">(choose…)</option>
      {options.map((option, index) => (
        <option key={index} value={String(option.value)}>
          {option.label}
        </option>
      ))}
    </select>
  );
}
