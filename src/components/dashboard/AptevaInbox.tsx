import { useCallback, useEffect, useMemo, useState } from "react";
import {
  chat,
  type AlertMessageRow,
  type ApprovalMessageRow,
  type ChatMessageRow,
  type ReportMessageRow,
} from "../../api";
import { useProjects } from "../../hooks/useProjects";
import { Modal } from "../Modal";

type InboxItem =
  | { kind: "approval"; row: ApprovalMessageRow }
  | { kind: "report"; row: ReportMessageRow }
  | { kind: "alert"; row: AlertMessageRow };

export function AptevaInbox({
  allProjects = false,
  limit = 12,
}: {
  allProjects?: boolean;
  limit?: number;
}) {
  const { currentProject } = useProjects();
  const [approvals, setApprovals] = useState<ApprovalMessageRow[]>([]);
  const [reports, setReports] = useState<ReportMessageRow[]>([]);
  const [alerts, setAlerts] = useState<AlertMessageRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const load = useCallback(() => {
    const projectId = allProjects ? undefined : currentProject?.id;
    if (!allProjects && !projectId) {
      setApprovals([]);
      setReports([]);
      setAlerts([]);
      return;
    }
    setLoading(true);
    setError(null);
    Promise.all([
      chat.approvalMessages(projectId, "pending", limit),
      chat.reportMessages(projectId, limit),
      chat.alertMessages(projectId, limit),
    ])
      .then(([approvalRows, reportRows, alertRows]) => {
        setApprovals(approvalRows);
        setReports(reportRows);
        setAlerts(alertRows);
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, [allProjects, currentProject?.id, limit]);

  useEffect(() => {
    let timer: number | null = null;
    const onInboxMessage = () => {
      if (timer !== null) window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        timer = null;
        load();
      }, 150);
    };
    window.addEventListener("apteva.inboxMessage", onInboxMessage);
    return () => {
      window.removeEventListener("apteva.inboxMessage", onInboxMessage);
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [load]);

  useEffect(() => {
    load();
  }, [load]);

  const updateApprovalMessage = useCallback((message: ChatMessageRow) => {
    setApprovals((prev) =>
      prev
        .map((row) =>
          row.message.id === message.id
            ? { ...row, message, status: approvalStatus(message) }
            : row,
        )
        .filter((row) => row.status === "pending"),
    );
  }, []);

  const removeMessage = useCallback((messageId: number) => {
    setApprovals((prev) => prev.filter((row) => row.message.id !== messageId));
    setReports((prev) => prev.filter((row) => row.message.id !== messageId));
    setAlerts((prev) => prev.filter((row) => row.message.id !== messageId));
  }, []);

  const items = useMemo(() => {
    const merged: InboxItem[] = [
      ...approvals.map((row): InboxItem => ({ kind: "approval", row })),
      ...reports.map((row): InboxItem => ({ kind: "report", row })),
      ...alerts.map((row): InboxItem => ({ kind: "alert", row })),
    ];
    return merged
      .sort((a, b) => b.row.message.id - a.row.message.id)
      .slice(0, limit);
  }, [alerts, approvals, reports, limit]);

  return (
    <section className="border border-border bg-bg-card rounded-lg min-h-[300px] flex flex-col overflow-hidden">
      <div className="px-4 py-3 border-b border-border flex items-center justify-between gap-3">
        <div>
          <h2 className="text-text text-sm font-bold">Apteva Inbox</h2>
          <p className="text-text-dim text-[11px] mt-0.5">
            Approvals, reports, and alerts from agents
          </p>
        </div>
        <button
          type="button"
          onClick={load}
          disabled={loading}
          className="text-[11px] text-text-muted hover:text-text disabled:opacity-40"
        >
          {loading ? "Loading..." : "Refresh"}
        </button>
      </div>

      <div className="flex-1 p-3 space-y-3 overflow-auto">
        {error && (
          <div className="rounded border border-red/30 bg-red/10 px-3 py-2 text-[11px] text-red">
            {error}
          </div>
        )}
        {!loading && !error && items.length === 0 && (
          <div className="h-full min-h-[180px] flex items-center justify-center text-center text-xs text-text-muted">
            No inbox items
          </div>
        )}
        {items.map((item) => (
          <InboxRow
            key={`${item.kind}-${item.row.message.id}`}
            item={item}
            now={now}
            onApprovalUpdated={updateApprovalMessage}
            onDismissed={removeMessage}
            onActionComplete={load}
          />
        ))}
      </div>
    </section>
  );
}

function InboxRow({
  item,
  now,
  onApprovalUpdated,
  onDismissed,
  onActionComplete,
}: {
  item: InboxItem;
  now: number;
  onApprovalUpdated: (message: ChatMessageRow) => void;
  onDismissed: (messageId: number) => void;
  onActionComplete: () => void;
}) {
  const [reportOpen, setReportOpen] = useState(false);
  const [alertOpen, setAlertOpen] = useState(false);
  const [submitting, setSubmitting] = useState<string | null>(null);
  const row = item.row;
  const component = getChannelComponent(row.message, `${item.kind}-card`);
  const props = component?.props || {};
  const label =
    item.kind === "approval"
      ? "Approval"
      : item.kind === "report"
        ? "Report"
        : "Alert";
  const title = row.title;
  const meta =
    item.kind === "approval"
      ? item.row.status
        : item.kind === "report"
          ? item.row.period || "report"
          : item.row.severity || "alert";
  const createdAt = parseInboxTime(row.message.created_at);
  const relativeTime = formatRelativeInboxTime(createdAt, now);
  const exactTime = createdAt ? formatExactInboxTime(createdAt) : row.message.created_at;
  const preview = item.kind === "report"
    ? item.row.summary
    : item.kind === "approval"
      ? item.row.body
      : item.row.body;
  const report = item.kind === "report" ? parseReportProps(props, item.row) : null;
  const approval = item.kind === "approval" ? parseApprovalProps(props, item.row) : null;
  const alert = item.kind === "alert" ? parseAlertProps(props, item.row) : null;
  const tone = inboxTone(item, alert?.severity);

  const sendApprovalAction = async (actionId: string) => {
    if (item.kind !== "approval" || !approval || approval.status !== "pending" || submitting) return;
    setSubmitting(actionId);
    try {
      const res = await chat.messageAction(row.message.id, actionId);
      onApprovalUpdated(res.message);
      onActionComplete();
    } finally {
      setSubmitting(null);
    }
  };
  const dismiss = async () => {
    await chat.messageDismiss(row.message.id);
    onDismissed(row.message.id);
    onActionComplete();
  };

  return (
    <>
      <article className={`h-[78px] rounded-md border px-3 py-2 flex items-center gap-3 overflow-hidden ${tone.row}`}>
        <div className={`w-1.5 h-10 rounded-full shrink-0 ${tone.rail}`} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-[10px] uppercase tracking-wide text-text-dim">
            <span className={`rounded border px-1.5 py-0.5 font-bold ${tone.badge}`}>{label}</span>
            {meta && <span className="text-text-muted normal-case tracking-normal truncate">{meta}</span>}
          </div>
          <div className="mt-0.5 text-xs text-text truncate">
            {title || row.message.content}
          </div>
          <div className="mt-0.5 flex items-center gap-2 text-[10px] text-text-dim min-w-0">
            <span className="shrink-0">{row.instance_name || `Agent #${row.instance_id}`}</span>
            {preview && (
              <>
                <span className="text-text-muted">·</span>
                <span className="truncate">{preview}</span>
              </>
            )}
          </div>
        </div>
        <div className="shrink-0 flex items-center gap-3">
          <time
            dateTime={createdAt?.toISOString() || row.message.created_at}
            title={exactTime}
            className="text-[10px] text-text-dim tabular-nums whitespace-nowrap"
          >
            {relativeTime}
          </time>
          <InboxActions
            item={item}
            approval={approval}
            tone={tone}
            submitting={submitting}
            onReportOpen={() => setReportOpen(true)}
            onAlertOpen={() => setAlertOpen(true)}
            onDismiss={() => void dismiss()}
            onApprovalAction={(actionId) => void sendApprovalAction(actionId)}
          />
        </div>
      </article>
      {report && (
        <ReportModal
          open={reportOpen}
          report={report}
          onClose={() => setReportOpen(false)}
          onDismiss={() => void dismiss()}
        />
      )}
      {alert && (
        <AlertModal
          open={alertOpen}
          alert={alert}
          agentName={row.instance_name || `Agent #${row.instance_id}`}
          onClose={() => setAlertOpen(false)}
          onDismiss={() => void dismiss()}
        />
      )}
    </>
  );
}

function InboxActions({
  item,
  approval,
  tone,
  submitting,
  onReportOpen,
  onAlertOpen,
  onDismiss,
  onApprovalAction,
}: {
  item: InboxItem;
  approval: ParsedApproval | null;
  tone: InboxTone;
  submitting: string | null;
  onReportOpen: () => void;
  onAlertOpen: () => void;
  onDismiss: () => void;
  onApprovalAction: (actionId: string) => void;
}) {
  if (item.kind === "report" || item.kind === "alert") {
    return (
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={item.kind === "report" ? onReportOpen : onAlertOpen}
          className={`rounded border px-2.5 py-1 text-[11px] ${tone.action}`}
        >
          Open
        </button>
        <button
          type="button"
          onClick={onDismiss}
          className="rounded border border-border px-2.5 py-1 text-[11px] text-text-dim hover:text-text hover:border-text-muted"
        >
          Dismiss
        </button>
      </div>
    );
  }

  if (item.kind === "approval" && approval) {
    if (approval.status !== "pending") {
      return (
        <span className="rounded border border-border px-2.5 py-1 text-[10px] text-text-dim uppercase">
          {approval.status}
        </span>
      );
    }
    return (
      <div className="flex items-center gap-1.5">
        {approval.actions.slice(0, 2).map((action) => (
          <button
            key={action.id}
            type="button"
            disabled={!!submitting}
            onClick={() => onApprovalAction(action.id)}
            className={`rounded border px-2.5 py-1 text-[11px] disabled:opacity-40 ${
              action.style === "danger" || action.id === "deny"
                ? "border-red/40 text-red hover:bg-red/10"
                : tone.action
            }`}
          >
            {submitting === action.id ? "..." : action.label}
          </button>
        ))}
        <button
          type="button"
          disabled={!!submitting}
          onClick={onDismiss}
          className="rounded border border-border px-2.5 py-1 text-[11px] text-text-dim hover:text-text hover:border-text-muted disabled:opacity-40"
        >
          Dismiss
        </button>
      </div>
    );
  }

  return null;
}

function approvalStatus(message: ChatMessageRow): string {
  for (const c of message.components || []) {
    if (c.app === "channel-chat" && c.name === "approval-card") {
      const status = c.props?.status;
      return typeof status === "string" && status ? status : "pending";
    }
  }
  return "pending";
}

type ChannelComponent = NonNullable<ChatMessageRow["components"]>[number];

type ParsedApproval = {
  status: string;
  actions: Array<{ id: string; label: string; style: string }>;
};

type ParsedReport = {
  title: string;
  period: string;
  summary: string;
  sections: Array<{ title: string; body: string }>;
  tags: string[];
};

type ParsedAlert = {
  title: string;
  body: string;
  severity: string;
};

type InboxTone = {
  row: string;
  rail: string;
  badge: string;
  action: string;
};

function inboxTone(item: InboxItem, severity?: string): InboxTone {
  if (item.kind === "approval") {
    return {
      row: "border-blue/25 bg-blue/5",
      rail: "bg-blue/80",
      badge: "border-blue/35 bg-blue/10 text-blue",
      action: "border-blue/40 text-blue hover:bg-blue/10",
    };
  }
  if (item.kind === "alert") {
    const sev = (severity || item.row.severity || "").toLowerCase();
    if (sev === "critical" || sev === "error") {
      return {
        row: "border-red/25 bg-red/5",
        rail: "bg-red/80",
        badge: "border-red/35 bg-red/10 text-red",
        action: "border-red/40 text-red hover:bg-red/10",
      };
    }
    if (sev === "warning" || sev === "warn") {
      return {
        row: "border-yellow/25 bg-yellow/5",
        rail: "bg-yellow/80",
        badge: "border-yellow/35 bg-yellow/10 text-yellow",
        action: "border-yellow/40 text-yellow hover:bg-yellow/10",
      };
    }
    return {
      row: "border-border/70 bg-bg-subtle/45",
      rail: "bg-text-muted/70",
      badge: "border-border bg-bg-input text-text-muted",
      action: "border-border text-text-muted hover:text-text hover:border-text-muted",
    };
  }
  return {
    row: "border-accent/25 bg-accent/5",
    rail: "bg-accent/80",
    badge: "border-accent/35 bg-accent/10 text-accent",
    action: "border-accent/35 text-accent hover:bg-accent/10",
  };
}

function getChannelComponent(message: ChatMessageRow, name: string): ChannelComponent | null {
  return (message.components || []).find((c) => c.app === "channel-chat" && c.name === name) || null;
}

function parseApprovalProps(
  props: Record<string, unknown>,
  row: ApprovalMessageRow,
): ParsedApproval {
  const status = String(props.status || row.status || "pending");
  const rawActions = Array.isArray(props.actions) ? props.actions : [];
  const actions = rawActions
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const obj = item as Record<string, unknown>;
      const id = String(obj.id || "").trim();
      const label = String(obj.label || "").trim();
      const style = String(obj.style || "").trim();
      if (!id || !label) return null;
      return { id, label, style };
    })
    .filter(Boolean) as ParsedApproval["actions"];
  return {
    status,
    actions: actions.length > 0
      ? actions
      : [
          { id: "approve", label: "Approve", style: "primary" },
          { id: "deny", label: "Deny", style: "danger" },
        ],
  };
}

function parseReportProps(
  props: Record<string, unknown>,
  row: ReportMessageRow,
): ParsedReport {
  const rawSections = Array.isArray(props.sections) ? props.sections : [];
  const sections = rawSections
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const obj = item as Record<string, unknown>;
      const title = String(obj.title || "").trim();
      const body = String(obj.body || "").trim();
      if (!title && !body) return null;
      return { title, body };
    })
    .filter(Boolean) as ParsedReport["sections"];
  const tags = (Array.isArray(props.tags) ? props.tags : [])
    .map((tag) => String(tag || "").trim())
    .filter(Boolean);
  return {
    title: String(props.title || row.title || "Report"),
    period: String(props.period || row.period || ""),
    summary: String(props.summary || row.summary || ""),
    sections,
    tags,
  };
}

function parseAlertProps(
  props: Record<string, unknown>,
  row: AlertMessageRow,
): ParsedAlert {
  return {
    title: String(props.title || row.title || "Alert"),
    body: String(props.body || row.body || ""),
    severity: String(props.severity || row.severity || "info").toLowerCase(),
  };
}

function ReportModal({
  open,
  report,
  onClose,
  onDismiss,
}: {
  open: boolean;
  report: ParsedReport;
  onClose: () => void;
  onDismiss: () => void;
}) {
  const dismiss = () => {
    onDismiss();
    onClose();
  };
  return (
    <Modal open={open} onClose={onClose} width="max-w-3xl">
      <div className="px-5 py-4 border-b border-border flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="text-[10px] uppercase tracking-wide text-accent font-bold">Report</div>
          <h2 className="mt-1 text-lg font-bold text-text break-words">{report.title}</h2>
          {report.period && <div className="mt-1 text-xs text-text-dim">{report.period}</div>}
        </div>
        <div className="shrink-0 flex items-center gap-2">
          <button
            type="button"
            onClick={dismiss}
            className="text-text-muted hover:text-text border border-border rounded px-2 py-1 text-xs"
          >
            Dismiss
          </button>
          <button
            type="button"
            onClick={onClose}
            className="text-text-muted hover:text-text border border-border rounded px-2 py-1 text-xs"
          >
            Close
          </button>
        </div>
      </div>
      <div className="overflow-auto px-5 py-4 space-y-4">
        {report.summary && (
          <section>
            <h3 className="text-[11px] uppercase tracking-wide text-text-dim mb-1">Summary</h3>
            <p className="text-sm text-text-muted leading-relaxed whitespace-pre-wrap break-words">
              {report.summary}
            </p>
          </section>
        )}
        {report.sections.length > 0 && (
          <div className="space-y-4">
            {report.sections.map((section, index) => (
              <section key={`${section.title || "section"}-${index}`}>
                {section.title && (
                  <h3 className="text-[11px] uppercase tracking-wide text-text-dim mb-1">
                    {section.title}
                  </h3>
                )}
                {section.body && (
                  <p className="text-sm text-text-muted leading-relaxed whitespace-pre-wrap break-words">
                    {section.body}
                  </p>
                )}
              </section>
            ))}
          </div>
        )}
        {report.tags.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {report.tags.map((tag) => (
              <span
                key={tag}
                className="rounded border border-border px-1.5 py-0.5 text-[10px] text-text-dim"
              >
                {tag}
              </span>
            ))}
          </div>
        )}
      </div>
    </Modal>
  );
}

function AlertModal({
  open,
  alert,
  agentName,
  onClose,
  onDismiss,
}: {
  open: boolean;
  alert: ParsedAlert;
  agentName: string;
  onClose: () => void;
  onDismiss: () => void;
}) {
  const dismiss = () => {
    onDismiss();
    onClose();
  };
  const severityTone =
    alert.severity === "critical" || alert.severity === "error"
      ? "border-red/40 text-red bg-red/10"
      : alert.severity === "warning" || alert.severity === "warn"
        ? "border-yellow/40 text-yellow bg-yellow/10"
        : "border-accent/35 text-accent bg-accent/10";

  return (
    <Modal open={open} onClose={onClose} width="max-w-2xl">
      <div className="px-5 py-4 border-b border-border flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="text-[10px] uppercase tracking-wide text-accent font-bold">Alert</div>
          <h2 className="mt-1 text-lg font-bold text-text break-words">{alert.title}</h2>
          <div className="mt-1 text-xs text-text-dim">{agentName}</div>
        </div>
        <div className="shrink-0 flex items-center gap-2">
          <button
            type="button"
            onClick={dismiss}
            className="text-text-muted hover:text-text border border-border rounded px-2 py-1 text-xs"
          >
            Dismiss
          </button>
          <button
            type="button"
            onClick={onClose}
            className="text-text-muted hover:text-text border border-border rounded px-2 py-1 text-xs"
          >
            Close
          </button>
        </div>
      </div>
      <div className="overflow-auto px-5 py-4 space-y-4">
        <span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wide ${severityTone}`}>
          {alert.severity}
        </span>
        {alert.body && (
          <p className="text-sm text-text-muted leading-relaxed whitespace-pre-wrap break-words">
            {alert.body}
          </p>
        )}
      </div>
    </Modal>
  );
}

function parseInboxTime(value?: string): Date | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const normalized = /(?:Z|[+-]\d\d:?\d\d)$/.test(trimmed)
    ? trimmed
    : `${trimmed.replace(" ", "T")}Z`;
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatRelativeInboxTime(date: Date | null, now: number): string {
  if (!date) return "";
  const seconds = Math.max(0, Math.floor((now - date.getTime()) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h ago`;
}

function formatExactInboxTime(date: Date): string {
  return date.toLocaleString([], {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}
