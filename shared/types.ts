import type {ReasoningControls,ReasoningEffort,ReasoningPreference} from './model-controls.js';
import type { AssistantId } from './assistants.js';
export type ProviderId = 'ollama' | 'openai' | 'anthropic' | 'gemini' | 'lmstudio' | 'xai' | 'deepseek';
export type Depth = 'fast' | 'balanced' | 'deep' | 'maximum';
export type AccessMode = 'read_only' | 'supervised' | 'workspace' | 'unrestricted';
export type TaskStatus = 'created' | 'analyzing' | 'planning' | 'executing' | 'verifying' | 'completed' | 'waiting_for_approval' | 'waiting_for_user' | 'failed' | 'replanning' | 'cancelled' | 'paused';
export type AgentRole = 'supervisor' | 'planner' | 'worker' | 'researcher' | 'architect' | 'coder' | 'reviewer' | 'security_reviewer';
export interface Budget { maxElapsedSeconds?: number; maxOutputTokens?: number; maxCalls: number; maxSeconds: number; maxIterations: number; maxCostUsd: number | null; localOnly: boolean; }
export interface RequiredRead { path:string; expectedSha256:string; }
export interface NetworkPolicy { mode:'deny'|'ask'|'allow'; allowedOrigins:string[]; }
export interface TaskOptions { googleWorkspace?: {mail:boolean;calendar:boolean}; reasoning?: ReasoningPreference; efficiency?: 'efficient' | 'standard'; assistantId?: AssistantId; depth: Depth; modelId: string | null; modelSelection?: 'preferred' | 'required'; access: AccessMode; hostAccessConfirmed?: boolean; workspaceId: string | null; contextTokens: number; budget: Budget; cloudPolicy?: 'local_only' | 'allow' | 'ask'; verification?: {requiredReads:RequiredRead[]}; network?:NetworkPolicy; mcpServerIds?:string[]; }
export interface Conversation { id: string; title: string; createdAt: string; updatedAt: string; }
export interface Message { id: string; conversationId: string; taskId: string | null; role: 'user' | 'assistant'; content: string; createdAt: string; }
export interface TaskRecord { id: string; conversationId: string; objective: string; status: TaskStatus; options: TaskOptions; createdAt: string; updatedAt: string; result: string | null; error: string | null; callsUsed: number; stopGeneration: number; }
export interface TaskStep { id: string; taskId: string; role: AgentRole; title: string; dependencies: string[]; status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'; modelId: string | null; output: string | null; }
export interface ActivityEvent { id: number; taskId: string | null; type: string; data: Record<string, unknown>; createdAt: string; }
export interface ConversationDetail { conversation: Conversation; messages: Message[]; tasks: TaskRecord[]; cursor: number; }
export interface ModelProfile {
  reasoning?:ReasoningControls;
  id: string; name: string; provider: ProviderId; runtime: string; local: boolean;
  capabilities: { tools: boolean; vision: boolean; reasoning: boolean; structured: boolean };
  contextWindow: number | null; quantization: string | null; sizeBytes: number | null;
  state: 'available' | 'ready' | 'generating' | 'offline' | 'error';
  details: Record<string, unknown>; tokensPerSecond: number | null;
  inputPricePerMillion: number | null; outputPricePerMillion: number | null;
}
export interface ProviderStatus { id: ProviderId; name: string; connected: boolean; configured: boolean; error: string | null; secretStorage?: string; enabled?: boolean; authenticated?: boolean | null; reachable?: boolean; state?: 'ready' | 'unconfigured' | 'unreachable' | 'unauthorized' | 'rate_limited' | 'disabled' | 'error'; lastCheckedAt?: string; }
export interface HardwareSnapshot {
  sampledAt: string; platform: string; architecture: string; memoryArchitecture?: 'discrete' | 'unified' | 'cpu' | 'unknown';
  cpu: { name: string; physicalCores: number; logicalCores: number; utilization: number | null };
  memory: { totalBytes: number; availableBytes: number; swapTotalBytes: number | null; swapUsedBytes: number | null };
  gpus: { vendor: string; name: string; totalBytes: number | null; usedBytes: number | null; utilization: number | null; temperature: number | null; driver: string | null; memoryShared?: boolean }[];
  storage: { totalBytes: number; availableBytes: number } | null;
  warnings: string[];
}
export interface Admission { allowed: boolean; decision: 'run' | 'queue' | 'reduce_context' | 'alternative'; reasons: string[]; estimatedRamBytes: number | null; estimatedVramBytes: number | null; contextTokens: number; confidence: 'estimated' | 'measured' | 'unknown'; execution?: { numGpu: number; lmstudio?: { gpuOffload: number } }; }
export interface ToolDefinition { name: string; description: string; parameters: Record<string, unknown>; }
export interface ToolRequest { id: string; name: string; arguments: Record<string, unknown>; }
export interface ModelMessage { role: 'system' | 'user' | 'assistant' | 'tool'; content: string; toolCalls?: ToolRequest[]; toolCallId?: string; providerData?: { provider: ProviderId; data: unknown }; }
/** Host-owned observation sink; never serialized into provider request bodies. */
export interface ModelTiming {firstContentMs?:number;loadWallMs?:number;cleanupWallMs?:number;streamWallMs?:number;}
export interface ModelRequest { timing?:ModelTiming; reasoning?:ReasoningEffort; model: ModelProfile; messages: ModelMessage[]; tools: ToolDefinition[]; contextTokens: number; maxOutputTokens: number; signal: AbortSignal; execution?: { numGpu: number; lmstudio?: { gpuOffload: number } }; }
export type ModelChunk = { type: 'text'; text: string } | { type: 'tool_call'; call: ToolRequest } | { type: 'usage'; inputTokens: number; outputTokens: number; durationMs?: number; loadDurationMs?:number; cachedInputTokens?:number; generationTokensPerSecond?: number; promptTokensPerSecond?: number } | { type: 'continuation'; providerData: { provider: ProviderId; data: unknown } } | { type: 'done'; finishReason: string };
export interface ProviderGateway { forUser?(userId: string): Promise<ProviderGateway>; listModels(): Promise<ModelProfile[]>; statuses(): Promise<ProviderStatus[]>; stream(request: ModelRequest): AsyncIterable<ModelChunk>; }
export interface Workspace { ownerUserId?: string | null; id: string; name: string; sourcePath: string | null; createdAt: string; fileCount: number; }
export interface ToolContext { googleWorkspace?: {mail:boolean;calendar:boolean}; userId?: string; sessionVersion?: number; taskId: string; agentId: string; workspaceId: string | null; access: AccessMode; allowedTools: string[]; signal: AbortSignal; approved: boolean; hostAccess?: boolean; approvalAuthority?:string; network?:NetworkPolicy; mcpServerIds?:string[]; }
export interface ToolResult { content: string; evidence: { kind: string; summary: string; passed: boolean; details?: Record<string, unknown> }[]; artifact?: { name: string; path: string; mime: string }; }
export interface ToolDecision { decision: 'allow' | 'approval' | 'deny'; reason: string; risk: 'read' | 'write' | 'execute'; }
export interface Approval { id: string; taskId: string; toolCallId: string; tool: string; arguments: Record<string, unknown>; reason: string; status: 'pending' | 'allow_once' | 'allow_task' | 'denied'; createdAt: string; }
export interface FileChange { path: string; before: string; after: string; patch: string; checkpointId: string; }
export interface Verification { id: string; taskId: string; kind: string; summary: string; passed: boolean; details: Record<string, unknown>; createdAt: string; }
export interface TaskDetail { task: TaskRecord; steps: TaskStep[]; events: ActivityEvent[]; approvals: Approval[]; verification: Verification[]; changes: FileChange[]; }
export interface SystemStatus { scheduling?: {maxExecutingTasks:number;maxLocalInference:number;approvalWaitUsesSlot:boolean;accountLimitIncludesWaiting:boolean}; stopped: boolean; stopGeneration: number; database: string; sandbox: { available: boolean; reason: string }; version: string; }
