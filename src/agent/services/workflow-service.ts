import { randomUUID } from "crypto";
import { workflowDao } from "@/agent/dao/workflow-dao";

export type WorkflowDefinition = {
  nodes: unknown[];
  edges: unknown[];
  meta?: Record<string, unknown>;
};

export type WorkflowInput = {
  id?: string;
  name?: string;
  nodes?: unknown[];
  edges?: unknown[];
};

export const workflowService = {
  async saveWorkflow(input: WorkflowInput) {
    const name =
      typeof input.name === "string" && input.name.trim()
        ? input.name.trim()
        : "Untitled Workflow";
    const workflowId =
      typeof input.id === "string" && input.id.trim()
        ? input.id.trim()
        : randomUUID();
    const definition: WorkflowDefinition = {
      nodes: Array.isArray(input.nodes) ? input.nodes : [],
      edges: Array.isArray(input.edges) ? input.edges : [],
      meta: {
        source: "agent-workflow-builder",
      },
    };
    await workflowDao.upsert(workflowId, name, definition);
    return { id: workflowId };
  },

  async getWorkflow(id: string) {
    const workflowId = id.trim();
    if (!workflowId) return null;
    return workflowDao.getById(workflowId);
  },

  async listWorkflows(limit?: number) {
    return workflowDao.list(limit);
  },
};
