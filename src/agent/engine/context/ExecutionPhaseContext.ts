import { ExecutionPlan } from "./ExecutionPlan";

export interface ExecutionPhaseContext {
  plan?: ExecutionPlan;
  result?: ExecutionResult;
  extensions?: Record<string, any>;
}

export interface ExecutionResult {
  status: "success" | "failed" | "partial";
  output?: any;
  error?: {
    code?: string;
    message: string;
  };
}
