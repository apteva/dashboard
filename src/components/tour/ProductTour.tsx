import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useLocation, useNavigate } from "react-router-dom";
import { auth } from "../../api";
import { useAuth } from "../../hooks/useAuth";
import { useAudience } from "../../hooks/useAudience";
import { PRODUCT_TOUR, PRODUCT_TOUR_EVENT, type TourStep } from "./config";
import { PRODUCT_TOUR_STATUS_EVENT, productTourStorageKey, useProductTourCompleted } from "./useProductTourCompleted";

type Rect = { left: number; top: number; width: number; height: number };
const button = "min-h-10 rounded-lg border border-border px-3 text-sm text-text-muted hover:border-accent hover:text-text focus-visible:outline-2 focus-visible:outline-accent";

export function ProductTour({ navPaths, onStart, onPrepare, onEnd }: {
  navPaths: string[];
  onStart: () => void;
  onPrepare: (navigation: boolean) => void;
  onEnd: () => void;
}) {
  const { user, refresh } = useAuth();
  const completed = useProductTourCompleted();
  const { audience } = useAudience();
  const location = useLocation();
  const navigate = useNavigate();
  const [phase, setPhase] = useState<"closed" | "offer" | "tour">("closed");
  const [index, setIndex] = useState(0);
  const [rect, setRect] = useState<Rect | null>(null);
  const [viewport, setViewport] = useState(() => ({ width: innerWidth, height: innerHeight, top: 0, left: 0 }));
  const [cardHeight, setCardHeight] = useState(300);
  const card = useRef<HTMLDivElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const origin = useRef(location);
  const returnFocus = useRef<HTMLElement | null>(null);
  const offered = useRef(false);
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  const storageKey = productTourStorageKey(user ? user.id : undefined, user ? user.createdAt : undefined);
  const navKey = navPaths.join("|");
  const steps = useMemo(() => (PRODUCT_TOUR.steps as TourStep[]).filter((step) =>
    (!step.audiences || step.audiences.includes(audience)) && (!step.requiresNav || navPaths.includes(step.requiresNav)) && (!step.unlessNav || !navPaths.includes(step.unlessNav)),
  ), [audience, navKey]);
  const step = steps[Math.min(index, steps.length - 1)];
  const start = useCallback(() => {
    if (phaseRef.current === "tour") return;
    origin.current = location;
    returnFocus.current = document.activeElement as HTMLElement;
    onStart();
    setIndex(0); setRect(null); setPhase("tour");
  }, [location, onStart]);

  const finish = useCallback((status: "skipped" | "completed") => {
    // Dismissing a replay must not undo a previously completed guide.
    if (completed) status = "completed";
    const wasTour = phaseRef.current === "tour";
    setPhase("closed"); setRect(null);
    try { localStorage.setItem(storageKey, status); } catch {}
    window.dispatchEvent(new CustomEvent(PRODUCT_TOUR_STATUS_EVENT, { detail: { key: storageKey, status } }));
    void auth.saveProductTour(PRODUCT_TOUR.id, status).then(() => refresh()).catch(() => {
      // Local fallback keeps dismissal respected even if the preference API is offline.
    });
    if (wasTour) {
      onEnd();
      navigate(origin.current.pathname + origin.current.search + origin.current.hash, { replace: true, state: origin.current.state });
    }
    window.setTimeout(() => {
      const target = returnFocus.current;
      if (target?.isConnected && target.getClientRects().length) target.focus();
      else document.querySelector<HTMLButtonElement>('[data-tour="replay"]')?.focus();
    }, 100);
  }, [navigate, onEnd, refresh, storageKey, completed]);

  useEffect(() => {
    if (!PRODUCT_TOUR.enabled) return;
    window.addEventListener(PRODUCT_TOUR_EVENT, start);
    return () => window.removeEventListener(PRODUCT_TOUR_EVENT, start);
  }, [start]);
  useEffect(() => {
    // Home is a recovery point if a reload or redirect lost onboarding's
    // navigation state. Saved skipped/completed preferences still suppress it.
    if (!PRODUCT_TOUR.enabled || !user || !user.onboarded || offered.current ||
      (!location.state?.offerProductTour && location.pathname !== "/")) return;
    offered.current = true;
    let seen = user.productTours?.[PRODUCT_TOUR.id];
    try { seen ||= localStorage.getItem(storageKey) || undefined; } catch {}
    if (!seen) { returnFocus.current = document.activeElement as HTMLElement; setPhase("offer"); }
  }, [user, location.state, location.pathname, storageKey]);

  // A tour only navigates. It never clicks controls or submits app forms.
  useEffect(() => {
    if (phase !== "tour" || !step) return;
    setRect(null);
    if (step.route) navigate(step.route, { replace: true });
    const prepare = () => onPrepare(!!step.navigation);
    const timer = window.setTimeout(prepare, 50);
    window.addEventListener("resize", prepare);
    return () => { clearTimeout(timer); window.removeEventListener("resize", prepare); };
  }, [phase, step?.id, navigate, onPrepare]);

  useLayoutEffect(() => {
    if (phase === "closed") return;
    const root = document.getElementById("root");
    const wasInert = root?.inert;
    if (root) root.inert = true;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); event.stopImmediatePropagation(); finish("skipped"); }
      if (event.key !== "Tab") return;
      const controls = Array.from(card.current?.querySelectorAll<HTMLElement>('button:not(:disabled), [href], [tabindex="0"]') || []);
      if (!controls.length) return;
      const first = controls[0]!, last = controls[controls.length - 1]!;
      if (event.shiftKey && (document.activeElement === first || !controls.includes(document.activeElement as HTMLElement))) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || !controls.includes(document.activeElement as HTMLElement))) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", keydown, true);
    return () => {
      if (root) root.inert = wasInert || false;
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", keydown, true);
    };
  }, [phase, finish]);

  useLayoutEffect(() => { if (phase !== "closed") heading.current?.focus(); }, [phase, step?.id]);
  useEffect(() => {
    if (phase === "closed") return;
    const resize = new ResizeObserver(() => setCardHeight(card.current?.getBoundingClientRect().height || 300));
    if (card.current) resize.observe(card.current);
    return () => resize.disconnect();
  }, [phase]);

  useEffect(() => {
    if (phase === "closed") return;
    let frame = 0, lastTarget: Element | null = null;
    const measure = () => {
      const vv = window.visualViewport;
      const view = { width: vv?.width || innerWidth, height: vv?.height || innerHeight, top: vv?.offsetTop || 0, left: vv?.offsetLeft || 0 };
      setViewport((old) => JSON.stringify(old) === JSON.stringify(view) ? old : view);
      const target = phase === "tour" && step ? Array.from(document.querySelectorAll<HTMLElement>(`[data-tour="${step.target}"]`)).find((node) => node.getClientRects().length && getComputedStyle(node).visibility !== "hidden") : null;
      if (target && lastTarget !== target) { lastTarget = target; target.scrollIntoView({ block: view.width < 640 ? "start" : "center", inline: "nearest", behavior: "instant" }); }
      const box = target?.getBoundingClientRect();
      const left = Math.max(view.left + 6, (box?.left || 0) - 5), top = Math.max(view.top + 6, (box?.top || 0) - 5);
      const right = Math.min(view.left + view.width - 6, (box?.right || 0) + 5), bottom = Math.min(view.top + view.height - 6, (box?.bottom || 0) + 5);
      const next = box && right > left && bottom > top ? { left, top, width: right - left, height: bottom - top } : null;
      setRect((old) => JSON.stringify(old) === JSON.stringify(next) ? old : next);
    };
    const schedule = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(measure); };
    const observer = new MutationObserver(schedule);
    const root = document.getElementById("root");
    if (root) observer.observe(root, { childList: true, subtree: true, attributes: true });
    const resize = new ResizeObserver(schedule);
    if (root) resize.observe(root);
    window.addEventListener("resize", schedule);
    document.addEventListener("scroll", schedule, true);
    window.visualViewport?.addEventListener("resize", schedule);
    window.visualViewport?.addEventListener("scroll", schedule);
    const timers = [0, 100, 250, 500, 1000].map((delay) => window.setTimeout(schedule, delay));
    schedule();
    return () => {
      cancelAnimationFrame(frame); timers.forEach(clearTimeout); observer.disconnect(); resize.disconnect();
      window.removeEventListener("resize", schedule); document.removeEventListener("scroll", schedule, true);
      window.visualViewport?.removeEventListener("resize", schedule); window.visualViewport?.removeEventListener("scroll", schedule);
    };
  }, [phase, step?.id, location.key]);

  if (phase === "closed" || !PRODUCT_TOUR.enabled) return null;
  const width = Math.min(380, viewport.width - 24);
  const clampX = (x: number) => Math.max(viewport.left + 12, Math.min(x, viewport.left + viewport.width - width - 12));
  const clampY = (y: number) => Math.max(viewport.top + 12, Math.min(y, viewport.top + viewport.height - cardHeight - 12));
  let left = viewport.left + (viewport.width - width) / 2, top = clampY(viewport.top + (viewport.height - cardHeight) / 2);
  if (viewport.width < 640 && phase === "tour") {
    const bottomTop = clampY(viewport.top + viewport.height - cardHeight - 12);
    // Prefer the bottom sheet, moving above a low target when it would cover it.
    top = rect && rect.top >= viewport.top + cardHeight + 24 && rect.top + rect.height > bottomTop
      ? viewport.top + 12 : bottomTop;
  }
  else if (rect) {
    if (rect.left + rect.width + width + 28 <= viewport.left + viewport.width) { left = rect.left + rect.width + 16; top = clampY(rect.top); }
    else { left = clampX(rect.left); top = clampY(rect.top + rect.height + cardHeight + 24 <= viewport.top + viewport.height ? rect.top + rect.height + 16 : rect.top - cardHeight - 16); }
  }
  return createPortal(<div className="fixed inset-0 z-[1000]" data-product-tour>
    <div className={`absolute inset-0 ${rect ? "" : "bg-black/60"}`} onClick={() => finish("skipped")} aria-hidden="true" />
    {rect && <div className="pointer-events-none fixed rounded-lg border-2 border-accent" style={{ ...rect, boxShadow: "0 0 0 9999px rgb(0 0 0 / 0.6)" }} />}
    <div ref={card} role="dialog" aria-modal="true" aria-labelledby="product-tour-title" aria-describedby="product-tour-description"
      className="fixed flex flex-col overflow-y-auto rounded-xl border border-border bg-bg-card p-4 text-text shadow-2xl sm:p-5"
      style={{ left, top, width, maxHeight: viewport.height - 24 }}>
      <div className="mb-3 flex items-center justify-between gap-3">
        <span className="text-xs font-semibold text-accent">{phase === "offer" ? "Explore Apteva · about a minute" : `${Math.min(index + 1, steps.length)} of ${steps.length} · Explore Apteva`}</span>
        <button type="button" onClick={() => finish("skipped")} aria-label="Skip tour" className="-mr-1 flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-xl text-text-muted hover:bg-bg-hover focus-visible:outline-2 focus-visible:outline-accent">×</button>
      </div>
      <div aria-live="polite" aria-atomic="true">
        <h2 ref={heading} id="product-tour-title" tabIndex={-1} className="text-base font-semibold outline-none">{phase === "offer" ? PRODUCT_TOUR.title : step?.title}</h2>
        <p id="product-tour-description" className="mt-2 text-sm leading-relaxed text-text-muted">{phase === "offer" ? PRODUCT_TOUR.description : step?.description}</p>
      </div>
      <div className="mt-5 flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => finish("skipped")} className={`${button} mr-auto`}>{phase === "offer" ? "Explore on my own" : "Skip tour"}</button>
        {phase === "tour" && <button type="button" disabled={index === 0} onClick={() => setIndex((value) => Math.max(0, value - 1))} className={`${button} disabled:opacity-40`}>Back</button>}
        <button type="button" className="min-h-10 rounded-lg bg-accent px-4 text-sm font-semibold text-bg hover:bg-accent-hover focus-visible:outline-2 focus-visible:outline-accent"
          onClick={() => phase === "offer" ? start() : index >= steps.length - 1 ? finish("completed") : setIndex((value) => value + 1)}>
          {phase === "offer" ? "Show me around" : index >= steps.length - 1 ? "Finish" : "Next"}
        </button>
      </div>
    </div>
  </div>, document.body);
}
