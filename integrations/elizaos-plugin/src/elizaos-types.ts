// Minimal type declarations for @elizaos/core
// These match the ElizaOS plugin interface without requiring the full runtime as a dev dependency.
// When installed in an actual ElizaOS agent, the real @elizaos/core types take precedence.

export interface Memory {
  id?: string;
  userId?: string;
  agentId?: string;
  roomId?: string;
  content: {
    text: string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export interface State {
  [key: string]: unknown;
}

export interface IAgentRuntime {
  getSetting?(key: string): string | undefined;
  [key: string]: unknown;
}

export type HandlerCallback = (response: {
  text: string;
  [key: string]: unknown;
}) => void;

export interface ActionExample {
  user: string;
  content: { text: string; [key: string]: unknown };
}

export interface Action {
  name: string;
  description: string;
  similes: string[];
  examples: ActionExample[][];
  validate: (runtime: IAgentRuntime, message?: Memory) => Promise<boolean>;
  handler: (
    runtime: IAgentRuntime,
    message: Memory,
    state: State | undefined,
    options: Record<string, unknown>,
    callback: HandlerCallback
  ) => Promise<void>;
}

export interface Plugin {
  name: string;
  description: string;
  actions: Action[];
  evaluators: unknown[];
  providers: unknown[];
}
