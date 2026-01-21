import { Agent } from "@voltagent/core";

export const createRoutingAgent = (
  model: ConstructorParameters<typeof Agent>[0]["model"]
) =>
  new Agent({
    name: "RoutingAgent",
    instructions:
      "You are a routing agent. Choose the best workflow id for the user request.",
    model,
    temperature: 0,
  });
