/*
 * 文件作用：运行时工厂：按配置选择 LangChain 或 VoltAgent 实现，向上层暴露统一 runtime 接口。
 * 调用链阶段：运行时决策阶段（框架选择与契约约束）
 * 调用链关系：上游：src/agent/routing/route-service.ts::executeWorkflow()；下游：src/agent/runtime/langchain-provider.ts::createLangChainRuntime()、src/agent/runtime/voltagent-provider.ts::createVoltagentRuntime()。
 * 维护说明：新增/修改本文件时，应保持输入输出契约稳定，避免破坏上游调用方与下游被调方的方法签名。
 */
import { resolveAgentFramework } from "@/agent/runtime/config";
import { createVoltagentRuntime } from "@/agent/runtime/voltagent-provider";
import { createLangChainRuntime } from "@/agent/runtime/langchain-provider";

// 进程级别只解析一次框架配置，避免每次请求重复判断。
const framework = resolveAgentFramework();

/**
 * 统一运行时实例：
 * - langchain: 通过 LangChain server HTTP 执行 workflow；
 * - voltagent: 通过 VoltAgent server HTTP 执行 workflow。
 */
export const runtime =
  framework === "langchain"
    ? createLangChainRuntime()
    : createVoltagentRuntime();

// 供 API 返回当前运行框架，便于前端/运维确认生效配置。
export const currentAgentFramework = framework;