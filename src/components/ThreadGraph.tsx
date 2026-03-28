import { useEffect, useState } from "react";
import { telemetry, type Thread, type TelemetryEvent } from "../api";

interface Props {
  instanceId: number;
  threads: Thread[];
  onEvent?: (event: TelemetryEvent) => void;
}

export function ThreadGraph({ instanceId, threads, onEvent }: Props) {
  const [pulses, setPulses] = useState<Record<string, { time: number; type: string }>>({});
  const [messages, setMessages] = useState<Array<{ from: string; to: string; time: number }>>([]);

  useEffect(() => {
    const es = telemetry.stream(instanceId);
    es.onmessage = (e) => {
      try {
        const event: TelemetryEvent = JSON.parse(e.data);
        onEvent?.(event);

        const now = Date.now();
        setPulses((prev) => ({ ...prev, [event.thread_id]: { time: now, type: event.type } }));

        if (event.type === "thread.message" && event.data) {
          setMessages((prev) => {
            const next = [...prev, { from: event.data.from, to: event.data.to, time: now }];
            return next.filter((m) => now - m.time < 3000).slice(-10);
          });
        }
      } catch {}
    };
    return () => es.close();
  }, [instanceId]);

  const cx = 200;
  const cy = 140;
  const radius = threads.length === 1 ? 0 : 90;

  const threadNodes = threads.map((t, i) => {
    if (threads.length === 1) {
      return { ...t, x: cx, y: cy };
    }
    const angle = (i / threads.length) * Math.PI * 2 - Math.PI / 2;
    return {
      ...t,
      x: cx + Math.cos(angle) * radius,
      y: cy + Math.sin(angle) * radius,
    };
  });

  const now = Date.now();

  const nodePos = (id: string) => {
    const n = threadNodes.find((t) => t.id === id);
    return n ? { x: n.x, y: n.y } : { x: cx, y: cy };
  };

  return (
    <svg viewBox="0 0 400 280" className="w-full">
      <defs>
        {/* Subtle soft glow */}
        <filter id="softglow">
          <feGaussianBlur stdDeviation="4" result="blur" />
          <feComposite in="SourceGraphic" in2="blur" operator="over" />
        </filter>
        {/* Per-color glow filters for active states */}
        <filter id="glow-orange" x="-50%" y="-50%" width="200%" height="200%">
          <feDropShadow dx="0" dy="0" stdDeviation="4" floodColor="#f97316" floodOpacity="0.5" />
        </filter>
        <filter id="glow-blue" x="-50%" y="-50%" width="200%" height="200%">
          <feDropShadow dx="0" dy="0" stdDeviation="3" floodColor="#3b82f6" floodOpacity="0.4" />
        </filter>
      </defs>

      {/* Connections between threads */}
      {threadNodes.length > 1 && threadNodes.map((t, i) => {
        const main = threadNodes[0];
        if (i === 0) return null;

        return (
          <g key={`edge-${t.id}`}>
            <line
              x1={main.x} y1={main.y} x2={t.x} y2={t.y}
              stroke="#1e1e1e"
              strokeWidth={1}
            />
          </g>
        );
      })}

      {/* Message particles between threads */}
      {messages.filter((m) => now - m.time < 3000).map((m, i) => {
        const from = nodePos(m.from);
        const to = nodePos(m.to);
        return (
          <circle key={`msg-${i}`} r="2.5" fill="#3b82f6" opacity="0.7">
            <animateMotion
              dur="0.8s"
              repeatCount="1"
              fill="freeze"
              path={`M${from.x},${from.y} L${to.x},${to.y}`}
            />
            <animate attributeName="opacity" values="0.7;0" dur="0.8s" fill="freeze" />
          </circle>
        );
      })}

      {/* Thread nodes */}
      {threadNodes.map((t) => {
        const isActive = t.rate !== "sleep";
        const pulse = pulses[t.id];
        const recentPulse = pulse && now - pulse.time < 3000;

        // State from recent events only — idle unless something just happened
        const isThinking = recentPulse && (pulse.type === "llm.done" || pulse.type === "llm.chunk");
        const isTool = recentPulse && (pulse.type === "tool.call" || pulse.type === "tool.result");

        const state = isThinking ? "thinking" : isTool ? "tool" : "idle";
        const borderColor = state === "thinking" ? "#f97316" : state === "tool" ? "#3b82f6" : "#222";
        const glowFilter = state === "thinking" ? "url(#glow-orange)" : state === "tool" ? "url(#glow-blue)" : undefined;
        const dotColor = state === "idle" ? "#444" : borderColor;

        return (
          <g key={`node-${t.id}`}>
            {/* Node card */}
            <rect
              x={t.x - 40} y={t.y - 22}
              width="80" height="44"
              rx="6"
              fill="#111"
              stroke={borderColor}
              strokeWidth={state === "idle" ? 1 : 1.5}
              filter={glowFilter}
            >
              {/* Subtle border pulse for active threads */}
              {state !== "idle" && (
                <animate
                  attributeName="stroke-opacity"
                  values="1;0.4;1"
                  dur={state === "thinking" ? "1s" : "2.5s"}
                  repeatCount="indefinite"
                />
              )}
            </rect>

            {/* Status dot */}
            <circle cx={t.x - 28} cy={t.y - 8} r="3" fill={dotColor}>
              {state !== "idle" && (
                <animate
                  attributeName="opacity"
                  values="1;0.3;1"
                  dur={state === "thinking" ? "1s" : "2.5s"}
                  repeatCount="indefinite"
                />
              )}
            </circle>

            {/* Thread name */}
            <text x={t.x - 20} y={t.y - 5}
              fill={state === "idle" ? "#888" : "#e8e8e8"}
              fontSize="10"
              fontFamily="'JetBrains Mono', monospace"
              fontWeight={state === "idle" ? "normal" : "bold"}>
              {t.id.length > 8 ? t.id.slice(0, 8) : t.id}
            </text>

            {/* Iteration + rate */}
            <text x={t.x - 28} y={t.y + 10} fill="#555" fontSize="8"
              fontFamily="'JetBrains Mono', monospace">
              #{t.iteration} · {t.rate}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
