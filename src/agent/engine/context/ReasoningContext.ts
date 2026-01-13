export interface ReasoningContext {
  intent?: string;
  confidence?: number;
  entities?: Record<string, any>;
  notes?: string;
  sources?: Array<{
    type: "rag" | "tool" | "memory";
    name?: string;
  }>;
}
