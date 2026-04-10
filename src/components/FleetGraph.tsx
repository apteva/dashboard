import { useState, useMemo, useEffect, useCallback } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  type Node,
  type Edge,
  type NodeProps,
  type OnNodesChange,
  type OnEdgesChange,
  Position,
  Handle,
} from "@xyflow/react";
import type { Thread } from "../api";

// ─── Types ───

interface ThreadNodeData {
  label: string;
  rate: string;
  iteration: number;
  depth: number;
  mcpNames?: string[];
  activeTool?: string;
  thought?: string;
  messageFrom?: string; // brief flash: "← from-thread"
  [key: string]: unknown;
}

export interface FleetEvent {
  type: "message" | "tool" | "thought";
  from: string;
  to: string;
  text?: string;
  time: number;
}

// ─── Custom Node ───

function ThreadNode({ data }: NodeProps<Node<ThreadNodeData>>) {
  const isActive = !!data.activeTool;
  const hasMessage = !!data.messageFrom;
  const isMain = data.label === "main";

  return (
    <div
      className={`
        rounded-lg border px-3 py-2.5 min-w-[160px] max-w-[220px] text-xs transition-all duration-300
        ${hasMessage ? "border-green bg-green/10 shadow-[0_0_12px_rgba(34,197,94,0.3)]" : ""}
        ${isActive && !hasMessage ? "border-accent bg-accent/10 shadow-[0_0_12px_rgba(249,115,22,0.2)]" : ""}
        ${!isActive && !hasMessage ? "border-border bg-bg-card" : ""}
        ${isMain && !isActive && !hasMessage ? "border-accent/40" : ""}
      `}
    >
      <Handle type="target" position={Position.Top} className="!bg-border !w-2 !h-2 !border-0" />

      {/* Header */}
      <div className="flex items-center gap-1.5 mb-1">
        <span className={`w-2 h-2 rounded-full shrink-0 transition-colors duration-300 ${
          hasMessage ? "bg-green animate-pulse" :
          isActive ? "bg-accent animate-pulse" :
          "bg-green/60"
        }`} />
        <span className="text-text font-bold truncate">{data.label}</span>
      </div>

      {/* Status line */}
      {hasMessage ? (
        <div className="text-green truncate text-[10px]">← {data.messageFrom}</div>
      ) : isActive ? (
        <div className="text-accent truncate">⟳ {data.activeTool}</div>
      ) : (
        <div className="text-text-muted">#{data.iteration} {data.rate}</div>
      )}

      {/* MCP badges */}
      {data.mcpNames && data.mcpNames.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-1">
          {data.mcpNames.map((mcp) => (
            <span key={mcp} className="text-[8px] px-1 py-0.5 rounded bg-accent/10 text-accent/70">⚡{mcp}</span>
          ))}
        </div>
      )}

      {/* Thought preview */}
      {data.thought && !hasMessage && (
        <div className="text-text-dim mt-1 truncate italic text-[10px] max-w-[180px]">{data.thought}</div>
      )}

      <Handle type="source" position={Position.Bottom} className="!bg-border !w-2 !h-2 !border-0" />
    </div>
  );
}

const nodeTypes = { thread: ThreadNode };

// ─── Layout ───

function layoutTree(threads: Thread[]): { nodes: Node<ThreadNodeData>[]; edges: Edge[] } {
  if (threads.length === 0) return { nodes: [], edges: [] };

  const children: Record<string, Thread[]> = {};
  const roots: Thread[] = [];

  for (const t of threads) {
    if (t.id === "main" || (!t.parent_id && !t.depth)) {
      roots.push(t);
    } else {
      const pid = t.parent_id || "main";
      if (!children[pid]) children[pid] = [];
      children[pid].push(t);
    }
  }

  const nodes: Node<ThreadNodeData>[] = [];
  const edges: Edge[] = [];

  const NODE_W = 170;
  const NODE_H = 80;
  const H_GAP = 40;
  const V_GAP = 50;

  const subtreeWidth: Record<string, number> = {};
  const calcWidth = (id: string): number => {
    const kids = children[id] || [];
    if (kids.length === 0) {
      subtreeWidth[id] = NODE_W;
      return NODE_W;
    }
    const total = kids.reduce((sum, k) => sum + calcWidth(k.id), 0) + (kids.length - 1) * H_GAP;
    subtreeWidth[id] = Math.max(NODE_W, total);
    return subtreeWidth[id];
  };

  const placeNode = (t: Thread, x: number, y: number) => {
    nodes.push({
      id: t.id,
      type: "thread",
      position: { x: x - NODE_W / 2, y },
      data: {
        label: t.id,
        rate: t.rate || "sleep",
        iteration: t.iteration || 0,
        depth: t.depth || 0,
        mcpNames: t.mcp_names,
      },
    });

    if (t.parent_id) {
      edges.push({
        id: `e-${t.parent_id}-${t.id}`,
        source: t.parent_id,
        target: t.id,
        type: "default",
        style: { stroke: "#555", strokeWidth: 2 },
        animated: false,
      });
    }

    const kids = children[t.id] || [];
    if (kids.length > 0) {
      const totalW = kids.reduce((s, k) => s + (subtreeWidth[k.id] || NODE_W), 0) + (kids.length - 1) * H_GAP;
      let cx = x - totalW / 2;
      for (const kid of kids) {
        const w = subtreeWidth[kid.id] || NODE_W;
        placeNode(kid, cx + w / 2, y + NODE_H + V_GAP);
        cx += w + H_GAP;
      }
    }
  };

  for (const root of roots) calcWidth(root.id);

  const totalRootW = roots.reduce((s, r) => s + (subtreeWidth[r.id] || NODE_W), 0) + (roots.length - 1) * H_GAP;
  let rx = -totalRootW / 2;
  for (const root of roots) {
    const w = subtreeWidth[root.id] || NODE_W;
    placeNode(root, rx + w / 2, 0);
    rx += w + H_GAP;
  }

  return { nodes, edges };
}

// ─── Component ───

interface FleetGraphProps {
  threads: Thread[];
  activeTools: Record<string, string>;
  thoughts: Record<string, string>;
  events?: FleetEvent[]; // recent message/tool events for animations
}

export function FleetGraph({ threads, activeTools, thoughts, events = [] }: FleetGraphProps) {
  const { nodes: layoutNodes, edges: layoutEdges } = useMemo(() => layoutTree(threads), [threads]);

  // Track which edges are "hot" (recent message or tool activity)
  const [hotEdges, setHotEdges] = useState<Record<string, number>>({}); // edgeId → expiry timestamp

  // Process events → mark edges as hot
  useEffect(() => {
    if (events.length === 0) return;
    const latest = events[events.length - 1];
    if (!latest) return;

    // Find edge between from↔to (either direction)
    const edgeId1 = `e-${latest.from}-${latest.to}`;
    const edgeId2 = `e-${latest.to}-${latest.from}`;

    setHotEdges((prev) => ({
      ...prev,
      [edgeId1]: Date.now() + 3000, // hot for 3 seconds
      [edgeId2]: Date.now() + 3000,
    }));
  }, [events.length]);

  // Decay hot edges
  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now();
      setHotEdges((prev) => {
        const next: Record<string, number> = {};
        for (const [k, v] of Object.entries(prev)) {
          if (v > now) next[k] = v;
        }
        return Object.keys(next).length !== Object.keys(prev).length ? next : prev;
      });
    }, 500);
    return () => clearInterval(interval);
  }, []);

  // Track which nodes have recent messages (for the green flash)
  const [messageFlash, setMessageFlash] = useState<Record<string, string>>({}); // threadId → from

  useEffect(() => {
    if (events.length === 0) return;
    const latest = events[events.length - 1];
    if (!latest || latest.type !== "message") return;

    setMessageFlash((prev) => ({ ...prev, [latest.to]: latest.from }));

    // Clear after 3s
    const timeout = setTimeout(() => {
      setMessageFlash((prev) => {
        const next = { ...prev };
        delete next[latest.to];
        return next;
      });
    }, 3000);
    return () => clearTimeout(timeout);
  }, [events.length]);

  // Build final nodes
  const nodes = useMemo(() =>
    layoutNodes.map((n) => ({
      ...n,
      data: {
        ...n.data,
        activeTool: activeTools[n.id],
        thought: thoughts[n.id],
        messageFrom: messageFlash[n.id],
      },
    })),
    [layoutNodes, activeTools, thoughts, messageFlash]
  );

  // Build final edges
  const edges = useMemo(() =>
    layoutEdges.map((e) => {
      const isHot = !!hotEdges[e.id];
      // Edges only animate for messages between threads, not tool calls
      return {
        ...e,
        animated: isHot,
        style: {
          stroke: isHot ? "#22c55e" : "#555",
          strokeWidth: isHot ? 3 : 2,
          transition: "stroke 0.3s, stroke-width 0.3s",
        },
      };
    }),
    [layoutEdges, activeTools, hotEdges]
  );

  // Merge drag positions with live data updates
  const [dragPositions, setDragPositions] = useState<Record<string, { x: number; y: number }>>({});

  const finalNodes = useMemo(() =>
    nodes.map((n) => ({
      ...n,
      position: dragPositions[n.id] || n.position,
    })),
    [nodes, dragPositions]
  );

  const onNodesChange: OnNodesChange = useCallback(
    (changes) => {
      for (const change of changes) {
        if (change.type === "position" && change.position && change.id) {
          setDragPositions((prev) => ({ ...prev, [change.id!]: change.position! }));
        }
      }
    },
    []
  );

  const onEdgesChange: OnEdgesChange = useCallback(() => {}, []);

  if (threads.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-text-muted text-sm">
        No threads running
      </div>
    );
  }

  return (
    <div className="h-full w-full" style={{ minHeight: 400 }}>
      <ReactFlow
        nodes={finalNodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        fitView
        fitViewOptions={{ padding: 0.4 }}
        minZoom={0.2}
        maxZoom={2}
        proOptions={{ hideAttribution: true }}
        nodesDraggable={true}
        nodesConnectable={false}
        panOnDrag={true}
        zoomOnScroll={true}
        zoomOnPinch={true}
        panOnScroll={false}
        selectNodesOnDrag={false}
      >
        <Background color="#1a1a1a" gap={24} size={1} />
        <Controls
          showInteractive={false}
          className="!bg-bg-card !border-border !shadow-none [&>button]:!bg-bg-card [&>button]:!border-border [&>button]:!text-text-muted [&>button:hover]:!bg-accent/10"
        />
      </ReactFlow>
    </div>
  );
}
