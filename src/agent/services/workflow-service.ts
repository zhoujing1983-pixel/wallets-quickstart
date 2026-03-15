/*
 * 文件作用：服务层封装：对外提供 workflow 相关服务接口，桥接路由层与数据/执行层。
 * 调用链阶段：服务封装阶段（领域服务对外提供）
 * 调用链关系：上游：业务层调用 workflowService.execute()/register()；下游：src/agent/dao/workflow-dao.ts::workflowDao.*。
 * 维护说明：新增/修改本文件时，应保持输入输出契约稳定，避免破坏上游调用方与下游被调方的方法签名。
 */
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