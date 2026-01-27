import { matchKeywordRoute } from "@/agent/routing/route-selector";
import { formatReturnWorkflowResult } from "@/agent/routing/formatters/return-workflow";
import { formatFlightWorkflowResult } from "@/agent/routing/formatters/flight-workflow";

type ChatOptions = {
  needRag?: boolean;
  useLlmSummary?: boolean;
  userId?: string;
  conversationId?: string;
  enableThinking?: boolean;
};

type RouteServiceInput = {
  input: string;
  options?: ChatOptions;
  headerEnableThinking?: boolean;
};

type WorkflowPayload = {
  input: {
    query: string;
    options: {
      needRag: boolean;
      useLlmSummary?: boolean;
      userId?: string;
      conversationId?: string;
      enableThinking?: boolean;
    };
  };
  options: {
    userId?: string;
    conversationId?: string;
  };
};

type WorkflowResponse = {
  success?: boolean;
  error?: string;
  data?: {
    result?: unknown;
  };
};

const logRouting = (message: string, meta?: Record<string, unknown>) => {
  if (meta) {
    console.log(`[routing] ${message}`, meta);
  } else {
    console.log(`[routing] ${message}`);
  }
};

const buildWorkflowInput = (
  input: string,
  options: ChatOptions | undefined,
  headerEnableThinking: boolean | undefined
): WorkflowPayload => {
  const envNeedRag =
    (process.env.NEED_RAG ?? "true").toLowerCase() !== "false";
  const needRag =
    typeof options?.needRag === "boolean" ? options.needRag : envNeedRag;
  const useLlmSummary =
    typeof options?.useLlmSummary === "boolean"
      ? options.useLlmSummary
      : undefined;
  const userId = typeof options?.userId === "string" ? options.userId : undefined;
  const conversationId =
    typeof options?.conversationId === "string"
      ? options.conversationId
      : undefined;
  const enableThinking =
    typeof options?.enableThinking === "boolean"
      ? options.enableThinking
      : headerEnableThinking;

  return {
    input: {
      query: input,
      options: {
        needRag,
        useLlmSummary,
        userId,
        conversationId,
        enableThinking,
      },
    },
    options: {
      userId,
      conversationId,
    },
  };
};

const executeWorkflow = async (
  workflowId: string,
  payload: WorkflowPayload
): Promise<WorkflowResponse> => {
  const start = Date.now();
  const res = await fetch(
    `http://localhost:3141/workflows/${workflowId}/execute`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }
  );
  const data = (await res.json()) as WorkflowResponse;
  if (!res.ok || !data?.success) {
    const message = data?.error || "Workflow request failed.";
    logRouting("workflow failed", {
      workflowId,
      status: res.status,
      durationMs: Date.now() - start,
      error: message,
    });
    throw new Error(message);
  }
  logRouting("workflow success", {
    workflowId,
    status: res.status,
    durationMs: Date.now() - start,
  });
  return data;
};

const resolveWorkflowId = async (
  input: string,
  payload: WorkflowPayload
): Promise<string> => {
  const start = Date.now();
  const keywordDecision = matchKeywordRoute(input);
  if (keywordDecision?.workflowId) {
    logRouting("keyword matched", {
      workflowId: keywordDecision.workflowId,
      reason: keywordDecision.reason,
      durationMs: Date.now() - start,
    });
    return keywordDecision.workflowId;
  }

  try {
    const routingRes = await executeWorkflow("routing-workflow", payload);
    const routingResult = routingRes?.data?.result as {
      workflowId?: string;
    };
    if (routingResult && typeof routingResult.workflowId === "string") {
      logRouting("model matched", {
        workflowId: routingResult.workflowId,
        durationMs: Date.now() - start,
      });
      return routingResult.workflowId;
    }
  } catch (error) {
    logRouting("model fallback failed", {
      durationMs: Date.now() - start,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  logRouting("fallback to local-rag-workflow", {
    durationMs: Date.now() - start,
  });
  return "local-rag-workflow";
};

export const routeAgentChat = async ({
  input,
  options,
  headerEnableThinking,
}: RouteServiceInput) => {
  const start = Date.now();
  const payload = buildWorkflowInput(input, options, headerEnableThinking);
  const workflowId = await resolveWorkflowId(input, payload);
  logRouting("executing workflow", { workflowId });
  const workflowRes = await executeWorkflow(workflowId, payload);
  logRouting("workflow raw response", { workflowId, workflowRes });
  const result = workflowRes?.data?.result;

  if (!result || typeof result !== "object") {
    logRouting("workflow result missing", { workflowId });
    throw new Error("Workflow result missing.");
  }

  if (workflowId === "return-request-workflow") {
    const formatted = formatReturnWorkflowResult(result as any);
    logRouting("response formatted", {
      workflowId,
      durationMs: Date.now() - start,
    });
    return formatted;
  }
  if (workflowId === "flight-booking-workflow") {
    const formatted = formatFlightWorkflowResult(result as any);
    logRouting("response formatted", {
      workflowId,
      durationMs: Date.now() - start,
    });
    return formatted;
  }

  const sources = Array.isArray((result as any).sources)
    ? (result as any).sources
    : [];
  const snippets = Array.isArray((result as any).snippets)
    ? (result as any).snippets
    : [];
  const baseText =
    typeof (result as any).text === "string" ? (result as any).text : "";
  const response = {
    text: baseText,
    sources,
    snippets,
  };
  logRouting("response ready", {
    workflowId,
    durationMs: Date.now() - start,
  });
  return response;
};
