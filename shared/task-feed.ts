import type { AssistantId } from './assistants.js';
import type { TaskStatus } from './types.js';

/** Account-owned list data only; full task details require their existing API. */
export interface TaskSummary {
  id: string;
  conversationId: string;
  /** At most 200 Unicode code points, rendered as untrusted plain text. */
  objective: string;
  objectiveTruncated: boolean;
  status: TaskStatus;
  assistantId: AssistantId | null;
  createdAt: string;
  updatedAt: string;
}

export interface TaskFeedPage {
  version: 1;
  items: TaskSummary[];
  nextCursor: string | null;
}
