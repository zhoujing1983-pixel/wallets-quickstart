import path from "node:path";
import { MCPConfiguration } from "@voltagent/core";

const DEFAULT_LOCAL_COMMAND = path.join(
  process.cwd(),
  "node_modules",
  ".bin",
  "pageindex-mcp"
);
const DEFAULT_LOCAL_PACKAGE = "pageindex-mcp";
const DEFAULT_REMOTE_URL = "https://mcp.pageindex.ai/mcp";

const getEnvValue = (value?: string) =>
  value && value.trim().length > 0 ? value.trim() : undefined;

const parseCommaArgs = (value?: string) => {
  if (!value) return undefined;
  const items = value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  return items.length > 0 ? items : undefined;
};

const parseHeaders = (value?: string) => {
  if (!value) return undefined;
  try {
    const headers = JSON.parse(value) as Record<string, string>;
    return headers;
  } catch {
    return undefined;
  }
};

const buildPageIndexServerConfig = () => {
  const mode = (getEnvValue(process.env.PAGEINDEX_MCP_MODE) ?? "local").toLowerCase();
  if (
    mode === "http" ||
    mode === "remote" ||
    mode === "sse" ||
    mode === "streamable-http"
  ) {
    const url =
      getEnvValue(process.env.PAGEINDEX_MCP_URL) ?? DEFAULT_REMOTE_URL;
    const headers = parseHeaders(
      getEnvValue(process.env.PAGEINDEX_MCP_HEADERS_JSON)
    );
    const requestInit = headers ? { headers } : undefined;
    const type = mode === "remote" ? "http" : mode;
    return {
      type,
      url,
      requestInit,
    } as const;
  }
  const command =
    getEnvValue(process.env.PAGEINDEX_MCP_COMMAND) ?? DEFAULT_LOCAL_COMMAND;
  const envArgs = parseCommaArgs(getEnvValue(process.env.PAGEINDEX_MCP_ARGS));
  const packageName =
    getEnvValue(process.env.PAGEINDEX_MCP_PACKAGE) ?? DEFAULT_LOCAL_PACKAGE;
  const args =
    envArgs ??
    (command === "npx" || command.endsWith(`${path.sep}npx`)
      ? ["-y", packageName]
      : undefined);
  return {
    type: "stdio",
    command,
    args,
    cwd: process.cwd(),
  } as const;
};

const pageIndexMcp = new MCPConfiguration({
  servers: {
    pageindex: buildPageIndexServerConfig(),
  },
});

export const getPageIndexTools = async () => pageIndexMcp.getTools();

export const callPageIndexTool = async (
  name: string,
  args: Record<string, unknown>,
) => {
  const client = await pageIndexMcp.getClient("pageindex");
  if (!client) {
    throw new Error("PageIndex MCP client not available.");
  }
  return client.callTool({ name, arguments: args });
};
