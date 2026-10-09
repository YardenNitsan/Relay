import type { Conversation, Message, TaskRecord } from './types.js';

export interface HistoryPage<T> { items: T[]; nextCursor: string | null }
export interface MessagePage { items: Message[]; tasks: TaskRecord[]; olderCursor: string | null; newerCursor: string | null }
export interface HistoryMatch { messageId: string; conversationId: string; conversationTitle: string; taskId: string | null; role: Message['role']; createdAt: string; excerpt: string }
export type ConversationPage = HistoryPage<Conversation>;
export type HistorySearchPage = HistoryPage<HistoryMatch>;
export interface RetrievedHistory {
  messageId: string; conversationId: string; role: Message['role']; createdAt: string; excerpt: string;
  source: { kind: 'conversation_message'; messageId: string; conversationId: string; taskId: string | null };
  trust: 'untrusted_history';
}
