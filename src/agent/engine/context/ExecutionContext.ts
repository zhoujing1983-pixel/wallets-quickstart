import { CoreContext } from "./CoreContext";
import { DecisionContext } from "./DecisionContext";
import { ReasoningContext } from "./ReasoningContext";
import { ExecutionPhaseContext } from "./ExecutionPhaseContext";

export interface ExecutionContext {
  core: CoreContext;
  decision: DecisionContext;
  reasoning: ReasoningContext;
  execution: ExecutionPhaseContext;
}
