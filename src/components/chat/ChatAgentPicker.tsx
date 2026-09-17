import { useEffect, useId, useRef, useState } from "react";
import { targetKey, type AssistantChoice } from "./assistantModel";

export function ChatAgentPicker({ choices, activeKey, onSelect }: {
  choices: AssistantChoice[];
  activeKey: string;
  onSelect: (choice: AssistantChoice) => void;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const choice = choices.find((item) => targetKey(item.target) === activeKey);
  const close = () => { setOpen(false); trigger.current?.focus(); };

  useEffect(() => {
    if (!open) return;
    const items = menu.current?.querySelectorAll<HTMLButtonElement>("[role=menuitemradio]");
    const index = Math.max(0, choices.findIndex((item) => targetKey(item.target) === activeKey));
    items?.[index]?.focus();
    const onPointer = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointer);
    return () => document.removeEventListener("pointerdown", onPointer);
  }, [open, activeKey]);

  return <div ref={root} className="relative min-w-0 flex-1" onBlur={(event) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node)) setOpen(false);
  }}>
    <button ref={trigger} type="button" aria-label="Chat agent" aria-haspopup="menu"
      aria-expanded={open} aria-controls={open ? menuId : undefined}
      onClick={() => setOpen(!open)}
      onKeyDown={(event) => {
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          event.preventDefault(); setOpen(true);
        }
      }}
      className="flex min-h-10 max-w-full items-center gap-2 rounded-md px-2 text-left text-sm font-semibold hover:bg-bg-hover focus-visible:outline-accent">
      <span className="truncate">{choice?.agent.name || "Selected agent unavailable"}</span>
      <svg className={`shrink-0 text-text-muted transition-transform ${open ? "rotate-180" : ""}`} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
    </button>
    {open && <div ref={menu} id={menuId} role="menu" aria-label="Chat agent"
      className="absolute left-0 top-full z-50 mt-1 max-h-[min(16rem,50dvh)] w-full overflow-y-auto rounded-lg border border-border bg-bg-card p-1 shadow-xl"
      onKeyDown={(event) => {
        if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(); return; }
        const items = Array.from(menu.current?.querySelectorAll<HTMLButtonElement>("[role=menuitemradio]") || []);
        const index = items.indexOf(document.activeElement as HTMLButtonElement);
        let next: number;
        switch (event.key) {
          case "ArrowDown": next = (index + 1) % items.length; break;
          case "ArrowUp": next = (index - 1 + items.length) % items.length; break;
          case "Home": next = 0; break;
          case "End": next = items.length - 1; break;
          default: return;
        }
        event.preventDefault(); items[next]?.focus();
      }}>
      {choices.map((item) => {
        const key = targetKey(item.target);
        const selected = key === activeKey;
        return <button key={key} type="button" role="menuitemradio" aria-checked={selected} tabIndex={-1}
          onClick={() => { onSelect(item); close(); }}
          className="flex min-h-11 w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-text hover:bg-bg-hover focus:bg-bg-hover focus:outline-none">
          <span className="min-w-0 flex-1 break-words">{item.agent.name}</span>
          {selected && <svg className="shrink-0 text-accent" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="m5 12 4 4L19 6" /></svg>}
        </button>;
      })}
    </div>}
  </div>;
}
