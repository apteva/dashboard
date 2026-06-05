import { useCallback, useEffect, useMemo, useState } from "react";
import {
  BaseEdge,
  Background,
  Controls,
  EdgeLabelRenderer,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  getSmoothStepPath,
  type Edge as FlowEdge,
  type EdgeProps,
  type Node as FlowNode,
  type NodeProps,
} from "@xyflow/react";

export type SystemMapScope = "project" | "environment";
export type SystemMapNodeKind = "agent" | "thread" | "app" | "event" | "subscription" | "external" | "gateway" | "tool";
export type SystemMapStatus = "running" | "idle" | "ok" | "warning" | "error" | "blocked" | "mocked" | "unknown";
export type SystemMapEdgeKind = "owns" | "tool" | "event" | "integration" | "boundary" | "message";
export type SystemMapNodeLatestKind = "event" | "tool" | "result" | "thinking" | "message" | "error";

export interface SystemMapNode {
  id: string;
  label: string;
  kind: SystemMapNodeKind;
  status?: SystemMapStatus;
  subtitle?: string;
  detail?: string;
  iconUrl?: string;
  latest?: {
    kind: SystemMapNodeLatestKind;
    text: string;
    time?: number;
  };
  badges?: string[];
  activeKind?: SystemMapEdgeKind;
  lastActiveAt?: number;
  x?: number;
  y?: number;
}

export interface SystemMapEdge {
  id: string;
  source: string;
  target: string;
  kind: SystemMapEdgeKind;
  status?: SystemMapStatus;
  label?: string;
  count?: number;
  lastActiveAt?: number;
  softActiveAt?: number;
  packetDirection?: "forward" | "reverse";
  detail?: string;
}

export interface SystemMapActivity {
  id: string;
  time: number;
  source?: string;
  target?: string;
  label: string;
  detail?: string;
  status?: SystemMapStatus;
}

export interface SystemMapStat {
  label: string;
  value: string | number;
}

export interface SystemMapNotice {
  title: string;
  detail?: string;
}

export interface SystemMapProps {
  title: string;
  subtitle?: string;
  scope: SystemMapScope;
  boundaryLabel: string;
  nodes: SystemMapNode[];
  edges: SystemMapEdge[];
  activity?: SystemMapActivity[];
  stats?: SystemMapStat[];
  loading?: boolean;
  emptyText?: string;
  notice?: SystemMapNotice;
  wide?: boolean;
  heightClass?: string;
}

type PositionedNode = SystemMapNode & { x: number; y: number };

type MapNodeData = {
  node?: SystemMapNode;
  selected?: boolean;
  boundaryLabel?: string;
  activeKind?: SystemMapEdgeKind;
};

type MapEdgeData = {
  edge: SystemMapEdge;
  color: string;
  active: boolean;
  softActive: boolean;
  packet: boolean;
  packetReverse: boolean;
  pulseKey?: string;
};

const BASE_BOUNDARY = { x: 48, y: 44, w: 1104, h: 528 };

const nodeTypes = {
  systemApp: SystemBoxNode,
  systemAgent: SystemAgentNode,
  systemThread: SystemThreadNode,
  systemExternal: SystemBoxNode,
  systemGateway: SystemGatewayNode,
  systemBoundary: SystemBoundaryNode,
};

const edgeTypes = {
  systemEdge: SystemEdge,
};

const renderedPulseKeys = new Set<string>();
const renderedPulseOrder: string[] = [];

export function SystemMap({
  title,
  subtitle,
  scope,
  boundaryLabel,
  nodes,
  edges,
  activity = [],
  stats = [],
  loading,
  emptyText = "No system map data yet.",
  notice,
  wide,
  heightClass = "h-[360px] min-h-[320px]",
}: SystemMapProps) {
  const [selectedID, setSelectedID] = useState<string | null>(null);
  const [clock, setClock] = useState(Date.now());

  useEffect(() => {
    const hasTimedState = nodes.some((node) => node.lastActiveAt) || edges.some((edge) => edge.lastActiveAt || edge.softActiveAt);
    if (!hasTimedState) return;
    const timer = window.setInterval(() => setClock(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [nodes, edges]);

  const layout = useMemo(() => autoLayout(nodes), [nodes]);
  const positioned = layout.nodes;
  const nodeByID = useMemo(() => {
    const out = new Map<string, PositionedNode>();
    positioned.forEach((node) => out.set(node.id, node));
    return out;
  }, [positioned]);

  const flow = useMemo(
    () => buildFlowModel(positioned, edges, selectedID, boundaryLabel, clock, layout.boundary),
    [positioned, edges, selectedID, boundaryLabel, clock, layout.boundary],
  );

  const selectedNode = selectedID ? nodeByID.get(selectedID) : null;
  const selectedEdge = selectedID ? edges.find((edge) => edge.id === selectedID) || null : null;

  const onNodeClick = useCallback((_: unknown, node: FlowNode<MapNodeData>) => {
    setSelectedID(node.id);
  }, []);

  const onEdgeClick = useCallback((_: unknown, edge: FlowEdge) => {
    setSelectedID(edge.id);
  }, []);

  return (
    <div className={`${wide ? "w-full" : "mx-auto w-full max-w-[1500px]"} rounded border border-border bg-bg overflow-hidden`}>
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-3 py-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold text-text">{title}</h3>
            <span className="text-[11px] uppercase tracking-wide px-1.5 py-0.5 rounded border border-border text-text-muted">
              {scope}
            </span>
          </div>
          {subtitle && <p className="text-xs text-text-muted mt-0.5">{subtitle}</p>}
        </div>
        {stats.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {stats.map((stat) => (
              <span key={stat.label} className="text-[11px] px-2 py-1 rounded border border-border bg-bg-card text-text-muted">
                {stat.label}: <span className="text-text">{stat.value}</span>
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="grid xl:grid-cols-[minmax(0,1fr)_280px]">
        <div className={`relative overflow-hidden system-map-canvas ${heightClass}`}>
          {!loading && positioned.length > 0 && (
            <ReactFlow
              nodes={flow.nodes}
              edges={flow.edges}
              nodeTypes={nodeTypes}
              edgeTypes={edgeTypes}
              onNodeClick={onNodeClick}
              onEdgeClick={onEdgeClick}
              fitView
              fitViewOptions={{ padding: 0.04, includeHiddenNodes: false }}
              minZoom={0.25}
              maxZoom={1.6}
              nodesDraggable={false}
              nodesConnectable={false}
              elementsSelectable
              panOnDrag
              zoomOnScroll
              zoomOnPinch
              panOnScroll={false}
              selectNodesOnDrag={false}
              proOptions={{ hideAttribution: true }}
              className="system-map-flow"
            >
              <Background color="rgba(255,255,255,0.07)" gap={28} size={1} />
              <Controls
                showInteractive={false}
                className="!bg-bg-card !border-border !shadow-none [&>button]:!bg-bg-card [&>button]:!border-border [&>button]:!text-text-muted [&>button:hover]:!bg-accent/10"
              />
            </ReactFlow>
          )}

          {loading && (
            <div className="absolute inset-0 z-20 flex items-center justify-center bg-bg/60 text-sm text-text-muted">
              Loading map...
            </div>
          )}

          {!loading && positioned.length === 0 && (
            <div className="absolute inset-0 z-20 flex items-center justify-center text-sm text-text-muted">
              {emptyText}
            </div>
          )}

        </div>

        <aside className="border-t xl:border-t-0 xl:border-l border-border bg-bg-card p-3 min-h-[360px] flex flex-col gap-3">
          <section>
            <h4 className="text-xs font-semibold uppercase text-text-muted">Selection</h4>
            {notice && (
              <div className="mt-2 rounded border border-border bg-bg px-2 py-2">
                <div className="text-sm text-text">{notice.title}</div>
                {notice.detail && <div className="mt-1 text-xs text-text-muted">{notice.detail}</div>}
              </div>
            )}
            {!selectedNode && !selectedEdge ? (
              !notice && <p className="mt-1 text-xs text-text-muted">Click a node or edge to inspect it.</p>
            ) : selectedNode ? (
              <DetailBlock
                title={selectedNode.label}
                subtitle={`${selectedNode.kind}${selectedNode.status ? ` - ${selectedNode.status}` : ""}`}
                detail={selectedNode.detail || selectedNode.subtitle || ""}
              />
            ) : selectedEdge ? (
              <DetailBlock
                title={selectedEdge.label || selectedEdge.kind}
                subtitle={`${selectedEdge.kind}${selectedEdge.status ? ` - ${selectedEdge.status}` : ""}`}
                detail={selectedEdge.detail || `${labelForNode(nodeByID, selectedEdge.source)} -> ${labelForNode(nodeByID, selectedEdge.target)}`}
              />
            ) : null}
          </section>

          <section className="min-h-0">
            <LiveActivityList activity={activity} onSelect={(id) => setSelectedID(id)} />
          </section>
        </aside>
      </div>
    </div>
  );
}

function LiveActivityList({ activity, onSelect }: { activity: SystemMapActivity[]; onSelect: (id: string | null) => void }) {
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 5000);
    return () => window.clearInterval(timer);
  }, []);

  const recentActivity = useMemo(() => [...activity].sort((a, b) => b.time - a.time).slice(0, 8), [activity]);

  return (
    <>
      <div className="flex items-center justify-between gap-2">
        <h4 className="text-xs font-semibold uppercase text-text-muted">Live Activity</h4>
        <span className="text-[11px] text-text-muted">{activity.length}</span>
      </div>
      <div className="mt-2 flex max-h-52 flex-col gap-2 overflow-auto pr-1">
        {recentActivity.length === 0 ? (
          <p className="text-xs text-text-muted">No live activity yet.</p>
        ) : (
          recentActivity.map((item) => (
            <button
              key={item.id}
              type="button"
              className="rounded border border-border bg-bg px-2 py-1.5 text-left hover:bg-bg-subtle"
              onClick={() => onSelect(item.target || item.source || null)}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs text-text truncate">{item.label}</span>
                <span className={`h-2 w-2 rounded-full shrink-0 ${activityDotClass(item.status)}`} />
              </div>
              {item.detail && <div className="mt-0.5 text-[11px] text-text-muted truncate">{item.detail}</div>}
              <div className="mt-0.5 text-[10px] text-text-muted">{formatAge(now - item.time)}</div>
            </button>
          ))
        )}
      </div>
    </>
  );
}

function SystemBoxNode({ data }: NodeProps<FlowNode<MapNodeData>>) {
  const node = data.node;
  if (!node) return null;
  return (
    <div className={`relative h-full w-full rounded border px-4 py-3 text-left shadow-sm ${data.selected ? selectedNodeClass(node) : nodeClass(node)} ${nodeActiveClass(data.activeKind)}`}>
      <SideHandles kind={node.kind} />
      <div className="flex items-center gap-3 min-w-0">
        <span className={`h-8 w-8 shrink-0 rounded flex items-center justify-center text-xs font-semibold ${nodeIconClass(node)}`}>
          <NodeIcon node={node} />
        </span>
        <div className="min-w-0">
          <div className="text-base font-semibold text-text truncate">{node.label}</div>
          {node.subtitle && <div className="mt-1 text-sm text-text-muted truncate">{node.subtitle}</div>}
        </div>
      </div>
      {node.badges && node.badges.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {node.badges.slice(0, 3).map((badge) => (
            <span key={badge} className="max-w-full truncate rounded border border-cyan-400/25 bg-cyan-500/[0.06] px-1.5 py-0.5 text-[10px] leading-none text-cyan-100">
              {badge}
            </span>
          ))}
          {node.badges.length > 3 && (
            <span className="rounded border border-border bg-bg/60 px-1.5 py-0.5 text-[10px] leading-none text-text-muted">
              +{node.badges.length - 3}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

function SystemGatewayNode({ data }: NodeProps<FlowNode<MapNodeData>>) {
  const node = data.node;
  if (!node) return null;
  return (
    <div className={`relative h-full w-full rounded border px-2.5 py-2 text-left shadow-sm ${data.selected ? selectedNodeClass(node) : nodeClass(node)} ${nodeActiveClass(data.activeKind)}`}>
      <Handle id="source-right" type="source" position={Position.Right} className={handleClass("gateway")} />
      <div className="flex items-center gap-2 min-w-0">
        <span className={`h-7 w-7 shrink-0 rounded flex items-center justify-center text-[10px] font-semibold ${nodeIconClass(node)}`}>
          <NodeIcon node={node} />
        </span>
        <div className="min-w-0 leading-tight">
          <div className="text-sm font-semibold text-text truncate">{node.label}</div>
          {node.subtitle && <div className="mt-0.5 text-[11px] text-text-muted truncate">{node.subtitle}</div>}
        </div>
      </div>
    </div>
  );
}

function SystemAgentNode({ data }: NodeProps<FlowNode<MapNodeData>>) {
  const node = data.node;
  if (!node) return null;
  return (
    <div className={`relative h-full w-full rounded border px-5 py-4 text-left shadow-md ${data.selected ? selectedNodeClass(node) : nodeClass(node)} ${nodeActiveClass(data.activeKind)}`}>
      <SideHandles kind={node.kind} />
      <div className="flex items-center gap-3 min-w-0">
        <span className={`h-9 w-9 shrink-0 rounded flex items-center justify-center text-sm font-semibold ${nodeIconClass(node)}`}>
          <NodeIcon node={node} />
        </span>
        <div className="min-w-0">
          <div className="text-lg font-semibold text-text truncate">{node.label}</div>
          {node.subtitle && <div className="mt-1 text-sm text-text-muted truncate">{node.subtitle}</div>}
        </div>
      </div>
      <div className="mt-4 border-t border-border/70" />
    </div>
  );
}

function SystemThreadNode({ data }: NodeProps<FlowNode<MapNodeData>>) {
  const node = data.node;
  if (!node) return null;
  return (
    <div className={`relative h-full w-full rounded border px-3 py-2 text-left shadow-sm ${data.selected ? selectedNodeClass(node) : "border-sky-500/35 bg-bg/95"} ${nodeActiveClass(data.activeKind, node.kind)}`}>
      <SideHandles kind={node.kind} small />
      <div className="flex items-start gap-2 min-w-0">
        <span className={`h-6 w-6 shrink-0 rounded flex items-center justify-center text-[11px] font-semibold ${nodeIconClass(node)}`}>
          <NodeIcon node={node} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-text truncate">{node.label}</div>
          {node.subtitle && <div className="mt-0.5 text-xs text-text-muted truncate">{node.subtitle}</div>}
          {node.latest?.text && (
            <div className={`mt-1 flex max-w-full items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] leading-none ${threadLatestClass(node.latest.kind)}`}>
              <span className="shrink-0 uppercase tracking-wide">{threadLatestLabel(node.latest.kind)}</span>
              <span className="min-w-0 truncate">{node.latest.text}</span>
            </div>
          )}
        </div>
        {data.activeKind && (
          <span className="system-map-thread-live">
            active
          </span>
        )}
      </div>
    </div>
  );
}

function NodeIcon({ node }: { node: SystemMapNode }) {
  if (node.iconUrl) {
    return <img src={node.iconUrl} alt="" className="h-5 w-5 rounded-sm object-contain" />;
  }
  return <>{nodeIcon(node.kind)}</>;
}

function SystemEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  markerEnd,
  selected,
  style,
  data,
}: EdgeProps<FlowEdge<MapEdgeData>>) {
  const [edgePath, labelX, labelY] = getSmoothStepPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
    borderRadius: 10,
    offset: 28,
  });
  const color = data?.color || String(style?.stroke || "#8b949e");
  const active = Boolean(data?.active);
  const softActive = Boolean(data?.softActive);
  const packet = Boolean(data?.packet);
  const packetReverse = Boolean(data?.packetReverse);
  const label = edgeLabel(data?.edge, active, softActive);
  const labelPoint = edgeLabelPoint(data?.edge, labelX, labelY, sourceX, sourceY, targetX, targetY);
  return (
    <>
      {active && (
        <BaseEdge
          id={`${id}-glow`}
          path={edgePath}
          style={{
            stroke: color,
            strokeWidth: softActive ? 5 : selected ? 8 : 7,
            opacity: softActive ? 0.1 : 0.24,
            filter: "blur(2px)",
          }}
        />
      )}
      <BaseEdge
        id={id}
        path={edgePath}
        markerEnd={markerEnd}
        style={{
          ...style,
          stroke: color,
          strokeWidth: selected ? 3 : softActive ? 2.5 : active ? 3 : 2,
          opacity: softActive ? 0.76 : active ? 1 : 0.82,
        }}
      />
      {packet && (
        <circle key={data?.pulseKey || id} r="4.5" fill={packetColor(data?.edge.kind)} className="system-map-packet">
          <animateMotion
            dur="0.95s"
            repeatCount="1"
            path={edgePath}
            keyPoints={packetReverse ? "1;0" : "0;1"}
            keyTimes="0;1"
            calcMode="linear"
          />
          <animate attributeName="opacity" values="0;1;1;0" keyTimes="0;0.12;0.76;1" dur="0.95s" fill="freeze" />
        </circle>
      )}
      {label && (
        <EdgeLabelRenderer>
          <div
            className={`system-map-edge-label ${packet ? "system-map-edge-label-active" : ""}`}
            style={{
              transform: `translate(-50%, -50%) translate(${labelPoint.x}px, ${labelPoint.y}px)`,
            }}
          >
            {label}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

function SideHandles({ kind, small }: { kind: SystemMapNodeKind; small?: boolean }) {
  const cls = handleClass(kind, small);
  const hidden = "!opacity-0 !border-0";
  const visible = kind === "agent" ? hidden : cls;
  return (
    <>
      <Handle id="target-left" type="target" position={Position.Left} className={visible} />
      <Handle id="source-left" type="source" position={Position.Left} className={hidden} />
      <Handle id="target-right" type="target" position={Position.Right} className={visible} />
      <Handle id="source-right" type="source" position={Position.Right} className={hidden} />
      <Handle id="target-top" type="target" position={Position.Top} className={visible} />
      <Handle id="source-top" type="source" position={Position.Top} className={hidden} />
      <Handle id="target-bottom" type="target" position={Position.Bottom} className={visible} />
      <Handle id="source-bottom" type="source" position={Position.Bottom} className={hidden} />
    </>
  );
}

function SystemBoundaryNode({ data }: NodeProps<FlowNode<MapNodeData>>) {
  return (
    <div className={`pointer-events-none relative h-full w-full rounded border border-accent/45 bg-accent/[0.025] shadow-[0_0_24px_rgba(249,115,22,0.06)] ${nodeActiveClass(data.activeKind, "gateway")}`}>
      <div className="absolute left-6 top-4 text-[11px] uppercase tracking-wide text-accent">{data.boundaryLabel}</div>
      <div className="absolute -right-1 -top-6 text-[11px] uppercase tracking-wide text-text-muted">Outside world</div>
    </div>
  );
}

function buildFlowModel(
  positioned: PositionedNode[],
  edges: SystemMapEdge[],
  selectedID: string | null,
  boundaryLabel: string,
  now: number,
  boundary: typeof BASE_BOUNDARY,
) {
  const nodeByID = new Map<string, PositionedNode>();
  positioned.forEach((node) => nodeByID.set(node.id, node));

  const ownedThreadIDs = new Set<string>();
  const threadsByAgent = new Map<string, PositionedNode[]>();
  edges.forEach((edge) => {
    if (edge.kind !== "owns") return;
    const agent = nodeByID.get(edge.source);
    const thread = nodeByID.get(edge.target);
    if (!agent || !thread || agent.kind !== "agent" || thread.kind !== "thread") return;
    ownedThreadIDs.add(thread.id);
    const list = threadsByAgent.get(agent.id) || [];
    list.push(thread);
    threadsByAgent.set(agent.id, list);
  });
  threadsByAgent.forEach((list) => list.sort((a, b) => a.label.localeCompare(b.label)));

  const flowNodes: FlowNode<MapNodeData>[] = [
    {
      id: "__system_boundary",
      type: "systemBoundary",
      position: { x: boundary.x, y: boundary.y },
      data: { boundaryLabel, activeKind: activeBoundaryKind(edges, now) },
      draggable: false,
      selectable: false,
      focusable: false,
      style: { width: boundary.w, height: boundary.h },
      zIndex: 0,
    },
  ];
  const centers = new Map<string, { x: number; y: number }>();
  const activeByNode = activeNodeKinds(positioned, edges, now);

  positioned.forEach((node) => {
    if (ownedThreadIDs.has(node.id)) return;
    const childCount = threadsByAgent.get(node.id)?.length || 0;
    const size = flowNodeSize(node.kind, childCount);
    const center = percentToPoint(node, boundary);
    centers.set(node.id, center);
    flowNodes.push({
      id: node.id,
      type:
        node.kind === "agent"
          ? "systemAgent"
          : node.kind === "external"
            ? "systemExternal"
            : node.kind === "gateway"
              ? "systemGateway"
              : "systemApp",
      position: { x: center.x - size.w / 2, y: center.y - size.h / 2 },
      data: { node, selected: selectedID === node.id, activeKind: activeByNode.get(node.id) },
      draggable: false,
      selectable: true,
      style: { width: size.w, height: size.h },
      zIndex: 2,
      sourcePosition: Position.Right,
      targetPosition: Position.Left,
    });

    if (node.kind === "agent") {
      const threads = threadsByAgent.get(node.id) || [];
      const agentTopLeft = { x: center.x - size.w / 2, y: center.y - size.h / 2 };
      threads.forEach((thread, index) => {
        const threadSize = flowNodeSize("thread");
        const x = 24;
        const y = 86 + index * 92;
        centers.set(thread.id, {
          x: agentTopLeft.x + x + threadSize.w / 2,
          y: agentTopLeft.y + y + threadSize.h / 2,
        });
        flowNodes.push({
          id: thread.id,
          type: "systemThread",
          position: { x: agentTopLeft.x + x, y: agentTopLeft.y + y },
          data: { node: thread, selected: selectedID === thread.id, activeKind: activeByNode.get(thread.id) },
          draggable: false,
          selectable: true,
          style: { width: threadSize.w, height: threadSize.h },
          zIndex: 4,
          sourcePosition: Position.Right,
          targetPosition: Position.Left,
        });
      });
    }
  });

  const flowEdges: FlowEdge[] = [];
  edges.forEach((edge) => {
    if (edge.kind === "owns") return;
    const source = centers.get(edge.source);
    const target = centers.get(edge.target);
    if (!source || !target) return;
    const age = edge.lastActiveAt ? now - edge.lastActiveAt : Number.POSITIVE_INFINITY;
    const softAge = edge.softActiveAt ? now - edge.softActiveAt : Number.POSITIVE_INFINITY;
    const hardActive = age < 3200;
    const softActive = !hardActive && softAge < 2200;
    const active = hardActive || softActive;
    const packet = shouldRenderPacket(edge, age);
    const ports = edgePorts(source, target, edge, nodeByID.get(edge.source), nodeByID.get(edge.target));
    const color = edgeColor(edge.status, edge.kind);
    flowEdges.push({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      sourceHandle: `source-${ports.source}`,
      targetHandle: `target-${ports.target}`,
      type: "systemEdge",
      selected: selectedID === edge.id,
      interactionWidth: 18,
      markerEnd: edge.kind === "tool" ? undefined : { type: MarkerType.ArrowClosed, color, width: 16, height: 16 },
      data: {
        edge,
        color,
        active,
        softActive,
        packet,
        packetReverse: edge.packetDirection === "reverse",
        pulseKey: edge.lastActiveAt ? `${edge.id}:${edge.lastActiveAt}` : edge.id,
      },
      style: {
        stroke: color,
        strokeWidth: selectedID === edge.id || active ? 3 : 2.25,
        opacity: active ? 1 : 0.9,
        strokeDasharray: edge.kind === "integration" || edge.kind === "boundary" ? "6 5" : undefined,
      },
      labelStyle: { fill: "var(--text-muted)", fontSize: 11, fontWeight: 600 },
      labelBgStyle: { fill: "var(--bg)", fillOpacity: 0.9 },
    });
  });

  return { nodes: flowNodes, edges: flowEdges };
}

function shouldRenderPacket(edge: SystemMapEdge, age: number) {
  if (!edge.lastActiveAt || age > 1000) return false;
  const key = `${edge.id}:${edge.lastActiveAt}`;
  if (renderedPulseKeys.has(key)) return false;
  renderedPulseKeys.add(key);
  renderedPulseOrder.push(key);
  while (renderedPulseOrder.length > 180) {
    const old = renderedPulseOrder.shift();
    if (old) renderedPulseKeys.delete(old);
  }
  return true;
}

function edgeLabelPoint(
  edge: SystemMapEdge | undefined,
  labelX: number,
  labelY: number,
  sourceX: number,
  sourceY: number,
  targetX: number,
  targetY: number,
) {
  if (!edge) return { x: labelX, y: labelY };
  const dx = targetX - sourceX;
  const dy = targetY - sourceY;
  if (edge.kind === "tool") {
    if (Math.abs(dy) > Math.abs(dx)) {
      return { x: labelX + (dx >= 0 ? 42 : -42), y: labelY };
    }
    return { x: labelX, y: labelY + (dy >= 0 ? 24 : -24) };
  }
  if (edge.kind === "event") {
    return { x: labelX + (dx >= 0 ? 22 : -22), y: labelY - 38 };
  }
  return { x: labelX, y: labelY - 18 };
}

function activeNodeKinds(nodes: PositionedNode[], edges: SystemMapEdge[], now: number) {
  const ids = new Set(nodes.map((node) => node.id));
  const out = new Map<string, SystemMapEdgeKind>();
  nodes.forEach((node) => {
    if (!node.lastActiveAt || now - node.lastActiveAt > 5000) return;
    out.set(node.id, node.activeKind || "message");
  });
  edges.forEach((edge) => {
    if (!edge.lastActiveAt || now - edge.lastActiveAt > 3200) return;
    if (ids.has(edge.source)) out.set(edge.source, edge.kind);
    if (ids.has(edge.target)) out.set(edge.target, edge.kind);
  });
  edges.forEach((edge) => {
    if (!edge.softActiveAt || now - edge.softActiveAt > 2200) return;
    if (ids.has(edge.source) && !out.has(edge.source)) out.set(edge.source, edge.kind);
    if (ids.has(edge.target) && !out.has(edge.target)) out.set(edge.target, edge.kind);
  });
  return out;
}

function activeBoundaryKind(edges: SystemMapEdge[], now: number): SystemMapEdgeKind | undefined {
  const active = edges.find(
    (edge) =>
      edge.lastActiveAt &&
      now - edge.lastActiveAt < 3200 &&
      (edge.kind === "boundary" || edge.kind === "integration" || edge.kind === "event"),
  );
  return active?.kind;
}

function edgePorts(
  source: { x: number; y: number },
  target: { x: number; y: number },
  edge: SystemMapEdge,
  sourceNode?: SystemMapNode,
  targetNode?: SystemMapNode,
) {
  const dx = target.x - source.x;
  const dy = target.y - source.y;
  if (edge.kind === "tool" && sourceNode?.kind === "thread" && targetNode?.kind === "app" && Math.abs(dy) > 24) {
    if (Math.abs(dy) > 56) {
      return dy > 0 ? { source: "bottom", target: "top" } : { source: "top", target: "bottom" };
    }
    return dx >= 0 ? { source: "right", target: "left" } : { source: "left", target: "right" };
  }
  if (edge.kind === "event" && sourceNode?.kind === "event") {
    return { source: "right", target: dx >= 0 ? "left" : "right" };
  }
  if (Math.abs(dy) > 72 || Math.abs(dy) > Math.abs(dx) * 0.5) {
    return dy > 0 ? { source: "bottom", target: "top" } : { source: "top", target: "bottom" };
  }
  return dx >= 0 ? { source: "right", target: "left" } : { source: "left", target: "right" };
}

function flowNodeSize(kind: SystemMapNodeKind, childCount = 0) {
  switch (kind) {
    case "agent":
      return { w: 380, h: childCount > 0 ? 112 + childCount * 92 : 112 };
    case "thread":
      return { w: 332, h: 78 };
    case "app":
      return { w: 220, h: 86 };
    case "event":
      return { w: 190, h: 76 };
    case "subscription":
      return { w: 230, h: 78 };
    case "gateway":
      return { w: 132, h: 46 };
    case "external":
      return { w: 250, h: 82 };
    default:
      return { w: 200, h: 76 };
  }
}

function percentToPoint(node: PositionedNode, boundary: typeof BASE_BOUNDARY) {
  return { x: boundary.x + (node.x / 100) * boundary.w, y: boundary.y + (node.y / 100) * boundary.h };
}

function autoLayout(nodes: SystemMapNode[]): { nodes: PositionedNode[]; boundary: typeof BASE_BOUNDARY } {
  const events = nodes.filter((node) => node.kind === "event");
  const subscriptions = nodes.filter((node) => node.kind === "subscription" && (node.x === undefined || node.y === undefined));
  const explicit = nodes.filter((node) => !["event", "subscription"].includes(node.kind) && node.x !== undefined && node.y !== undefined) as PositionedNode[];
  const needs = nodes.filter((node) => !["event", "subscription"].includes(node.kind) && (node.x === undefined || node.y === undefined));
  const agents = needs.filter((node) => node.kind === "agent");
  const threads = needs.filter((node) => node.kind === "thread");
  const apps = needs.filter((node) => node.kind === "app" || node.kind === "tool" || node.kind === "gateway");
  const external = needs.filter((node) => node.kind === "external");

  const out: PositionedNode[] = [...explicit];
  events.forEach((node, index) => out.push({ ...node, x: 14, y: 32 + index * 15 }));
  subscriptions.forEach((node, index) => out.push({ ...node, x: 36, y: 32 + index * 15 }));
  agents.forEach((node, index) => out.push({ ...node, ...slot(index, agents.length, 50, 48, 22, 0) }));
  threads.forEach((node, index) => out.push({ ...node, ...slot(index, threads.length, 50, 62, 26, 8) }));
  apps.forEach((node, index) => out.push({ ...node, ...slot(index, apps.length, 50, 32, 30, -8) }));
  external.forEach((node, index) => out.push({ ...node, x: index % 2 === 0 ? 7 : 93, y: 24 + Math.floor(index / 2) * 18 }));
  return { nodes: out, boundary: dynamicBoundary(out) };
}

function dynamicBoundary(nodes: PositionedNode[]) {
  const internal = nodes.filter((node) => node.kind !== "external");
  const agents = internal.filter((node) => node.kind === "agent").length;
  const apps = internal.filter((node) => node.kind === "app" || node.kind === "tool" || node.kind === "gateway").length;
  const events = internal.filter((node) => node.kind === "event" || node.kind === "subscription").length;
  const externals = nodes.filter((node) => node.kind === "external").length;
  const agentCols = layoutColumns(agents, 4);
  const appCols = layoutColumns(apps, 7);
  const agentRows = Math.max(1, Math.ceil(agents / Math.max(1, agentCols)));
  const appRows = Math.max(1, Math.ceil(apps / Math.max(1, appCols)));
  const eventRows = Math.max(1, events);

  const width = Math.max(
    BASE_BOUNDARY.w,
    Math.min(2800, 280 + Math.max(agentCols * 430, appCols * 320, 760)),
  );
  const height = Math.max(
    BASE_BOUNDARY.h,
    Math.min(1800, 230 + agentRows * 168 + appRows * 112 + Math.min(3, eventRows) * 24),
  );
  const externalHeight = externals > 0 ? 170 + Math.min(18, externals) * 78 : 0;
  return { ...BASE_BOUNDARY, w: width, h: Math.max(height, externalHeight) };
}

function layoutColumns(total: number, maxColumns: number) {
  if (total <= 0) return 0;
  if (total <= 2) return total;
  if (total <= 4) return total;
  if (total <= 8) return Math.min(total, 4);
  if (total <= 14) return Math.min(total, 5);
  if (total <= 24) return Math.min(total, 6);
  return Math.min(total, maxColumns);
}

function slot(index: number, total: number, centerX: number, centerY: number, radiusX: number, offset: number) {
  if (total <= 1) return { x: centerX, y: centerY };
  const angle = (index / total) * Math.PI * 2 - Math.PI / 2 + offset / 10;
  return {
    x: centerX + Math.cos(angle) * radiusX,
    y: centerY + Math.sin(angle) * Math.max(9, radiusX * 0.42),
  };
}

function nodeClass(node: SystemMapNode): string {
  switch (node.status) {
    case "error":
    case "blocked":
      return "border-red-500/50 bg-red-500/10";
    case "warning":
    case "mocked":
      return "border-yellow/50 bg-yellow/10";
    case "running":
      if (node.kind === "agent") return "border-sky-400/65 bg-sky-500/[0.10] shadow-[0_0_28px_rgb(56_189_248_/_0.14)]";
      if (node.kind === "thread") return "border-sky-500/45 bg-sky-500/[0.06]";
	      if (node.kind === "app") return "border-emerald-500/60 bg-emerald-500/10";
	      if (node.kind === "event") return "border-cyan-400/55 bg-cyan-500/[0.075] shadow-[0_0_24px_rgb(34_211_238_/_0.10)]";
	      if (node.kind === "subscription") return "border-violet-400/55 bg-violet-500/[0.075] shadow-[0_0_24px_rgb(167_139_250_/_0.12)]";
	      if (node.kind === "external") return "border-cyan-400/55 bg-cyan-500/[0.075] shadow-[0_0_24px_rgb(34_211_238_/_0.10)]";
      if (node.kind === "gateway") return "border-amber-400/55 bg-amber-500/[0.075]";
      return "border-emerald-500/55 bg-emerald-500/10";
    default:
      if (node.kind === "agent") return "border-sky-500/45 bg-sky-500/[0.075] shadow-[0_0_24px_rgb(56_189_248_/_0.10)]";
      if (node.kind === "thread") return "border-sky-500/35 bg-sky-500/[0.045]";
	      if (node.kind === "app") return "border-emerald-500/35 bg-emerald-500/[0.045]";
	      if (node.kind === "event") return "border-cyan-400/35 bg-cyan-500/[0.045]";
	      if (node.kind === "subscription") return "border-violet-400/35 bg-violet-500/[0.045]";
	      if (node.kind === "external") return "border-cyan-400/35 bg-cyan-500/[0.045]";
      if (node.kind === "gateway") return "border-amber-400/35 bg-amber-500/[0.045]";
      return "border-border bg-bg-card";
  }
}

function selectedNodeClass(node: SystemMapNode): string {
  if (node.kind === "agent") return "border-sky-300/90 bg-sky-500/[0.14] shadow-[0_0_34px_rgb(56_189_248_/_0.28)]";
  if (node.kind === "app") return "border-emerald-400 bg-emerald-500/15 shadow-[0_0_28px_rgb(16_185_129_/_0.22)]";
  if (node.kind === "thread") return "border-sky-300/80 bg-sky-500/[0.12] shadow-[0_0_24px_rgb(56_189_248_/_0.24)]";
  if (node.kind === "event") return "border-cyan-300/80 bg-cyan-500/[0.12] shadow-[0_0_24px_rgb(34_211_238_/_0.22)]";
  if (node.kind === "subscription") return "border-violet-300/80 bg-violet-500/[0.12] shadow-[0_0_24px_rgb(167_139_250_/_0.22)]";
  if (node.kind === "external") return "border-cyan-300/80 bg-cyan-500/[0.12] shadow-[0_0_24px_rgb(34_211_238_/_0.22)]";
  if (node.kind === "gateway") return "border-amber-300/80 bg-amber-500/[0.12]";
  return "border-accent bg-accent/10";
}

function nodeActiveClass(kind: SystemMapEdgeKind | undefined, nodeKind?: SystemMapNodeKind): string {
  if (!kind) return "";
  if (nodeKind === "thread") return "system-map-thread-active";
  if (kind === "event") return "system-map-node-event";
  if (kind === "tool") return "system-map-node-tool";
  if (kind === "integration" || kind === "boundary") return "system-map-node-boundary";
  return "system-map-node-active";
}

function nodeIconClass(node: SystemMapNode): string {
  switch (node.kind) {
    case "agent":
      return "bg-sky-500/15 text-sky-300";
    case "thread":
      return "bg-sky-500/10 text-sky-300";
    case "app":
      return "bg-emerald-500/10 text-emerald-400";
    case "event":
      return "bg-cyan-500/10 text-cyan-300";
    case "subscription":
      return "bg-violet-500/10 text-violet-300";
    case "gateway":
      return "bg-amber-500/10 text-amber-300";
    case "external":
      return "bg-cyan-500/10 text-cyan-300";
    default:
      return "bg-bg-subtle text-text-muted";
  }
}

function nodeIcon(kind: SystemMapNodeKind): string {
  switch (kind) {
    case "agent":
      return "A";
    case "thread":
      return "T";
    case "app":
      return "AP";
    case "event":
      return "EV";
    case "subscription":
      return "SUB";
    case "gateway":
      return "NW";
    case "external":
      return "EX";
    case "tool":
      return "TL";
  }
}

function threadLatestLabel(kind: SystemMapNodeLatestKind): string {
  switch (kind) {
    case "event":
      return "event";
    case "tool":
      return "call";
    case "result":
      return "result";
    case "thinking":
      return "think";
    case "message":
      return "msg";
    case "error":
      return "error";
  }
}

function threadLatestClass(kind: SystemMapNodeLatestKind): string {
  switch (kind) {
    case "event":
      return "border-cyan-400/35 bg-cyan-500/[0.08] text-cyan-100";
    case "tool":
      return "border-sky-400/40 bg-sky-500/[0.10] text-sky-100";
    case "result":
      return "border-emerald-400/35 bg-emerald-500/[0.08] text-emerald-100";
    case "thinking":
      return "border-accent/35 bg-accent/[0.08] text-text";
    case "message":
      return "border-border bg-bg-subtle text-text-muted";
    case "error":
      return "border-red-400/45 bg-red-500/[0.10] text-red-100";
  }
}

function handleClass(kind: SystemMapNodeKind, small?: boolean): string {
  const size = small ? "!w-2.5 !h-2.5" : "!w-3.5 !h-3.5";
  const color =
    kind === "app"
      ? "!bg-emerald-400"
      : kind === "agent"
        ? "!bg-accent"
	        : kind === "thread"
	          ? "!bg-sky-400"
	          : kind === "event"
	            ? "!bg-cyan-300"
	            : kind === "subscription"
	              ? "!bg-violet-300"
	              : kind === "external"
	                ? "!bg-cyan-300"
	                : kind === "gateway"
	                  ? "!bg-amber-400"
	                  : "!bg-neutral-400";
  return `${size} ${color} !border-2 !border-bg !shadow-[0_0_0_1px_rgba(255,255,255,0.25)]`;
}

function edgeColor(status: SystemMapStatus | undefined, kind: SystemMapEdgeKind): string {
  if (status === "error" || status === "blocked") return "#ef4444";
  if (status === "mocked" || status === "warning") return "#eab308";
  if (kind === "integration" || kind === "boundary") return "#f97316";
  if (kind === "event") return "#06b6d4";
  if (kind === "tool") return "#60a5fa";
  if (status === "running") return "#22c55e";
  return "#8b949e";
}

function packetColor(kind: SystemMapEdgeKind | undefined): string {
  if (kind === "event") return "#22d3ee";
  if (kind === "tool") return "#93c5fd";
  if (kind === "integration" || kind === "boundary") return "#fb923c";
  if (kind === "message") return "#f97316";
  return "#e8e8e8";
}

function activityBubbleLabel(edge: SystemMapEdge | undefined): string {
  if (!edge) return "";
  if (edge.kind === "event") return shortLabel(edge.label || edge.detail || "event");
  if (edge.kind === "tool") return shortLabel(edge.label || "tool");
  if (edge.kind === "integration" || edge.kind === "boundary") return shortLabel(edge.label || "network");
  if (edge.kind === "message") return edge.label || "message";
  return "";
}

function edgeLabel(edge: SystemMapEdge | undefined, active: boolean, softActive: boolean): string {
  if (!edge) return "";
  if (edge.kind === "tool" || edge.kind === "event" || edge.kind === "integration" || edge.kind === "boundary") {
    return active || softActive ? activityBubbleLabel(edge) : "";
  }
  return activityBubbleLabel(edge);
}

function shortLabel(value: string): string {
  return value.length > 18 ? `${value.slice(0, 17)}...` : value;
}

function activityDotClass(status: SystemMapStatus | undefined): string {
  switch (status) {
    case "error":
    case "blocked":
      return "bg-red-400";
    case "mocked":
    case "warning":
      return "bg-yellow";
    case "running":
      return "bg-emerald-400 animate-pulse";
    default:
      return "bg-accent";
  }
}

function labelForNode(nodes: Map<string, PositionedNode>, id: string): string {
  return nodes.get(id)?.label || id;
}

function DetailBlock({ title, subtitle, detail }: { title: string; subtitle: string; detail?: string }) {
  return (
    <div className="mt-2 rounded border border-border bg-bg px-2 py-2">
      <div className="text-sm text-text truncate">{title}</div>
      <div className="text-[11px] uppercase tracking-wide text-text-muted">{subtitle}</div>
      {detail && <p className="mt-2 text-xs text-text-muted whitespace-pre-wrap break-words">{detail}</p>}
    </div>
  );
}

function formatAge(ms: number): string {
  if (ms < 1000) return "now";
  if (ms < 60_000) return `${Math.max(1, Math.round(ms / 1000))}s ago`;
  return `${Math.max(1, Math.round(ms / 60_000))}m ago`;
}
