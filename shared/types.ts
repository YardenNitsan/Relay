export type ProviderId = 'ollama' | 'openai' | 'anthropic' | 'gemini' | 'lmstudio';
export type Depth = 'fast' | 'balanced' | 'deep' | 'maximum';
export type AccessMode = 'read_only' | 'supervised' | 'workspace' | 'unrestricted';
export type TaskStatus = 'created' | 'analyzing' | 'planning' | 'executing' | 'verifying' | 'completed' | 'waiting_for_approval' | 'waiting_for_user' | 'failed' | 'replanning' | 'cancelled' | 'paused';
export type AgentRole = 'supervisor' | 'planner' | 'worker' | 'researcher' | 'architect' | 'coder' | 'reviewer' | 'security_reviewer';
export interface Budget { maxCalls: number; maxSeconds: number; maxIterations: number; maxCostUsd: number | null; localOnly: boolean; }
export interface RequiredRead { path:string; expectedSha256:string; }
export interface TaskOptions { depth: Depth; modelId: string | null; access: AccessMode; workspaceId: string | null; contextTokens: number; budget: Budget; cloudPolicy?: 'local_only' | 'allow' | 'ask'; verification?: {requiredReads:RequiredRead[]}; }
export interface Conversation { id: string; title: string; createdAt: string; updatedAt: string; }
export interface Message { id: string; conversationId: string; taskId: string | null; role: 'user' | 'assistant'; content: string; createdAt: string; }
export interface TaskRecord { id: string; conversationId: string; objective: string; status: TaskStatus; options: TaskOptions; createdAt: string; updatedAt: string; result: string | null; error: string | null; callsUsed: number; stopGeneration: number; }
export interface TaskStep { id: string; taskId: string; role: AgentRole; title: string; dependencies: string[]; status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'; modelId: string | null; output: string | null; }
export interface ActivityEvent { id: number; taskId: string | null; type: string; data: Record<string, unknown>; createdAt: string; }
export interface ConversationDetail { conversation: Conversation; messages: Message[]; tasks: TaskRecord[]; cursor: number; }
export interface ModelProfile {
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
export interface Admission { allowed: boolean; decision: 'run' | 'queue' | 'reduce_context' | 'alternative'; reasons: string[]; estimatedRamBytes: number | null; estimatedVramBytes: number | null; contextTokens: number; confidence: 'estimated' | 'measured' | 'unknown'; execution?: { numGpu: number }; }
export interface ToolDefinition { name: string; description: string; parameters: Record<string, unknown>; }
export interface ToolRequest { id: string; name: string; arguments: Record<string, unknown>; }
export interface ModelMessage { role: 'system' | 'user' | 'assistant' | 'tool'; content: string; toolCalls?: ToolRequest[]; toolCallId?: string; providerData?: { provider: ProviderId; data: unknown }; }
export interface ModelRequest { model: ModelProfile; messages: ModelMessage[]; tools: ToolDefinition[]; contextTokens: number; maxOutputTokens: number; signal: AbortSignal; execution?: { numGpu: number }; }
export type ModelChunk = { type: 'text'; text: string } | { type: 'tool_call'; call: ToolRequest } | { type: 'usage'; inputTokens: number; outputTokens: number; durationMs?: number; generationTokensPerSecond?: number; promptTokensPerSecond?: number } | { type: 'continuation'; providerData: { provider: ProviderId; data: unknown } } | { type: 'done'; finishReason: string };
export interface ProviderGateway { listModels(): Promise<ModelProfile[]>; statuses(): Promise<ProviderStatus[]>; stream(request: ModelRequest): AsyncIterable<ModelChunk>; }
export interface Workspace { id: string; name: string; sourcePath: string | null; createdAt: string; fileCount: number; }
export interface ToolContext { taskId: string; agentId: string; workspaceId: string | null; access: AccessMode; allowedTools: string[]; signal: AbortSignal; approved: boolean; }
export interface ToolResult { content: string; evidence: { kind: string; summary: string; passed: boolean; details?: Record<string, unknown> }[]; artifact?: { name: string; path: string; mime: string }; }
export interface ToolDecision { decision: 'allow' | 'approval' | 'deny'; reason: string; risk: 'read' | 'write' | 'execute'; }
export interface Approval { id: string; taskId: string; toolCallId: string; tool: string; arguments: Record<string, unknown>; reason: string; status: 'pending' | 'allow_once' | 'allow_task' | 'denied'; createdAt: string; }
export interface FileChange { path: string; before: string; after: string; patch: string; checkpointId: string; }
export interface Verification { id: string; taskId: string; kind: string; summary: string; passed: boolean; details: Record<string, unknown>; createdAt: string; }
export interface TaskDetail { task: TaskRecord; steps: TaskStep[]; events: ActivityEvent[]; approvals: Approval[]; verification: Verification[]; changes: FileChange[]; }
export interface SystemStatus { stopped: boolean; stopGeneration: number; database: string; sandbox: { available: boolean; reason: string }; version: string; }
