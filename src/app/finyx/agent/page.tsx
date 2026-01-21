"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { DragEvent, PointerEvent } from "react";
import { AgentChatWidget } from "@/components/agent-chat-widget";

const sections = [
  {
    id: "overview",
    label: "Overview",
    title: "Agent Command Center",
    description:
      "Monitor your agent, review recent activity, and configure core behaviors.",
    bullets: [
      "Check health, latency, and ingestion status.",
      "Review recent chat sessions and outcomes.",
      "Validate the RAG pipeline end-to-end.",
    ],
  },
  {
    id: "workflow",
    label: "Workflow",
    title: "Workflow Studio",
    description: "Design VoltAgent workflows with drag-and-drop blocks.",
    bullets: [
      "Compose triggers, LLM steps, tools, and guards.",
      "Define branching, parallel steps, and memory hops.",
      "Save versions directly to the workflow registry.",
    ],
  },
  {
    id: "knowledge",
    label: "Knowledge Base",
    title: "Knowledge Base",
    description:
      "Manage indexed documents, chunking rules, and embedding updates.",
    bullets: [
      "Review indexed files and chunk counts.",
      "Trigger a forced reindex when sources change.",
      "Tune chunk sizes and overlap for retrieval quality.",
    ],
  },
  {
    id: "tools",
    label: "Tools & Integrations",
    title: "Tools & Integrations",
    description: "Configure tools, web access, and connected services.",
    bullets: [
      "Enable or disable tool access per environment.",
      "Manage API keys and rate limits.",
      "Audit tool usage for compliance.",
    ],
  },
  {
    id: "settings",
    label: "Settings",
    title: "Agent Settings",
    description: "Tune model, instructions, and fallback behavior.",
    bullets: [
      "Select model provider and runtime options.",
      "Control RAG fallback thresholds.",
      "Manage response tone and guardrails.",
    ],
  },
];

const workflowBlocks = [
  {
    type: "trigger",
    title: "Trigger",
    description: "定时、事件或人工触发",
  },
  {
    type: "intent-router",
    title: "Intent Router",
    description: "把问题交给合适的流程",
  },
  {
    type: "llm-call",
    title: "LLM Step",
    description: "生成内容或建议",
  },
  {
    type: "tool-call",
    title: "Tool Call",
    description: "调用系统完成任务",
  },
  {
    type: "rag",
    title: "RAG Lookup",
    description: "先查知识库再回答",
  },
  {
    type: "memory",
    title: "Memory",
    description: "保存关键信息便于后续使用",
  },
  {
    type: "guardrail",
    title: "Guardrail",
    description: "避免违规或不当内容",
  },
  {
    type: "branch",
    title: "Branch",
    description: "根据条件走不同路线",
  },
  {
    type: "parallel",
    title: "Parallel",
    description: "多件事并行执行",
  },
  {
    type: "output",
    title: "Output",
    description: "给用户最终结果",
  },
];

type WorkflowNode = {
  id: string;
  type: string;
  title: string;
  description: string;
  x: number;
  y: number;
};

type WorkflowEdge = {
  from: string;
  to: string;
  controlX?: number;
  controlY?: number;
};

const createNode = (
  type: string,
  title: string,
  description: string,
  x: number,
  y: number
): WorkflowNode => ({
  id: `node_${Math.random().toString(36).slice(2, 9)}`,
  type,
  title,
  description,
  x,
  y,
});

const buildLocalRagWorkflow = () => {
  const trigger = createNode("trigger", "User Message", "用户发起对话", 80, 120);
  const validate = createNode(
    "guardrail",
    "Validate Input",
    "检查输入是否有效",
    320,
    120
  );
  const compose = createNode(
    "memory",
    "Compose Options",
    "整理 ragMode/会话信息",
    560,
    120
  );
  const execute = createNode(
    "tool-call",
    "Execute Workflow",
    "请求 local-rag-workflow",
    800,
    120
  );
  const modeCheck = createNode(
    "branch",
    "Mode Check",
    "rag / llm / hybrid 选择",
    1040,
    120
  );
  const rag = createNode("rag", "Local Retrieval", "本地知识检索", 1320, 40);
  const threshold = createNode(
    "branch",
    "Threshold Check",
    "分数/距离是否达标",
    1600,
    40
  );
  const summarySwitch = createNode(
    "branch",
    "LLM Summary?",
    "是否启用 LLM 总结",
    1880,
    40
  );
  const llm = createNode("llm-call", "LLM Summary", "生成/润色回复", 2160, 40);
  const direct = createNode("output", "Direct Return", "直接返回检索答案", 2160, 240);
  const llmOnly = createNode(
    "llm-call",
    "LLM Only",
    "直接生成答案",
    1320,
    240
  );
  const output = createNode("output", "Return Response", "输出最终结果", 2440, 120);

  const edges: WorkflowEdge[] = [
    { from: trigger.id, to: validate.id },
    { from: validate.id, to: compose.id },
    { from: compose.id, to: execute.id },
    { from: execute.id, to: modeCheck.id },
    { from: modeCheck.id, to: rag.id },
    { from: modeCheck.id, to: llmOnly.id },
    { from: rag.id, to: threshold.id },
    { from: threshold.id, to: summarySwitch.id },
    { from: summarySwitch.id, to: llm.id },
    { from: summarySwitch.id, to: direct.id },
    { from: llm.id, to: output.id },
    { from: direct.id, to: output.id },
    { from: llmOnly.id, to: output.id },
  ];

  return {
    nodes: [
      trigger,
      validate,
      compose,
      execute,
      modeCheck,
      rag,
      threshold,
      summarySwitch,
      llm,
      direct,
      llmOnly,
      output,
    ],
    edges,
  };
};

const nodeDescriptionZh: Record<string, string> = {
  trigger: "开始方式：定时、事件或人工触发",
  "intent-router": "问题分流：把问题交给合适的流程",
  "llm-call": "智能回答：生成内容或建议",
  "tool-call": "执行动作：调用系统完成任务",
  rag: "查资料：先查知识库再回答",
  memory: "记录/读取：保存关键信息便于后续使用",
  guardrail: "内容把关：避免违规或不当内容",
  branch: "判断分支：根据条件走不同路线",
  parallel: "同时处理：多件事并行执行",
  output: "最终输出：给用户最终结果",
};

const getNodeSize = (node?: WorkflowNode) => {
  if (node?.type === "branch") {
    return { width: 190, height: 96 };
  }
  return { width: 232, height: 126 };
};

const getNodeTheme = (node?: WorkflowNode) => {
  if (node?.type === "branch") {
    return {
      background: "linear-gradient(135deg, #fff7ed 0%, #ffedd5 100%)",
      borderColor: "#c2410c",
      boxShadow:
        "0 10px 24px rgba(120,53,15,0.12), 0 0 0 2px rgba(194,65,12,0.15)",
      color: "#7c2d12",
    };
  }
  return {
    background: "linear-gradient(135deg, #ffffff 0%, #f8fafc 100%)",
    borderColor: "#e2e8f0",
    boxShadow: "0 12px 30px rgba(15,23,42,0.08)",
    color: "#0f172a",
  };
};

export default function AgentManagementPage() {
  const defaultWorkflow = useMemo(() => buildLocalRagWorkflow(), []);
  const [activeId, setActiveId] = useState(sections[0]?.id ?? "overview");
  const activeSection = useMemo(
    () => sections.find((section) => section.id === activeId) ?? sections[0],
    [activeId]
  );
  const [workflowName, setWorkflowName] = useState("Agent Chat Workflow");
  const [workflowNodes, setWorkflowNodes] = useState<WorkflowNode[]>(
    defaultWorkflow.nodes
  );
  const [workflowEdges, setWorkflowEdges] = useState<WorkflowEdge[]>(
    defaultWorkflow.edges
  );
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [draggingNode, setDraggingNode] = useState<{
    id: string;
    offsetX: number;
    offsetY: number;
  } | null>(null);
  const [saveState, setSaveState] = useState<
    "idle" | "saving" | "saved" | "error"
  >("idle");
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [workflowId, setWorkflowId] = useState<string | null>(null);
  const [workflowList, setWorkflowList] = useState<
    { id: string; name: string }[]
  >([]);
  const [listLoading, setListLoading] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [selectedWorkflowId, setSelectedWorkflowId] = useState<string>("");
  const [zoomLevel, setZoomLevel] = useState(1);
  const [sidebarWidth, setSidebarWidth] = useState(600);
  const [sidebarExpanded, setSidebarExpanded] = useState(true);
  const [resizingSidebar, setResizingSidebar] = useState<{
    startX: number;
    startWidth: number;
  } | null>(null);
  const [rightPanelVisible, setRightPanelVisible] = useState(false);
  const [rightPanelView, setRightPanelView] = useState<"menu" | "node">("menu");
  const [activeCategory, setActiveCategory] = useState<
    "trigger" | "condition" | "action"
  >("action");
  const [linkDrag, setLinkDrag] = useState<{
    fromId: string;
    currentX: number;
    currentY: number;
    targetId: string | null;
  } | null>(null);
  const [selectedEdge, setSelectedEdge] = useState<WorkflowEdge | null>(null);
  const [controlDrag, setControlDrag] = useState<{
    from: string;
    to: string;
  } | null>(null);
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const lastSavedSnapshot = useRef<string>("");
  const dragStartRef = useRef<{ x: number; y: number } | null>(null);
  const dragTriggeredRef = useRef(false);
  const [panOffset, setPanOffset] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const panStartRef = useRef<{
    startX: number;
    startY: number;
    originX: number;
    originY: number;
  } | null>(null);
  const pinchStartRef = useRef<{
    distance: number;
    zoom: number;
  } | null>(null);

  useEffect(() => {
    const snapshot = JSON.stringify({
      name: workflowName,
      nodes: workflowNodes,
      edges: workflowEdges,
    });
    if (saveState === "saved" && snapshot !== lastSavedSnapshot.current) {
      setSaveState("idle");
    }
  }, [workflowName, workflowNodes, workflowEdges, saveState]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!selectedEdge) return;
      if (event.key !== "Delete" && event.key !== "Backspace") return;
      const target = event.target as HTMLElement | null;
      const isEditable =
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA" ||
        target?.isContentEditable;
      if (isEditable) return;
      setWorkflowEdges((prev) =>
        prev.filter(
          (edge) =>
            edge.from !== selectedEdge.from || edge.to !== selectedEdge.to
        )
      );
      setSelectedEdge(null);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selectedEdge]);

  const fetchWorkflowList = async () => {
    setListLoading(true);
    setListError(null);
    try {
      const response = await fetch("/api/agent/workflow");
      const result = await response.json();
      if (!response.ok || !result?.success) {
        throw new Error(result?.error ?? "Failed to load workflows.");
      }
      setWorkflowList(result.data ?? []);
    } catch (error) {
      setListError(
        error instanceof Error ? error.message : "Failed to load workflows."
      );
    } finally {
      setListLoading(false);
    }
  };

  useEffect(() => {
    if (!draggingNode) return;

    const handlePointerMove = (event: PointerEvent) => {
      if (!canvasRef.current) return;
      const rect = canvasRef.current.getBoundingClientRect();
      if (dragStartRef.current) {
        const deltaX = event.clientX - dragStartRef.current.x;
        const deltaY = event.clientY - dragStartRef.current.y;
        if (Math.hypot(deltaX, deltaY) > 4) {
          dragTriggeredRef.current = true;
        }
      }
      const nextX =
        (event.clientX - rect.left - panOffset.x) / zoomLevel -
        draggingNode.offsetX;
      const nextY =
        (event.clientY - rect.top - panOffset.y) / zoomLevel -
        draggingNode.offsetY;
      setWorkflowNodes((prev) =>
        prev.map((node) =>
          node.id === draggingNode.id
            ? { ...node, x: Math.max(20, nextX), y: Math.max(20, nextY) }
            : node
        )
      );
    };

    const handlePointerUp = () => {
      setDraggingNode(null);
      dragStartRef.current = null;
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);

    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
  }, [draggingNode, zoomLevel, panOffset.x, panOffset.y]);

  useEffect(() => {
    if (!isPanning) return;

    const handlePointerMove = (event: PointerEvent) => {
      const start = panStartRef.current;
      if (!start) return;
      setPanOffset({
        x: start.originX + (event.clientX - start.startX),
        y: start.originY + (event.clientY - start.startY),
      });
    };

    const handlePointerUp = () => {
      panStartRef.current = null;
      setIsPanning(false);
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);

    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
  }, [isPanning]);

  useEffect(() => {
    if (!linkDrag) return;

    const handlePointerMove = (event: PointerEvent) => {
      if (!canvasRef.current) return;
      const rect = canvasRef.current.getBoundingClientRect();
      const point = {
        x: (event.clientX - rect.left - panOffset.x) / zoomLevel,
        y: (event.clientY - rect.top - panOffset.y) / zoomLevel,
      };
      let targetId: string | null = null;
      let bestDistance = 9999;
      for (const node of workflowNodes) {
        if (node.id === linkDrag.fromId) continue;
        const targetSize = getNodeSize(node);
        const targetPoint = {
          x: node.x,
          y: node.y + targetSize.height / 2,
        };
        const distance = Math.hypot(
          targetPoint.x - point.x,
          targetPoint.y - point.y
        );
        if (distance < 26 && distance < bestDistance) {
          bestDistance = distance;
          targetId = node.id;
        }
      }
      setLinkDrag((prev) =>
        prev
          ? {
              ...prev,
              currentX: point.x,
              currentY: point.y,
              targetId,
            }
          : null
      );
    };

    const handlePointerUp = () => {
      if (linkDrag.targetId) {
        setWorkflowEdges((prev) => {
          if (
            prev.some(
              (edge) =>
                edge.from === linkDrag.fromId && edge.to === linkDrag.targetId
            )
          ) {
            return prev;
          }
          return [...prev, { from: linkDrag.fromId, to: linkDrag.targetId }];
        });
      }
      setLinkDrag(null);
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);

    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
  }, [linkDrag, zoomLevel, workflowNodes, panOffset.x, panOffset.y]);

  useEffect(() => {
    if (!controlDrag) return;

    const handlePointerMove = (event: PointerEvent) => {
      if (!canvasRef.current) return;
      const rect = canvasRef.current.getBoundingClientRect();
      const point = {
        x: (event.clientX - rect.left - panOffset.x) / zoomLevel,
        y: (event.clientY - rect.top - panOffset.y) / zoomLevel,
      };
      setWorkflowEdges((prev) =>
        prev.map((edge) => {
          if (edge.from !== controlDrag.from || edge.to !== controlDrag.to) {
            return edge;
          }
          const fromNode = workflowNodes.find(
            (node) => node.id === edge.from
          );
          const toNode = workflowNodes.find((node) => node.id === edge.to);
          if (!fromNode || !toNode) return edge;
          const fromSize = getNodeSize(fromNode);
          const toSize = getNodeSize(toNode);
          const startX = fromNode.x + fromSize.width;
          const startY = fromNode.y + fromSize.height / 2;
          const endX = toNode.x;
          const endY = toNode.y + toSize.height / 2;
          const controlX = 2 * point.x - 0.5 * (startX + endX);
          const controlY = 2 * point.y - 0.5 * (startY + endY);
          return { ...edge, controlX, controlY };
        })
      );
    };

    const handlePointerUp = () => {
      setControlDrag(null);
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);

    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
  }, [controlDrag, zoomLevel, workflowNodes, panOffset.x, panOffset.y]);

  useEffect(() => {
    if (!resizingSidebar) return;

    const handlePointerMove = (event: PointerEvent) => {
      const delta = resizingSidebar.startX - event.clientX;
      const nextWidth = Math.min(
        420,
        Math.max(96, resizingSidebar.startWidth + delta)
      );
      setSidebarWidth(nextWidth);
    };

    const handlePointerUp = () => {
      setResizingSidebar(null);
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);

    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
  }, [resizingSidebar]);

  useEffect(() => {
    if (!rightPanelVisible) {
      return;
    }
    if (!sidebarExpanded) {
      setSidebarWidth(140);
    } else if (sidebarWidth < 420) {
      setSidebarWidth(600);
    }
  }, [rightPanelVisible, sidebarExpanded, sidebarWidth]);

  const handleCanvasDrop = (event: DragEvent<HTMLDivElement>): void => {
    event.preventDefault();
    const payload = event.dataTransfer.getData("application/json");
    if (!payload || !canvasRef.current) return;
    const data = JSON.parse(payload) as {
      type: string;
      title: string;
      description: string;
    };
    const rect = canvasRef.current.getBoundingClientRect();
    const x = (event.clientX - rect.left - panOffset.x) / zoomLevel;
    const y = (event.clientY - rect.top - panOffset.y) / zoomLevel;
    setWorkflowNodes((prev) => [
      ...prev,
      createNode(data.type, data.title, data.description, x, y),
    ]);
    setSaveState("idle");
  };

  const handleCanvasDragOver = (event: DragEvent<HTMLDivElement>): void => {
    event.preventDefault();
  };

  const handleCanvasPointerDown = (
    event: React.PointerEvent<HTMLDivElement>
  ) => {
    setSelectedEdge(null);
    setSelectedNodeId(null);
    setControlDrag(null);
    setRightPanelView("menu");
    setRightPanelVisible(false);
    if (event.button !== 0) return;
    const target = event.target as HTMLElement | null;
    if (target?.closest("[data-node='true'], [data-edge='true']")) {
      return;
    }
    panStartRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      originX: panOffset.x,
      originY: panOffset.y,
    };
    setIsPanning(true);
  };

  const handleNodePointerDown = (
    event: PointerEvent<HTMLDivElement>,
    node: WorkflowNode
  ) => {
    if (!canvasRef.current) return;
    event.stopPropagation();
    setSelectedEdge(null);
    const rect = canvasRef.current.getBoundingClientRect();
    setSelectedNodeId(node.id);
    setDraggingNode({
      id: node.id,
      offsetX: (event.clientX - rect.left - panOffset.x) / zoomLevel - node.x,
      offsetY: (event.clientY - rect.top - panOffset.y) / zoomLevel - node.y,
    });
    dragStartRef.current = { x: event.clientX, y: event.clientY };
    dragTriggeredRef.current = false;
  };

  const handleNodeClick = (node: WorkflowNode) => {
    if (dragTriggeredRef.current) {
      dragTriggeredRef.current = false;
      return;
    }
    setSelectedNodeId(node.id);
    setSelectedEdge(null);
    setRightPanelView("node");
    setSidebarExpanded(true);
    setRightPanelVisible(true);
  };

  const handleCategorySelect = (
    category: "trigger" | "condition" | "action"
  ) => {
    setActiveCategory(category);
    setRightPanelView("menu");
    setSidebarExpanded(true);
    setRightPanelVisible(true);
    setSelectedNodeId(null);
  };

  const handleSaveWorkflow = async () => {
    setSaveState("saving");
    setSaveMessage(null);
    try {
      const response = await fetch("/api/agent/workflow", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: workflowId,
          name: workflowName,
          nodes: workflowNodes,
          edges: workflowEdges,
        }),
      });
      const result = await response.json();
      if (!response.ok || !result?.success) {
        throw new Error(result?.error ?? "Failed to save workflow.");
      }
      setWorkflowId(result.data?.id ?? workflowId);
      lastSavedSnapshot.current = JSON.stringify({
        name: workflowName,
        nodes: workflowNodes,
        edges: workflowEdges,
      });
      setSaveState("saved");
      setSaveMessage("Workflow saved to Postgres.");
      fetchWorkflowList();
    } catch (error) {
      setSaveState("error");
      setSaveMessage(
        error instanceof Error ? error.message : "Failed to save workflow."
      );
    }
  };

  const handleLoadWorkflow = async () => {
    if (!selectedWorkflowId) return;
    setSaveMessage(null);
    try {
      const response = await fetch(
        `/api/agent/workflow?id=${encodeURIComponent(selectedWorkflowId)}`
      );
      const result = await response.json();
      if (!response.ok || !result?.success) {
        throw new Error(result?.error ?? "Failed to load workflow.");
      }
      const data = result.data ?? {};
      setWorkflowId(data.id ?? selectedWorkflowId);
      setWorkflowName(data.name ?? "Untitled Workflow");
      setWorkflowNodes(data.definition?.nodes ?? []);
      setWorkflowEdges(data.definition?.edges ?? []);
      setSelectedNodeId(null);
      setLinkDrag(null);
      lastSavedSnapshot.current = JSON.stringify({
        name: data.name ?? "",
        nodes: data.definition?.nodes ?? [],
        edges: data.definition?.edges ?? [],
      });
    } catch (error) {
      setSaveMessage(
        error instanceof Error ? error.message : "Failed to load workflow."
      );
    }
  };

  const selectedNode = workflowNodes.find((node) => node.id === selectedNodeId);
  const workflowMode = activeId === "workflow";
  const zoomPercent = Math.round(zoomLevel * 100);

  useEffect(() => {
    if (!workflowMode) return;
    fetchWorkflowList();
  }, [workflowMode]);


  const handlePinchStart = (event: React.TouchEvent<HTMLDivElement>) => {
    if (event.touches.length !== 2) return;
    const [a, b] = Array.from(event.touches);
    const distance = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
    pinchStartRef.current = { distance, zoom: zoomLevel };
  };

  const handlePinchMove = (event: React.TouchEvent<HTMLDivElement>) => {
    if (event.touches.length !== 2 || !pinchStartRef.current) return;
    event.preventDefault();
    const [a, b] = Array.from(event.touches);
    const distance = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
    const scale = distance / pinchStartRef.current.distance;
    const nextZoom = Math.min(
      5,
      Math.max(0.3, pinchStartRef.current.zoom * scale)
    );
    setZoomLevel(Number(nextZoom.toFixed(2)));
  };

  const handlePinchEnd = () => {
    pinchStartRef.current = null;
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <div className="mx-auto flex min-h-screen max-w-[1400px] flex-col gap-6 px-6 py-8">
        <section
          className="rounded-[32px] overflow-hidden shadow-[0_30px_80px_rgba(5,12,41,0.15)]"
          style={{
            backgroundImage: "url('/agent/agent-banner.jpg')",
            backgroundSize: "cover",
            backgroundPosition: "center 25%",
          }}
        >
          <div className="flex flex-col gap-4 px-6 py-10 backdrop-brightness-75">
            <p className="text-xs uppercase tracking-[0.4em] text-white/70">
              Finyx Agent
            </p>
            <h1 className="text-2xl font-semibold text-white sm:text-3xl">
              AI Agent Operations Console
            </h1>
            <p className="max-w-3xl text-sm text-white/80">
              Manage knowledge, tools, and runtime behavior from a single
              command center.
            </p>
          </div>
        </section>

        <div className="relative flex min-h-[calc(100vh-22rem)] gap-6">
          <aside className="w-64 shrink-0">
            <div className="rounded-2xl border border-slate-200 bg-white px-4 py-5 shadow-sm">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">
                Agent Admin
              </p>
              <nav className="mt-5 flex flex-col gap-2">
                {sections.map((section) => (
                  <button
                    key={section.id}
                    type="button"
                    onClick={() => setActiveId(section.id)}
                    className={`flex items-center justify-between rounded-xl px-4 py-3 text-left text-sm transition ${
                      activeId === section.id
                        ? "bg-slate-900 text-white shadow-sm"
                        : "text-slate-700 hover:bg-slate-100"
                    }`}
                  >
                    <span className="font-medium">{section.label}</span>
                    <span className="text-xs opacity-70">↗</span>
                  </button>
                ))}
              </nav>
              <div className="mt-6 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-500">
                Future tools and admin panels can be added here.
              </div>
            </div>
          </aside>

          <main className="relative flex-1">
            {workflowMode ? (
              <div className="rounded-3xl border border-slate-200 bg-white px-8 py-8 shadow-sm">
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <div className="flex flex-col gap-3">
                    <span className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-400">
                      Workflow
                    </span>
                    <div className="flex flex-wrap items-center gap-3">
                      <input
                        value={workflowName}
                        onChange={(event) => setWorkflowName(event.target.value)}
                        className="w-[260px] rounded-xl border border-slate-200 bg-slate-50 px-4 py-2 text-sm font-semibold text-slate-900 shadow-sm focus:border-slate-400 focus:outline-none"
                      />
                      <select
                        value={selectedWorkflowId}
                        onChange={(event) =>
                          setSelectedWorkflowId(event.target.value)
                        }
                        className="w-[200px] rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600"
                      >
                        <option value="">Load workflow...</option>
                        {workflowList.map((item) => (
                          <option key={item.id} value={item.id}>
                            {item.name}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        onClick={handleLoadWorkflow}
                        className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-600 transition hover:border-slate-400"
                      >
                        Load
                      </button>
                      <button
                        type="button"
                        onClick={handleSaveWorkflow}
                        className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800"
                      >
                        Save workflow
                      </button>
                      <span className="text-xs text-slate-500">
                        {saveState === "saving" && "Saving..."}
                        {saveState === "saved" && "Saved"}
                        {saveState === "error" && "Save failed"}
                      </span>
                      <div className="flex items-center gap-2 rounded-full border border-slate-200 bg-white px-2 py-1 text-xs text-slate-500">
                        <button
                          type="button"
                          className="rounded-full px-2 py-1 text-xs text-slate-500 hover:bg-slate-100"
                          onClick={() =>
                            setZoomLevel((prev) =>
                              Math.max(0.5, Number((prev - 0.1).toFixed(2)))
                            )
                          }
                        >
                          -
                        </button>
                        <span className="min-w-[56px] text-center">
                          {zoomPercent}%
                        </span>
                        <button
                          type="button"
                          className="rounded-full px-2 py-1 text-xs text-slate-500 hover:bg-slate-100"
                          onClick={() =>
                            setZoomLevel((prev) =>
                              Math.min(5, Number((prev + 0.1).toFixed(2)))
                            )
                          }
                        >
                          +
                        </button>
                        <button
                          type="button"
                          className="rounded-full px-2 py-1 text-xs text-slate-500 hover:bg-slate-100"
                          onClick={() => setZoomLevel(1)}
                        >
                          100
                        </button>
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500">
                      {listLoading ? <span>Loading list...</span> : null}
                      {listError ? <span>{listError}</span> : null}
                    </div>
                    {saveMessage ? (
                      <p className="text-xs text-slate-500">{saveMessage}</p>
                    ) : null}
                  </div>
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-500">
                    Drag blocks from the right panel to build the flow.
                  </div>
                </div>

                <div
                  ref={canvasRef}
                  onDrop={handleCanvasDrop}
                  onDragOver={handleCanvasDragOver}
                  onPointerDown={handleCanvasPointerDown}
                  onWheel={(event) => {
                    if (!event.ctrlKey && !event.metaKey) return;
                    event.preventDefault();
                    const delta = event.deltaY > 0 ? -0.06 : 0.06;
                    setZoomLevel((prev) =>
                      Math.min(5, Math.max(0.3, Number((prev + delta).toFixed(2))))
                    );
                  }}
                  onTouchStart={handlePinchStart}
                  onTouchMove={handlePinchMove}
                  onTouchEnd={handlePinchEnd}
                  onTouchCancel={handlePinchEnd}
                  className="relative mt-6 h-[520px] overflow-hidden rounded-2xl border border-slate-200 bg-gradient-to-br from-slate-50 via-white to-slate-100"
                  style={{
                    backgroundImage:
                      "radial-gradient(circle at 1px 1px, rgba(148,163,184,0.3) 1px, transparent 0)",
                    backgroundSize: "24px 24px",
                  }}
                >
                  <div
                    className="absolute inset-0 origin-top-left"
                    style={{
                      transform: `translate(${panOffset.x}px, ${panOffset.y}px) scale(${zoomLevel})`,
                    }}
                  >
                    <svg
                      className="absolute inset-0"
                      width="100%"
                      height="100%"
                      aria-hidden="true"
                    >
                      <defs>
                        <marker
                          id="arrowhead"
                          markerWidth="10"
                          markerHeight="7"
                          refX="9"
                          refY="3.5"
                          orient="auto"
                        >
                          <polygon points="0 0, 10 3.5, 0 7" fill="#94a3b8" />
                        </marker>
                      </defs>
                      {workflowEdges.map((edge) => {
                        const fromNode = workflowNodes.find(
                          (node) => node.id === edge.from
                        );
                        const toNode = workflowNodes.find(
                          (node) => node.id === edge.to
                        );
                        if (!fromNode || !toNode) return null;
                        const fromSize = getNodeSize(fromNode);
                        const toSize = getNodeSize(toNode);
                        const startX = fromNode.x + fromSize.width;
                        const startY = fromNode.y + fromSize.height / 2;
                        const endX = toNode.x;
                        const endY = toNode.y + toSize.height / 2;
                        const bend = Math.max(60, Math.abs(endX - startX) * 0.4);
                        const defaultControlX =
                          (startX + endX) / 2 +
                          (endX >= startX ? 1 : -1) * (bend / 2);
                        const defaultControlY = (startY + endY) / 2;
                        const isSelected =
                          selectedEdge?.from === edge.from &&
                          selectedEdge?.to === edge.to;
                        const controlX = edge.controlX ?? defaultControlX;
                        const controlY = edge.controlY ?? defaultControlY;
                        const path = `M ${startX} ${startY} Q ${controlX} ${controlY} ${endX} ${endY}`;
                        const handleX =
                          0.25 * startX + 0.5 * controlX + 0.25 * endX;
                        const handleY =
                          0.25 * startY + 0.5 * controlY + 0.25 * endY;
                        return (
                          <g key={`${edge.from}-${edge.to}`}>
                            <path
                              d={path}
                              stroke={isSelected ? "#0f172a" : "#94a3b8"}
                              strokeWidth="2"
                              fill="none"
                              markerEnd="url(#arrowhead)"
                              className="cursor-pointer transition hover:stroke-slate-500"
                              data-edge="true"
                              onPointerDown={(event) => {
                                event.stopPropagation();
                              }}
                              onClick={(event) => {
                                event.stopPropagation();
                                setSelectedEdge({ from: edge.from, to: edge.to });
                              }}
                            />
                            {isSelected ? (
                              <circle
                                cx={handleX}
                                cy={handleY}
                                r="5"
                                fill="#ffffff"
                                stroke="#0f172a"
                                strokeWidth="2"
                                className="cursor-grab"
                                data-edge="true"
                                onPointerDown={(event) => {
                                  event.stopPropagation();
                                  event.preventDefault();
                                  setSelectedEdge({
                                    from: edge.from,
                                    to: edge.to,
                                  });
                                  setControlDrag({
                                    from: edge.from,
                                    to: edge.to,
                                  });
                                }}
                              />
                            ) : null}
                          </g>
                        );
                      })}
                      {linkDrag ? (() => {
                        const fromNode = workflowNodes.find(
                          (node) => node.id === linkDrag.fromId
                        );
                        if (!fromNode) return null;
                        const fromSize = getNodeSize(fromNode);
                        const startX = fromNode.x + fromSize.width;
                        const startY = fromNode.y + fromSize.height / 2;
                        let endX = linkDrag.currentX;
                        let endY = linkDrag.currentY;
                        if (linkDrag.targetId) {
                          const targetNode = workflowNodes.find(
                            (node) => node.id === linkDrag.targetId
                          );
                          if (targetNode) {
                            endX = targetNode.x;
                            const targetSize = getNodeSize(targetNode);
                            endY = targetNode.y + targetSize.height / 2;
                          }
                        }
                        const bend = Math.max(60, Math.abs(endX - startX) * 0.4);
                        const controlX =
                          (startX + endX) / 2 +
                          (endX >= startX ? 1 : -1) * (bend / 2);
                        const controlY = (startY + endY) / 2;
                        const path = `M ${startX} ${startY} Q ${controlX} ${controlY} ${endX} ${endY}`;
                        return (
                          <path
                            d={path}
                            stroke="#cbd5f5"
                            strokeWidth="2"
                            fill="none"
                            markerEnd="url(#arrowhead)"
                          />
                        );
                      })() : null}
                    </svg>
                    {workflowNodes.map((node) => {
                      const isDecision = node.type === "branch";
                      const size = getNodeSize(node);
                      const theme = getNodeTheme(node);
                      const baseClasses = `absolute cursor-grab border text-sm shadow-sm transition ${
                        selectedNodeId === node.id
                          ? "border-slate-900 shadow-[0_16px_40px_rgba(15,23,42,0.18)]"
                          : "hover:border-slate-400"
                      }`;
                      const paddingClasses = isDecision ? "px-3 py-2" : "px-4 py-3";
                      return (
                        <div
                          key={node.id}
                          data-node="true"
                          role="button"
                          tabIndex={0}
                          onPointerDown={(event) => handleNodePointerDown(event, node)}
                          onClick={() => handleNodeClick(node)}
                          className={`${baseClasses} ${paddingClasses} ${
                            isDecision ? "" : "rounded-2xl"
                          }`}
                          style={{
                            left: node.x,
                            top: node.y,
                            width: size.width,
                            minHeight: size.height,
                            clipPath: isDecision
                              ? "polygon(12% 0%, 88% 0%, 100% 50%, 88% 100%, 12% 100%, 0% 50%)"
                              : undefined,
                            background: theme.background,
                            borderColor: theme.borderColor,
                            boxShadow: theme.boxShadow,
                            color: theme.color,
                            backgroundClip: isDecision ? "padding-box" : undefined,
                          }}
                        >
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              setWorkflowNodes((prev) =>
                                prev.filter((item) => item.id !== node.id)
                              );
                              setWorkflowEdges((prev) =>
                                prev.filter(
                                  (edge) => edge.from !== node.id && edge.to !== node.id
                                )
                              );
                              if (selectedNodeId === node.id) {
                                setSelectedNodeId(null);
                              }
                              if (
                                selectedEdge?.from === node.id ||
                                selectedEdge?.to === node.id
                              ) {
                                setSelectedEdge(null);
                              }
                            }}
                            className="absolute -right-2 -top-2 flex h-6 w-6 items-center justify-center rounded-full bg-red-500 text-xs font-bold text-white shadow-sm"
                          >
                            X
                          </button>
                          <div
                            className={`absolute -left-2 top-1/2 h-3 w-3 -translate-y-1/2 rounded-full border shadow-sm transition ${
                              linkDrag?.targetId === node.id
                                ? "border-emerald-500 bg-emerald-400"
                                : "border-slate-300 bg-white"
                            }`}
                            aria-hidden="true"
                          />
                          <button
                            type="button"
                            onPointerDown={(event) => {
                              event.stopPropagation();
                              event.preventDefault();
                              setSelectedNodeId(node.id);
                              setSelectedEdge(null);
                              setControlDrag(null);
                              setLinkDrag({
                                fromId: node.id,
                                currentX: node.x + getNodeSize(node).width,
                                currentY: node.y + getNodeSize(node).height / 2,
                                targetId: null,
                              });
                            }}
                            className="absolute -right-2 top-1/2 flex h-4 w-4 -translate-y-1/2 items-center justify-center rounded-full border border-slate-400 bg-slate-900 shadow-sm"
                            aria-label="Drag to connect"
                          />
                          <div className={`flex items-center justify-between ${isDecision ? "text-center" : ""}`}>
                            <span className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">
                              {node.type}
                            </span>
                            <span className="text-xs text-slate-400">↔</span>
                          </div>
                          <p className={`mt-2 text-sm font-semibold ${isDecision ? "text-center" : ""}`}>
                            {node.title}
                          </p>
                          <p className={`mt-1 text-xs text-slate-500 ${isDecision ? "text-center" : ""}`}>
                            {nodeDescriptionZh[node.type] ?? node.description}
                          </p>
                        </div>
                      );
                    })}
                  </div>
                  <div className="pointer-events-none absolute bottom-6 left-1/2 z-10 -translate-x-1/2">
                    <div className="pointer-events-auto flex items-center gap-3 rounded-full border border-slate-200 bg-white/90 px-4 py-3 shadow-lg backdrop-blur">
                      <button
                        type="button"
                        onClick={() => handleCategorySelect("trigger")}
                        className={`flex items-center gap-2 rounded-full px-4 py-2 text-xs font-semibold transition ${
                          activeCategory === "trigger" && rightPanelView === "menu"
                            ? "bg-slate-900 text-white"
                            : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                        }`}
                      >
                        <img
                          src="/agent/nodes/trigger.svg"
                          alt=""
                          className="h-4 w-4"
                        />
                        触发
                      </button>
                      <button
                        type="button"
                        onClick={() => handleCategorySelect("condition")}
                        className={`flex items-center gap-2 rounded-full px-4 py-2 text-xs font-semibold transition ${
                          activeCategory === "condition" && rightPanelView === "menu"
                            ? "bg-slate-900 text-white"
                            : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                        }`}
                      >
                        <img
                          src="/agent/nodes/condition.svg"
                          alt=""
                          className="h-4 w-4"
                        />
                        条件
                      </button>
                      <button
                        type="button"
                        onClick={() => handleCategorySelect("action")}
                        className={`flex items-center gap-2 rounded-full px-4 py-2 text-xs font-semibold transition ${
                          activeCategory === "action" && rightPanelView === "menu"
                            ? "bg-slate-900 text-white"
                            : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                        }`}
                      >
                        <img
                          src="/agent/nodes/action.svg"
                          alt=""
                          className="h-4 w-4"
                        />
                        动作
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="rounded-3xl border border-slate-200 bg-white px-10 py-10 shadow-sm">
                <div className="flex flex-col gap-4">
                  <span className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-400">
                    {activeSection?.label}
                  </span>
                  <h1 className="text-3xl font-semibold text-slate-900">
                    {activeSection?.title}
                  </h1>
                  <p className="text-base text-slate-600">
                    {activeSection?.description}
                  </p>
                </div>
                <div className="mt-8 grid gap-4 md:grid-cols-2">
                  {activeSection?.bullets.map((item) => (
                    <div
                      key={item}
                      className="rounded-2xl border border-slate-200 bg-slate-50 px-5 py-4 text-sm text-slate-600"
                    >
                      {item}
                    </div>
                  ))}
                </div>
                <div className="mt-10 rounded-2xl border border-dashed border-slate-200 px-6 py-5 text-sm text-slate-500">
                  This space is reserved for future management tooling. Connect
                  metrics, ingestion logs, and audit trails here.
                </div>
              </div>
            )}
          </main>

          {workflowMode ? (
            <>
              <div
                className="absolute inset-0 z-10 transition-opacity duration-300"
                style={{
                  opacity: rightPanelVisible ? 1 : 0,
                  pointerEvents: "none",
                }}
              >
                <div className="h-full w-full bg-slate-950/20" />
              </div>
              <aside
                className="absolute right-0 top-0 z-20 transition-all duration-300"
                style={{
                  width: sidebarWidth,
                  transform: rightPanelVisible
                    ? "translateX(0)"
                    : "translateX(110%)",
                  opacity: rightPanelVisible ? 1 : 0,
                  visibility: rightPanelVisible ? "visible" : "hidden",
                  pointerEvents: rightPanelVisible ? "auto" : "none",
                }}
              >
              <div
                role="separator"
                aria-orientation="vertical"
                onPointerDown={(event) =>
                  setResizingSidebar({
                    startX: event.clientX,
                    startWidth: sidebarWidth,
                  })
                }
                className="absolute -left-1 top-0 h-full w-2 cursor-col-resize"
              />
                <div className="sticky top-6 flex h-[calc(100vh-16rem)] flex-col gap-4 overflow-hidden">
                  <div className="flex min-h-0 flex-1 flex-col rounded-2xl border border-slate-200 bg-white px-3 py-4 shadow-sm">
                  <div className="flex items-center justify-between px-2">
                    <div className="flex items-center gap-2 text-xs font-semibold">
                      {["trigger", "condition", "action"].map((item) => (
                        <button
                          key={item}
                          type="button"
                          onClick={() =>
                            handleCategorySelect(
                              item as "trigger" | "condition" | "action"
                            )
                          }
                          className={`flex items-center gap-2 rounded-full px-3 py-1 transition ${
                            activeCategory === item && rightPanelView === "menu"
                              ? "bg-slate-900 text-white"
                              : "text-slate-500 hover:bg-slate-100"
                          }`}
                        >
                          {item === "trigger" ? (
                            <img
                              src="/agent/nodes/trigger.svg"
                              alt=""
                              className="h-4 w-4"
                            />
                          ) : null}
                          {item === "condition" ? (
                            <img
                              src="/agent/nodes/condition.svg"
                              alt=""
                              className="h-4 w-4"
                            />
                          ) : null}
                          {item === "action" ? (
                            <img
                              src="/agent/nodes/action.svg"
                              alt=""
                              className="h-4 w-4"
                            />
                          ) : null}
                          {item === "trigger" && "触发器"}
                          {item === "condition" && "条件器"}
                          {item === "action" && "动作器"}
                        </button>
                      ))}
                    </div>
                    <span className="text-[10px] uppercase tracking-[0.2em] text-slate-400">
                      {rightPanelView === "node" ? "编辑" : "菜单"}
                    </span>
                  </div>

                    <div className="mt-4 grid min-h-0 flex-1 grid-cols-2 gap-3 overflow-y-auto pr-1">
                    {rightPanelView === "node" && selectedNode ? (
                      <div className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 text-sm text-slate-600">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">
                            节点编辑
                          </span>
                          <span className="text-xs text-slate-400">
                            {selectedNode.type}
                          </span>
                        </div>
                        <input
                          value={selectedNode.title}
                          onChange={(event) =>
                            setWorkflowNodes((prev) =>
                              prev.map((node) =>
                                node.id === selectedNode.id
                                  ? { ...node, title: event.target.value }
                                  : node
                              )
                            )
                          }
                          className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:border-slate-400 focus:outline-none"
                          placeholder="节点标题"
                        />
                        <textarea
                          value={selectedNode.description}
                          onChange={(event) =>
                            setWorkflowNodes((prev) =>
                              prev.map((node) =>
                                node.id === selectedNode.id
                                  ? {
                                      ...node,
                                      description: event.target.value,
                                    }
                                  : node
                              )
                            )
                          }
                          className="min-h-[90px] rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:border-slate-400 focus:outline-none"
                          placeholder="节点说明"
                        />
                        <button
                          type="button"
                          onClick={() => {
                            setWorkflowNodes((prev) =>
                              prev.filter((node) => node.id !== selectedNode.id)
                            );
                            setWorkflowEdges((prev) =>
                              prev.filter(
                                (edge) =>
                                  edge.from !== selectedNode.id &&
                                  edge.to !== selectedNode.id
                              )
                            );
                            setSelectedNodeId(null);
                          }}
                          className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-red-500 transition hover:border-red-200"
                        >
                          删除节点
                        </button>
                        <p className="text-xs text-slate-400">
                          拖拽锚点连线，点击连线选中后可用 Delete/Backspace 删除。
                        </p>
                      </div>
                    ) : activeCategory === "action" ? (
                      workflowBlocks.map((block) => (
                        <div
                          key={block.type}
                          draggable
                          onDragStart={(event) => {
                            event.dataTransfer.setData(
                              "application/json",
                              JSON.stringify(block)
                            );
                            event.dataTransfer.effectAllowed = "copy";
                          }}
                          className="cursor-grab rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm text-slate-700 shadow-sm transition hover:border-slate-400"
                        >
                          <p className="text-sm font-semibold">{block.title}</p>
                          {sidebarExpanded ? (
                            <p className="mt-1 text-xs text-slate-500">
                              {block.description}
                            </p>
                          ) : null}
                        </div>
                      ))
                    ) : (
                      <div className="col-span-2 rounded-2xl border border-dashed border-slate-200 bg-white px-4 py-6 text-xs text-slate-400">
                        {activeCategory === "trigger"
                          ? "暂无触发器组件。"
                          : "暂无条件组件。"}
                      </div>
                    )}
                  </div>
                  </div>
                </div>
              </aside>
            </>
          ) : (
            <aside className="w-[420px] shrink-0">
              <div className="sticky top-6 h-[calc(100vh-16rem)]">
                <AgentChatWidget variant="panel" defaultOpen />
              </div>
            </aside>
          )}
        </div>
      </div>
      <style jsx global>{`
        body {
          overflow-x: hidden;
        }
      `}</style>
    </div>
  );
}
