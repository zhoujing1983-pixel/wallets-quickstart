import { Agent, VoltAgent } from "@voltagent/core";
import { honoServer } from "@voltagent/server-hono";
import { createOllama } from "ollama-ai-provider-v2";

const ollamaProvider = createOllama({
  baseURL: "http://localhost:11434/api",
});

const agent = new Agent({
  name: "Finyx WaaS Agent",
  instructions: "You are a helpful assistant for web 3 wallet payments.",
  model: ollamaProvider("llama3.2:1b"),
  // model: ollamaProvider("TinyLlama"),
  
});

new VoltAgent({
  agents: { localAgent: agent },
  server: honoServer({
    port: 3141,
    enableSwaggerUI: true,
  }),
});
