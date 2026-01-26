import { VoltAgent } from "@voltagent/core";
import { honoServer } from "@voltagent/server-hono";
import { agent, workflows } from "@/agent/engine/voltagent-engine";

/*
 * VoltAgent 服务端入口：
 * - 只负责把 Engine 中的 agent 与 workflow 注册到服务端；
 * - 具体模型、工具、workflow 定义都在 Engine 文件中维护。
 */
new VoltAgent({
  agents: { localAgent: agent },
  workflows,
  server: honoServer({
    port: 3141,
    enableSwaggerUI: true,
  }),
});

/*
 * 可选的启动后提示：
 * - 通过 VOLTAGENT_SERVER_PROMPT 触发一次初始化对话；
 * - 仅用于预热或快速验证服务是否可用。
 */
const serverPrompt = process.env.VOLTAGENT_SERVER_PROMPT?.trim();
if (serverPrompt) {
  void (async () => {
    try {
      await agent.generateText(serverPrompt);
    } catch (error) {
      console.error("[server:prompt] failed", error);
    }
  })();
}
