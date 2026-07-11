import { useTranslation } from "react-i18next";
import type { ProviderUsageLimit, ProviderUsageSnapshot, ProviderUsageWindow } from "../api";

interface ProviderUsageSummaryProps {
  usage?: ProviderUsageSnapshot;
  loading?: boolean;
  error?: string;
  refreshing?: boolean;
  onRefresh: () => void;
  onOpenDetails: () => void;
}

export function providerUsageWindowLabel(durationMinutes = 0): string {
  if (durationMinutes > 0 && durationMinutes % 10080 === 0) return `${durationMinutes / 10080}w`;
  if (durationMinutes > 0 && durationMinutes % 1440 === 0) return `${durationMinutes / 1440}d`;
  if (durationMinutes > 0 && durationMinutes % 60 === 0) return `${durationMinutes / 60}h`;
  return durationMinutes > 0 ? `${durationMinutes}m` : "--";
}

function remainingDuration(resetAt?: string): string {
  if (!resetAt) return "";
  const milliseconds = new Date(resetAt).getTime() - Date.now();
  if (!Number.isFinite(milliseconds) || milliseconds <= 0) return "0m";
  const minutes = Math.ceil(milliseconds / 60_000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainderMinutes = minutes % 60;
  if (hours < 24) return remainderMinutes ? `${hours}h ${remainderMinutes}m` : `${hours}h`;
  const days = Math.floor(hours / 24);
  const remainderHours = hours % 24;
  return remainderHours ? `${days}d ${remainderHours}h` : `${days}d`;
}

function usageTone(percent: number): { bar: string; text: string } {
  if (percent >= 90) return { bar: "bg-red", text: "text-red" };
  if (percent >= 70) return { bar: "bg-yellow", text: "text-yellow" };
  return { bar: "bg-accent", text: "text-text-muted" };
}

function primaryUsageLimit(usage?: ProviderUsageSnapshot): ProviderUsageLimit | undefined {
  const limits = usage?.limits || [];
  return limits.find((limit) => limit.id === "codex") || limits[0];
}

function UsageWindowRow({ window }: { window: ProviderUsageWindow }) {
  const { t } = useTranslation();
  const percent = Math.max(0, Math.min(100, Math.round(window.used_percent || 0)));
  const tone = usageTone(percent);
  const remaining = remainingDuration(window.resets_at);
  return (
    <div className="grid grid-cols-[2.5rem_minmax(0,1fr)_auto] items-center gap-2 min-h-5">
      <span className="text-[10px] text-text-dim tabular-nums">
        {providerUsageWindowLabel(window.duration_minutes)}
      </span>
      <div
        className="h-1.5 bg-bg-hover overflow-hidden"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        aria-label={t("settings.providers.usagePercent", { percent })}
      >
        <div className={`h-full ${tone.bar} transition-[width] duration-300`} style={{ width: `${percent}%` }} />
      </div>
      <span className={`text-[10px] tabular-nums whitespace-nowrap ${tone.text}`}>
        {percent}%
        {remaining ? <span className="text-text-dim"> · {t("settings.providers.resetsIn", { time: remaining })}</span> : null}
      </span>
    </div>
  );
}

export function ProviderUsageSummary({
  usage,
  loading,
  error,
  refreshing,
  onRefresh,
  onOpenDetails,
}: ProviderUsageSummaryProps) {
  const { t } = useTranslation();
  if (usage && !usage.supported) return null;
  const primary = primaryUsageLimit(usage);
  const additionalCount = Math.max(0, (usage?.limits?.length || 0) - (primary ? 1 : 0));

  return (
    <div className="border-y border-border/70 py-2 my-2 min-h-[3.75rem]" onClick={(event) => event.stopPropagation()}>
      <div className="flex items-center justify-between gap-2 mb-1">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-[10px] uppercase text-text-dim truncate">{t("settings.providers.subscriptionUsage")}</span>
          {usage?.plan ? <span className="text-[10px] text-text-muted">{usage.plan}</span> : null}
          {usage?.stale ? <span className="text-[10px] text-yellow">{t("settings.providers.stale")}</span> : null}
        </div>
        <button
          type="button"
          onClick={onRefresh}
          disabled={refreshing || loading}
          className="w-5 h-5 inline-flex items-center justify-center text-text-dim hover:text-accent disabled:opacity-40"
          title={t("settings.providers.refreshUsage")}
          aria-label={t("settings.providers.refreshUsage")}
        >
          <span className={refreshing ? "animate-spin" : ""}>↻</span>
        </button>
      </div>

      {loading && !usage ? (
        <div className="text-[10px] text-text-dim py-2">{t("settings.providers.loadingUsage")}</div>
      ) : error && !usage ? (
        <div className="text-[10px] text-yellow py-2 truncate" title={error}>{t("settings.providers.usageUnavailable")}</div>
      ) : primary && (primary.windows?.length || 0) > 0 ? (
        <div className="space-y-1">
          {(primary.windows || []).map((window) => <UsageWindowRow key={window.id} window={window} />)}
          {additionalCount > 0 ? (
            <button type="button" onClick={onOpenDetails} className="text-[10px] text-text-dim hover:text-accent">
              {t("settings.providers.additionalLimits", { count: additionalCount })}
            </button>
          ) : null}
        </div>
      ) : (
        <div className="text-[10px] text-text-dim py-2">{t("settings.providers.noUsageData")}</div>
      )}
    </div>
  );
}

export function ProviderUsageDetails({ usage }: { usage: ProviderUsageSnapshot }) {
  const { t } = useTranslation();
  return (
    <div className="divide-y divide-border">
      {(usage.limits || []).map((limit) => (
        <section key={limit.id} className="py-4 first:pt-0 last:pb-0">
          <div className="flex items-center justify-between gap-3 mb-3">
            <div className="min-w-0">
              <h4 className="text-sm font-bold text-text truncate">{limit.label || limit.id}</h4>
              <div className="text-[10px] text-text-dim">{limit.id}</div>
            </div>
            {limit.reached ? <span className="text-[10px] text-red">{t("settings.providers.limitReached")}</span> : null}
          </div>
          <div className="space-y-2">
            {(limit.windows || []).map((window) => <UsageWindowRow key={window.id} window={window} />)}
            {(limit.windows || []).length === 0 ? (
              <div className="text-xs text-text-dim">{t("settings.providers.noUsageData")}</div>
            ) : null}
          </div>
        </section>
      ))}
    </div>
  );
}
