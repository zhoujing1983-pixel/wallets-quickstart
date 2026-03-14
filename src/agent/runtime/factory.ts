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
export const runtime = framework === "langchain"
  ? createLangChainRuntime()
  : createVoltagentRuntime();

// 供 API 返回当前运行框架，便于前端/运维确认生效配置。
export const currentAgentFramework = framework;
