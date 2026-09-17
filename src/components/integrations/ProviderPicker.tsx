import { AppIcon } from "@apteva/ui-kit";
import type { RuntimeCatalogEntry } from "../../api";

/** Shared provider catalog for Settings and first-time setup. */
export function ProviderPicker({ entries, query, onQueryChange, onSelect, connectedSlugs = [], disabled = false, actionLabel = "Connect", showDescriptions = true }: {
  entries: RuntimeCatalogEntry[];
  query: string;
  onQueryChange: (query: string) => void;
  onSelect: (entry: RuntimeCatalogEntry) => void;
  connectedSlugs?: string[];
  disabled?: boolean;
  actionLabel?: string;
  showDescriptions?: boolean;
}) {
  const filtered = entries.filter((entry) =>
    `${entry.name} ${entry.provider_key} ${entry.description}`.toLowerCase().includes(query.trim().toLowerCase()),
  );
  return <div className="min-h-0 flex flex-col">
    <input
      autoFocus
      type="search"
      aria-label="Search providers"
      placeholder="Search providers…"
      value={query}
      disabled={disabled}
      onChange={(event) => onQueryChange(event.target.value)}
      className="w-full rounded-lg border border-border bg-transparent px-3 py-2.5 text-sm text-text focus:outline-none focus:border-accent disabled:opacity-50"
    />
    <div className="mt-3 max-h-80 overflow-y-auto overscroll-contain space-y-1" aria-label="Available providers">
      {filtered.map((entry) => <button
        key={entry.slug}
        type="button"
        disabled={disabled}
        onClick={() => onSelect(entry)}
        className="flex w-full items-center gap-3 rounded-lg p-3 text-left hover:bg-bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent transition-colors disabled:opacity-50"
      >
        <AppIcon src={entry.logo || undefined} name={entry.name} size="md" framed={false} className="rounded-lg bg-white text-black" />
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold text-text">{entry.name}</span>
          {showDescriptions && entry.description && <span className="text-xs text-text-muted line-clamp-2 mt-1">{entry.description}</span>}
        </span>
        <span className="shrink-0 text-xs text-accent">{connectedSlugs.includes(entry.slug) ? "Add another" : actionLabel}</span>
      </button>)}
      {filtered.length === 0 && <div className="py-8 text-center text-sm text-text-muted" role="status">
        <p>{entries.length ? "No providers match your search." : "No providers available."}</p>
        {query && <button type="button" disabled={disabled} onClick={() => onQueryChange("")} className="mt-3 text-accent hover:underline">Clear search</button>}
      </div>}
    </div>
  </div>;
}
