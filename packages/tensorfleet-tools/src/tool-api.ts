/**
 * ToolAPI interface for registering tools in the tensorfleet-tools system
 */

/**
 * Type definition for tool parameters schema
 */
export type ToolParameters = any;

/**
 * Type definition for tool execution result content
 */
export interface ToolExecutionResultContent {
  type: string;
  text: string;
}

/**
 * Type definition for tool execution result
 */
export interface ToolExecutionResult {
  content: ToolExecutionResultContent[];
}

/**
 * Generic tool definition interface with type-safe parameters and return type
 */
export interface ToolDefinition<TParams = any, TResult = ToolExecutionResult> {
  name: string;
  description: string;
  parameters: ToolParameters;
  execute(id: string, params: TParams): Promise<TResult>;
}

/**
 * ToolAPI interface for registering tools
 */
export interface ToolAPI {
  registerTool<TParams = any>(tool: ToolDefinition<TParams>): void;
}