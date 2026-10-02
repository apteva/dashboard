import { useEffect, useRef, useState, type RefObject } from "react";
import { observeAPIWrites } from "../../utils/apiWrites";

type Control = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | HTMLButtonElement;
const selector = 'input:not([type="hidden"]):not([type="search"]),textarea,select,button[aria-pressed]';
function value(control: Control): string {
  if (control instanceof HTMLButtonElement) return control.getAttribute("aria-pressed") || "";
  if (control instanceof HTMLInputElement && ["checkbox", "radio"].includes(control.type)) return String(control.checked);
  if (control instanceof HTMLSelectElement && control.multiple) return [...control.selectedOptions].map(option => option.value).join("\n");
  return control.value;
}

// The baseline is captured before interaction. Successful writes acknowledge
// only the submitted form/section snapshot, preserving edits made in flight.
export function useSettingsDraftGuard(root: RefObject<HTMLDivElement | null>, enabled: boolean, routeKey: string) {
  const dirty = useRef(false);
  const [hasChanges, setHasChanges] = useState(false);
  const clear = useRef(() => {});
  const evaluate = useRef(() => {});
  useEffect(() => {
    const element = root.current;
    dirty.current = false; setHasChanges(false);
    if (!element || !enabled) { clear.current = () => {}; evaluate.current = () => {}; return; }
    const baseline = new Map<Control, string>();
    const editRevisions = new Map<Control, number>();
    const pendingFrames = new Set<number>();
    let lastAction: HTMLElement | null = null;
    let actionAt = 0;
    let active = true;
    let frame = 0;
    const scan = () => {
      for (const control of element.querySelectorAll<Control>(selector)) {
        if (!baseline.has(control)) baseline.set(control, value(control));
      }
    };
    const check = () => {
      const next = [...baseline].some(([control, initial]) => element.contains(control) && value(control) !== initial);
      dirty.current = next; setHasChanges(next);
    };
    evaluate.current = check;
    const scheduleCheck = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(check); };
    const before = (event: Event) => {
      scan();
      if (event.target instanceof HTMLElement) { lastAction = event.target; actionAt = Date.now(); }
      scheduleCheck();
    };
    const change = (event: Event) => {
      if (event.target instanceof HTMLElement) {
        lastAction = event.target; actionAt = Date.now();
        const control = event.target.closest<Control>(selector);
        if (control) editRevisions.set(control, (editRevisions.get(control) || 0) + 1);
      }
      scheduleCheck();
    };
    scan();
    for (const name of ["pointerdown", "focusin", "keydown"]) element.addEventListener(name, before, true);
    for (const name of ["input", "change", "click", "submit"]) element.addEventListener(name, change, true);
    const stop = observeAPIWrites((path) => {
      if (/\/(test|check|preview|validate|refresh|search|discover|usage|tools|status)(?:[/?]|$)/.test(path)) return;
      if (!lastAction || !element.contains(lastAction) || Date.now() - actionAt > 1500) return;
      // Search, refreshes, and other reads never enter this observer.
      const group = lastAction.closest("form, section, [data-settings-draft-group]") || element;
      const snapshot = new Map([...baseline].filter(([control]) => group.contains(control)).map(([control]) => [control, value(control)]));
      const submittedRevisions = new Map([...snapshot.keys()].map(control => [control, editRevisions.get(control) || 0]));
      return () => {
        if (!active) return;
        for (const [control, submitted] of snapshot) baseline.set(control, submitted);
        // Let React apply the saved values (including form clearing or server
        // normalization). Never rebase a control edited during the request.
        const savedFrame = requestAnimationFrame(() => {
          pendingFrames.delete(savedFrame);
          if (!active) return;
          for (const [control, revision] of submittedRevisions) {
            if ((editRevisions.get(control) || 0) === revision) baseline.set(control, value(control));
          }
          check();
        });
        pendingFrames.add(savedFrame);
      };
    });
    const unload = (event: BeforeUnloadEvent) => { check(); if (dirty.current) { event.preventDefault(); event.returnValue = ""; } };
    const link = (event: MouseEvent) => {
      const anchor = event.target instanceof Element ? event.target.closest("a[href]") : null;
      if (!(anchor instanceof HTMLAnchorElement) || anchor.target === "_blank" || event.metaKey || event.ctrlKey || anchor.href === window.location.href) return;
      check();
      if (dirty.current) {
        if (!window.confirm("You have unsaved settings. Leave and discard these changes?")) {
          event.preventDefault(); event.stopPropagation();
        } else clear.current();
      }
    };
    const historyIndex: unknown = window.history.state?.idx;
    let reverting = false;
    const pop = (event: PopStateEvent) => {
      if (reverting) { reverting = false; event.stopImmediatePropagation(); return; }
      check();
      if (!dirty.current || typeof historyIndex !== "number" || typeof event.state?.idx !== "number") return;
      if (window.confirm("You have unsaved settings. Leave and discard these changes?")) { clear.current(); return; }
      const delta = historyIndex - event.state.idx;
      if (delta) { event.stopImmediatePropagation(); reverting = true; window.history.go(delta); }
    };
    window.addEventListener("popstate", pop, true);
    window.addEventListener("beforeunload", unload);
    document.addEventListener("click", link, true);
    clear.current = () => { baseline.clear(); scan(); check(); };
    return () => {
      active = false; stop(); cancelAnimationFrame(frame);
      for (const pendingFrame of pendingFrames) cancelAnimationFrame(pendingFrame);
      for (const name of ["pointerdown", "focusin", "keydown"]) element.removeEventListener(name, before, true);
      for (const name of ["input", "change", "click", "submit"]) element.removeEventListener(name, change, true);
      window.removeEventListener("popstate", pop, true);
      window.removeEventListener("beforeunload", unload); document.removeEventListener("click", link, true);
    };
  }, [enabled, routeKey]);
  const allowNavigation = () => {
    evaluate.current();
    if (!dirty.current || window.confirm("You have unsaved settings. Leave and discard these changes?")) { clear.current(); return true; }
    return false;
  };
  return { hasChanges, allowNavigation };
}
