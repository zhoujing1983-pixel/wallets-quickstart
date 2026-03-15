import "dotenv/config";
import { createServer } from "node:http";
import { URL } from "node:url";
import {
  executeLangChainWorkflow,
  executeLangChainWorkflowStream,
} from "@/agent/runtime/langchain-executor";
import type { WorkflowPayload } from "@/agent/runtime/types";

// LangChain 独立服务监听端口，默认 3142。
const port = Number(process.env.LANGCHAIN_SERVER_PORT ?? "3142");

/**
 * 返回 JSON 响应的统一工具函数。
 * @param res Node ServerResponse
 * @param status HTTP 状态码
 * @param payload 要输出的 JSON 内容
 */
const writeJson = (
  res: import("node:http").ServerResponse,
  status: number,
  payload: unknown
) => {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload));
};

const writeSseHeaders = (res: import("node:http").ServerResponse) => {
  res.statusCode = 200;
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
};

const writeSseEvent = (
  res: import("node:http").ServerResponse,
  event: string,
  payload: unknown
) => {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
};

/**
 * 读取并解析请求体。
 * - 仅处理 JSON；
 * - 空请求体会返回空对象，避免 JSON.parse 抛错。
 */
const readBody = async (req: import("node:http").IncomingMessage) => {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
};

/**
 * LangChain workflow HTTP 服务：
 * - GET /health: 健康检查；
 * - POST /workflows/:workflowId/execute: 执行指定工作流；
 * - POST /workflows/:workflowId/execute/stream: 以 SSE 方式流式执行工作流。
 */
const server = createServer(async (req, res) => {
  try {
    const method = (req.method ?? "GET").toUpperCase();
    const requestUrl = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    if (method === "GET" && requestUrl.pathname === "/health") {
      writeJson(res, 200, { ok: true, framework: "langchain" });
      return;
    }

    const workflowMatch = requestUrl.pathname.match(
      /^\/workflows\/([^/]+)\/execute$/
    );
    if (method === "POST" && workflowMatch) {
      const workflowId = decodeURIComponent(workflowMatch[1]);
      const payload = (await readBody(req)) as WorkflowPayload;
      const result = await executeLangChainWorkflow(workflowId, payload);
      writeJson(res, 200, result);
      return;
    }

    const workflowStreamMatch = requestUrl.pathname.match(
      /^\/workflows\/([^/]+)\/execute\/stream$/
    );
    if (method === "POST" && workflowStreamMatch) {
      const workflowId = decodeURIComponent(workflowStreamMatch[1]);
      const payload = (await readBody(req)) as WorkflowPayload;
      writeSseHeaders(res);
      try {
        await executeLangChainWorkflowStream(
          workflowId,
          payload,
          (event) => {
            if (event.type === "tool_progress") {
              writeSseEvent(res, "tool_progress", event.data);
              return;
            }
            if (event.type === "text_delta") {
              writeSseEvent(res, "text_delta", { delta: event.delta });
              return;
            }
            if (event.type === "final") {
              writeSseEvent(res, "final", { result: event.result });
            }
          }
        );
        writeSseEvent(res, "done", { ok: true });
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "LangChain stream error.";
        writeSseEvent(res, "error", { error: message });
      } finally {
        res.end();
      }
      return;
    }

    writeJson(res, 404, { success: false, error: "Not found." });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "LangChain server error.";
    writeJson(res, 500, { success: false, error: message });
  }
});

/**
 * 启动服务并输出监听地址。
 */
server.listen(port, () => {
  console.log(`[langchain-server] listening on http://localhost:${port}`);
});
