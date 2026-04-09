import { useMemo, useCallback } from "react";
import {
  ReactFlow,
  Background,
  type Node,
  type Edge,
  type NodeProps,
  Position,
  Handle,
  useNodesState,
  useEdgesState,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { Thread } from "../api";

// ─── Custom Node ───

interface ThreadNodeData {
  label: string;
  rate: string;
  iteration: number;
  depth: number;
  activeTool?: string;
  thought?: string;
  [key: string]: unknown;
}

function ThreadNode({ data }: NodeProps<Node<ThreadNodeData>>) {
  const isActive = !!data.activeTool;
  const isMain = data.label === "main";

  return (
    <div
      className={`
        rounded-lg border px-3 py-2 min-w-[140px] max-w-[200px] text-xs
        ${isActive ? "border-accent bg-accent/10" : "border-border bg-bg-card"}
        ${isMain ? "border-accent/50" : ""}
      `}
    >
      <Handle type="target" position={Position.Top} className="!bg-border !w-2 !h-2 !border-0" />

      {/* Header */}
      <div className="flex items-center gap-1.5 mb-1">
        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${isActive ? "bg-accent animate-pulse" : "bg-green"}`} />
        <span className="text-text font-bold truncate">{data.label}</span>
      </div>

      {/* Status */}
      {isActive ? (
        <div className="text-accent truncate">⟳ {data.activeTool}</div>
      ) : (
        <div className="text-text-muted">#{data.iteration} {data.rate}</div>
      )}

      {/* Thought preview */}
      {data.thought && (
        <div className="text-text-dim mt-1 truncate italic text-[10px]">{data.thought}</div>
      )}

      <Handle type="source" position={Position.Bottom} className="!bg-border !w-2 !h-2 !border-0" />
    </div>
  );
}

const nodeTypes = { thread: ThreadNode };

// ─── Layout ───

function layoutTree(threads: Thread[]): { nodes: Node<ThreadNodeData>[]; edges: Edge[] } {
  if (threads.length === 0) return { nodes: [], edges: [] };

  // Build children map
  const children: Record<string, Thread[]> = {};
  const roots: Thread[] = [];

  for (const t of threads) {
    const pid = t.parent_id || "";
    if (t.id === "main" || (!t.parent_id && !t.depth)) {
      roots.push(t);
    } else {
      if (!children[pid]) children[pid] = [];
      children[pid].push(t);
    }
  }

  const nodes: Node<ThreadNodeData>[] = [];
  const edges: Edge[] = [];

  const NODE_W = 170;
  const NODE_H = 80;
  const H_GAP = 30;
  const V_GAP = 40;

  // Calculate subtree widths for centering
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

  // Layout nodes
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
      },
    });

    if (t.parent_id) {
      edges.push({
        id: `${t.parent_id}-${t.id}`,
        source: t.parent_id,
        target: t.id,
        style: { stroke: "var(--color-border)", strokeWidth: 1.5 },
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

  // Process roots
  for (const root of roots) {
    calcWidth(root.id);
  }

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
  activeTools: Record<string, string>; // threadId → tool name
  thoughts: Record<string, string>;    // threadId → latest thought text
}

export function FleetGraph({ threads, activeTools, thoughts }: FleetGraphProps) {
  const { nodes: layoutNodes, edges: layoutEdges } = useMemo(() => layoutTree(threads), [threads]);

  // Enrich nodes with live data
  const enrichedNodes = useMemo(() =>
    layoutNodes.map((n) => ({
      ...n,
      data: {
        ...n.data,
        activeTool: activeTools[n.id],
        thought: thoughts[n.id],
      },
    })),
    [layoutNodes, activeTools, thoughts]
  );

  // Animate edges with active tool calls
  const enrichedEdges = useMemo(() =>
    layoutEdges.map((e) => ({
      ...e,
      animated: !!activeTools[e.target],
      style: {
        ...e.style,
        stroke: activeTools[e.target] ? "var(--color-accent)" : "var(--color-border)",
      },
    })),
    [layoutEdges, activeTools]
  );

  const [nodes, , onNodesChange] = useNodesState(enrichedNodes);
  const [edges, , onEdgesChange] = useEdgesState(enrichedEdges);

  // Update nodes/edges when enriched data changes
  useMemo(() => {
    onNodesChange(enrichedNodes.map((n) => ({ type: "reset" as const, item: n })));
  }, [enrichedNodes]);

  useMemo(() => {
    onEdgesChange(enrichedEdges.map((e) => ({ type: "reset" as const, item: e })));
  }, [enrichedEdges]);

  if (threads.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-text-muted text-sm">
        No threads running
      </div>
    );
  }

  return (
    <div className="h-full w-full">
      <ReactFlow
        nodes={enrichedNodes}
        edges={enrichedEdges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        fitView
        fitViewOptions={{ padding: 0.3 }}
        minZoom={0.3}
        maxZoom={1.5}
        proOptions={{ hideAttribution: true }}
        nodesDraggable={true}
        nodesConnectable={false}
        elementsSelectable={false}
      >
        <Background color="var(--color-border)" gap={20} size={1} />
      </ReactFlow>
    </div>
  );
}
