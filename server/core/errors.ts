export class AppError extends Error {
  constructor(public code: string, message: string, public status = 400) { super(message); this.name = 'AppError'; }
}
export function publicError(error: unknown): string {
  const message = error instanceof Error ? error.message : 'Unexpected operation failure';
  return message.replace(/(?:sk-[\w-]{8,}|AIza[\w-]{12,}|Bearer\s+[^\s"']+)/g, '[redacted]').slice(0, 1200);
}
export function checkSignal(signal: AbortSignal): void {
  if (signal.aborted) throw new AppError('CANCELLED', 'Execution was stopped', 409);
}
