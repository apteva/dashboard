import { useEffect, useMemo, useState } from "react";
import { Modal } from "../Modal";

export interface ApprovalAction {
  id: string;
  label: string;
  style: string;
}

export interface ApprovalDecision {
  actionId: string;
  status: string;
  note: string;
  decidedAt: string;
}

export interface ApprovalReview {
  title: string;
  body: string;
  status: string;
  actions: ApprovalAction[];
  context?: unknown;
  decision?: ApprovalDecision;
}

export function parseApprovalReview(
  props: Record<string, unknown>,
  fallback: {
    title?: string;
    body?: string;
    status?: string;
  } = {},
): ApprovalReview {
  const rawActions = Array.isArray(props.actions) ? props.actions : [];
  const actions = rawActions
    .map((item): ApprovalAction | null => {
      if (!item || typeof item !== "object") return null;
      const obj = item as Record<string, unknown>;
      const id = String(obj.id || "").trim();
      const label = String(obj.label || "").trim();
      const style = String(obj.style || "").trim();
      if (!id || !label) return null;
      return { id, label, style };
    })
    .filter(Boolean) as ApprovalAction[];
  const rawDecision = props.decision && typeof props.decision === "object"
    ? props.decision as Record<string, unknown>
    : null;
  const decision = rawDecision
    ? {
        actionId: String(rawDecision.action_id || "").trim(),
        status: String(rawDecision.status || props.status || "").trim(),
        note: String(rawDecision.note || "").trim(),
        decidedAt: String(rawDecision.decided_at || "").trim(),
      }
    : undefined;

  return {
    title: String(props.title || fallback.title || "Approval requested"),
    body: String(props.body || fallback.body || ""),
    status: String(props.status || fallback.status || "pending"),
    // Approval decisions intentionally remain a two-choice interaction.
    // The server defaults to Approve and Deny when no actions are supplied.
    actions: (actions.length > 0
      ? actions
      : [
          { id: "approve", label: "Approve", style: "primary" },
          { id: "deny", label: "Deny", style: "danger" },
        ]).slice(0, 2),
    context: props.context,
    decision,
  };
}

export function ApprovalReviewModal({
  open,
  approval,
  agentName,
  requestedAt,
  onClose,
  onAction,
}: {
  open: boolean;
  approval: ApprovalReview;
  agentName?: string;
  requestedAt?: string;
  onClose: () => void;
  onAction: (actionId: string, note: string) => Promise<void>;
}) {
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pending = approval.status === "pending";

  useEffect(() => {
    if (!open) return;
    setNote("");
    setSubmitting(null);
    setError(null);
  }, [open, approval.title]);

  const contextEntries = useMemo(
    () => readableContextEntries(approval.context),
    [approval.context],
  );
  const decisionActions = useMemo(
    () => [...approval.actions].sort((left, right) => {
      const leftDanger = left.style === "danger" || left.id === "deny";
      const rightDanger = right.style === "danger" || right.id === "deny";
      return Number(rightDanger) - Number(leftDanger);
    }),
    [approval.actions],
  );

  const submit = async (actionId: string) => {
    if (!pending || submitting) return;
    setSubmitting(actionId);
    setError(null);
    try {
      await onAction(actionId, note.trim());
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(null);
    }
  };

  const statusLabel = approvalStatusLabel(approval.status);
  const statusTone = approval.status === "pending"
    ? "border-yellow/40 text-yellow bg-yellow/10"
    : approval.status === "approved"
      ? "border-green/40 text-green bg-green/10"
      : approval.status === "denied"
        ? "border-red/40 text-red bg-red/10"
        : "border-text-muted/40 text-text-muted bg-bg-subtle";

  return (
    <Modal
      open={open}
      onClose={submitting ? () => {} : onClose}
      width="max-w-2xl"
      ariaLabel={`Review approval: ${approval.title}`}
    >
      <div className="border-b border-border px-4 py-3 sm:px-5 sm:py-4">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="text-[10px] font-bold uppercase tracking-wide text-blue">
              Approval request
            </div>
            <h2 className="mt-1 break-words text-lg font-bold text-text">
              {approval.title}
            </h2>
            {(agentName || requestedAt) && (
              <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-text-dim">
                {agentName && <span>{agentName}</span>}
                {agentName && requestedAt && <span aria-hidden="true">·</span>}
                {requestedAt && <time>{requestedAt}</time>}
              </div>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <span className={`rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wide ${statusTone}`}>
              {statusLabel}
            </span>
            <button
              type="button"
              onClick={onClose}
              disabled={!!submitting}
              className="touch-target inline-flex h-11 items-center rounded-lg border border-border px-3 text-xs text-text-muted hover:text-text disabled:opacity-40"
            >
              Close
            </button>
          </div>
        </div>
      </div>

      <div className="page-safe-bottom space-y-5 overflow-auto px-4 py-4 sm:px-5">
        <section>
          <h3 className="mb-1 text-[11px] uppercase tracking-wide text-text-dim">
            Requested decision
          </h3>
          <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-text-muted">
            {approval.body || approval.title}
          </p>
        </section>

        {contextEntries.length > 0 && (
          <section>
            <h3 className="mb-2 text-[11px] uppercase tracking-wide text-text-dim">
              Relevant details
            </h3>
            <dl className="divide-y divide-border/60 rounded-lg border border-border bg-bg-subtle/40 px-3">
              {contextEntries.map(([label, value]) => (
                <div
                  key={label}
                  className="grid gap-1 py-2.5 text-xs sm:grid-cols-[minmax(8rem,0.35fr)_1fr] sm:gap-3"
                >
                  <dt className="font-medium text-text-dim">{label}</dt>
                  <dd className="whitespace-pre-wrap break-words text-text-muted">{value}</dd>
                </div>
              ))}
            </dl>
          </section>
        )}

        {pending ? (
          <section className="space-y-3 border-t border-border pt-4">
            <label className="block">
              <span className="text-xs font-medium text-text">
                Feedback or additional instructions
              </span>
              <span className="ml-1 text-xs text-text-dim">(optional)</span>
              <textarea
                value={note}
                onChange={(event) => setNote(event.target.value)}
                maxLength={2000}
                rows={3}
                disabled={!!submitting}
                placeholder="Add context for the agent, including conditions that should apply if you approve."
                className="mt-2 w-full resize-y rounded-lg border border-border bg-bg-input px-3 py-2 text-sm text-text outline-none placeholder:text-text-dim focus:border-accent disabled:opacity-50"
              />
            </label>
            {error && (
              <div role="alert" className="rounded border border-red/30 bg-red/10 px-3 py-2 text-xs text-red">
                {error}
              </div>
            )}
            <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
              {decisionActions.map((action) => (
                <button
                  key={action.id}
                  type="button"
                  disabled={!!submitting}
                  onClick={() => void submit(action.id)}
                  className={`touch-target inline-flex h-10 min-w-28 items-center justify-center rounded-lg px-4 text-sm font-bold transition-colors disabled:cursor-not-allowed disabled:opacity-40 sm:h-9 sm:text-xs ${
                    action.style === "danger" || action.id === "deny"
                      ? "border border-border text-text-muted hover:border-red/60 hover:bg-red/10 hover:text-red"
                      : "border border-accent bg-accent text-bg hover:bg-accent-hover"
                  }`}
                >
                  {submitting === action.id ? "Sending…" : action.label}
                </button>
              ))}
            </div>
          </section>
        ) : approval.decision ? (
          <section className="space-y-3 border-t border-border pt-4">
            <h3 className="text-[11px] uppercase tracking-wide text-text-dim">
              Decision
            </h3>
            <dl className="space-y-2 rounded-lg border border-border bg-bg-subtle/40 px-3 py-3 text-xs">
              <div className="flex items-start justify-between gap-3">
                <dt className="text-text-dim">Action</dt>
                <dd className="font-medium text-text">
                  {approvalActionLabel(approval.actions, approval.decision.actionId)}
                </dd>
              </div>
              {approval.decision.decidedAt && (
                <div className="flex items-start justify-between gap-3">
                  <dt className="text-text-dim">Decided</dt>
                  <dd className="text-right text-text-muted">
                    {formatDecisionTime(approval.decision.decidedAt)}
                  </dd>
                </div>
              )}
              {approval.decision.note && (
                <div className="border-t border-border/60 pt-2">
                  <dt className="text-text-dim">Feedback or additional instructions</dt>
                  <dd className="mt-1 whitespace-pre-wrap break-words text-text-muted">
                    {approval.decision.note}
                  </dd>
                </div>
              )}
            </dl>
          </section>
        ) : null}
      </div>
    </Modal>
  );
}

function readableContextEntries(context: unknown): Array<[string, string]> {
  if (!context || typeof context !== "object" || Array.isArray(context)) return [];
  return Object.entries(context as Record<string, unknown>)
    .filter(([, value]) => value !== undefined && value !== null && value !== "")
    .map(([key, value]) => [humanizeKey(key), readableValue(value)]);
}

function humanizeKey(value: string): string {
  const words = value.replace(/[_-]+/g, " ").trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : value;
}

function readableValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    return value.map(readableValue).join(", ");
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function approvalStatusLabel(status: string): string {
  switch (status) {
    case "approved":
      return "Approved";
    case "denied":
      return "Denied";
    case "acted":
      return "Completed";
    default:
      return "Pending";
  }
}

function approvalActionLabel(actions: ApprovalAction[], actionId: string): string {
  return actions.find((action) => action.id === actionId)?.label || humanizeKey(actionId);
}

function formatDecisionTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}
