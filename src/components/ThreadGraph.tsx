import { useEffect, useState } from "react";
import type { Thread, TelemetryEvent } from "../api";

interface Props {
  threads: Thread[];
  selectedThread?: string | null;
  onSelectThread?: (threadId: string | null) => void;
}

interface Activity {
  threadId: string;
  text: string;
  color: string;
  icon: string;
  time: number;
  id: number;
}

interface MessageArc {
  from: string;
  to: string;
  time: number;
  id: number;
}

let _id = 0;
let _onEvent: ((event: TelemetryEvent) => void) | null = null;
export function pushGraphEvent(event: TelemetryEvent) {
  _onEvent?.(event);
}

export function ThreadGraph({ threads, selectedThread, onSelectThread }: Props) {
  const [pulses, setPulses] = useState<Record<string, { time: number; type: string }>>({});
  const [activities, setActivities] = useState<Activity[]>([]);
  const [arcs, setArcs] = useState<MessageArc[]>([]);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const iv = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(iv);
  }, []);

  useEffect(() => {
    _onEvent = (event: TelemetryEvent) => {
      const t = Date.now();
      const d = event.data || {};
      setPulses((prev) => ({ ...prev, [event.thread_id]: { time: t, type: event.type } }));

      const add = (text: string, color: string, icon: string) => {
        setActivities((prev) => [...prev.filter((a) => t - a.time < 6000).slice(-30),
          { threadId: event.thread_id, text, color, icon, time: t, id: ++_id }]);
      };

      if (event.type === "tool.call" && d.name) {
        const name = d.name.replace(/^[^_]+_/, ""); // strip prefix
        add(name.length > 16 ? name.slice(0, 16) + "…" : name, "#3b82f6", "⚡");
      } else if (event.type === "tool.result" && d.name) {
        const name = d.name.replace(/^[^_]+_/, "");
        add(`${name.length > 14 ? name.slice(0, 14) + "…" : name} ${d.success ? "✓" : "✗"}`, d.success ? "#22c55e" : "#ef4444", d.success ? "✓" : "✗");
      } else if (event.type === "event.received") {
        add((d.message || "event").slice(0, 18), "#06b6d4", "▶");
      }

      if (event.type === "thread.message" && d.from && d.to) {
        setArcs((prev) => [...prev.filter((a) => t - a.time < 2000).slice(-8),
          { from: d.from, to: d.to, time: t, id: ++_id }]);
      }
    };
    return () => { _onEvent = null; };
  }, []);

  const W = 400;
  const H = 280;
  const cx = W / 2;
  const cy = H / 2;
  const radius = threads.length <= 1 ? 0 : Math.min(85, 45 + threads.length * 12);
  const nw = 130;
  const nh = 70;

  const threadNodes = threads.map((t, i) => {
    if (threads.length === 1) return { ...t, x: cx, y: cy };
    const angle = (i / threads.length) * Math.PI * 2 - Math.PI / 2;
    return { ...t, x: cx + Math.cos(angle) * radius, y: cy + Math.sin(angle) * radius };
  });

  const nodePos = (id: string) => {
    const n = threadNodes.find((t) => t.id === id);
    return n ? { x: n.x, y: n.y } : { x: cx, y: cy };
  };

  const visibleArcs = arcs.filter((a) => now - a.time < 2000);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full">
      <defs>
        <filter id="g-orange" x="-50%" y="-50%" width="200%" height="200%">
          <feDropShadow dx="0" dy="0" stdDeviation="3" floodColor="#f97316" floodOpacity="0.4" />
        </filter>
        <filter id="g-blue" x="-50%" y="-50%" width="200%" height="200%">
          <feDropShadow dx="0" dy="0" stdDeviation="3" floodColor="#3b82f6" floodOpacity="0.4" />
        </filter>
        <filter id="g-cyan" x="-50%" y="-50%" width="200%" height="200%">
          <feDropShadow dx="0" dy="0" stdDeviation="3" floodColor="#06b6d4" floodOpacity="0.4" />
        </filter>
        <filter id="g-sel" x="-50%" y="-50%" width="200%" height="200%">
          <feDropShadow dx="0" dy="0" stdDeviation="4" floodColor="#f97316" floodOpacity="0.3" />
        </filter>
        <marker id="arr" markerWidth="6" markerHeight="4" refX="5" refY="2" orient="auto">
          <polygon points="0 0, 6 2, 0 4" fill="#3b82f6" opacity="0.6" />
        </marker>
      </defs>

      {/* Connection lines */}
      {threadNodes.length > 1 && threadNodes.map((t, i) => {
        if (i === 0) return null;
        const m = threadNodes[0];
        return <line key={`e-${t.id}`} x1={m.x} y1={m.y} x2={t.x} y2={t.y} stroke="#1a1a1a" strokeWidth={1} strokeDasharray="3 3" />;
      })}

      {/* Message arrows */}
      {visibleArcs.map((a) => {
        const from = nodePos(a.from);
        const to = nodePos(a.to);
        const op = Math.max(0, 1 - (now - a.time) / 2000);
        return (
          <g key={`arc-${a.id}`} opacity={op}>
            <line x1={from.x} y1={from.y} x2={to.x} y2={to.y} stroke="#3b82f6" strokeWidth={1.5} markerEnd="url(#arr)" />
            <circle r="2.5" fill="#3b82f6">
              <animateMotion dur="0.5s" repeatCount="1" fill="freeze" path={`M${from.x},${from.y} L${to.x},${to.y}`} />
            </circle>
          </g>
        );
      })}

      {/* Nodes with embedded activity */}
      {threadNodes.map((t) => {
        const pulse = pulses[t.id];
        const recent = pulse && now - pulse.time < 3000;
        const st = recent && (pulse.type === "llm.done" || pulse.type === "llm.chunk") ? "think"
          : recent && (pulse.type === "tool.call" || pulse.type === "tool.result") ? "tool"
          : recent && pulse.type === "event.received" ? "event" : "idle";
        const isSel = selectedThread === t.id;
        const bc = isSel ? "#f97316" : st === "think" ? "#f97316" : st === "tool" ? "#3b82f6" : st === "event" ? "#06b6d4" : "#1e1e1e";
        const gf = isSel ? "url(#g-sel)" : st === "think" ? "url(#g-orange)" : st === "tool" ? "url(#g-blue)" : st === "event" ? "url(#g-cyan)" : undefined;

        // Latest activity for this node
        const nodeActs = activities.filter((a) => a.threadId === t.id && now - a.time < 6000).slice(-5);

        return (
          <g key={`n-${t.id}`} onClick={() => onSelectThread?.(isSel ? null : t.id)} style={{ cursor: "pointer" }}>
            {/* Card background */}
            <rect x={t.x - nw / 2} y={t.y - nh / 2} width={nw} height={nh} rx="6"
              fill={isSel ? "#1a1400" : "#0d0d0d"} stroke={bc}
              strokeWidth={st === "idle" && !isSel ? 0.5 : 1.5} filter={gf}>
              {st !== "idle" && (
                <animate attributeName="stroke-opacity" values="1;0.4;1" dur={st === "think" ? "1s" : "2s"} repeatCount="indefinite" />
              )}
            </rect>

            {/* Header: dot + name */}
            <circle cx={t.x - nw / 2 + 7} cy={t.y - nh / 2 + 9} r="2"
              fill={st === "idle" && !isSel ? "#333" : bc}>
              {st !== "idle" && <animate attributeName="opacity" values="1;0.3;1" dur="1s" repeatCount="indefinite" />}
            </circle>
            <text x={t.x - nw / 2 + 13} y={t.y - nh / 2 + 12}
              fill={st === "idle" && !isSel ? "#666" : "#ddd"}
              fontSize="7" fontFamily="'JetBrains Mono', monospace"
              fontWeight={st === "idle" && !isSel ? "normal" : "bold"}>
              {t.id.length > 17 ? t.id.slice(0, 17) : t.id}
            </text>
            <text x={t.x + nw / 2 - 5} y={t.y - nh / 2 + 12} textAnchor="end"
              fill="#444" fontSize="6" fontFamily="'JetBrains Mono', monospace">
              {t.rate}
            </text>

            {/* Divider */}
            <line x1={t.x - nw / 2 + 5} y1={t.y - nh / 2 + 17} x2={t.x + nw / 2 - 5} y2={t.y - nh / 2 + 17} stroke="#1a1a1a" strokeWidth={0.5} />

            {/* Activity lines inside card */}
            {nodeActs.length === 0 && (
              <text x={t.x - nw / 2 + 7} y={t.y - nh / 2 + 26}
                fill="#333" fontSize="6" fontFamily="'JetBrains Mono', monospace">
                idle
              </text>
            )}
            {nodeActs.map((a, ai) => {
              const opacity = Math.max(0.4, 1 - (now - a.time) / 6000);
              return (
                <text key={a.id} x={t.x - nw / 2 + 7} y={t.y - nh / 2 + 26 + ai * 9}
                  fill={a.color} fontSize="6" opacity={opacity}
                  fontFamily="'JetBrains Mono', monospace">
                  {a.icon} {a.text}
                </text>
              );
            })}
          </g>
        );
      })}
    </svg>
  );
}
