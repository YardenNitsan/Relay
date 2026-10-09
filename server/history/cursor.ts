import { z } from 'zod';
import { AppError } from '../core/errors.js';

const shape = z.object({ v: z.literal(1), scope: z.string().max(600), at: z.string().regex(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d{1,6})?[+-]\d{2}(?::\d{2})?$/), id: z.string().min(1).max(200) }).strict();
export type Position = { at: string; id: string };
export function encodeCursor(scope: string, position: Position): string {
  return Buffer.from(JSON.stringify({ v: 1, scope, ...position })).toString('base64url');
}
export function decodeCursor(value: string | undefined, scope: string): Position | null {
  if (!value) return null;
  try {
    if (value.length > 1600 || !/^[\w-]+$/.test(value)) throw new Error();
    const decoded = shape.parse(JSON.parse(Buffer.from(value, 'base64url').toString('utf8')));
    if (decoded.scope !== scope || !Number.isFinite(Date.parse(decoded.at))) throw new Error();
    const [year, month, day] = decoded.at.slice(0, 10).split('-').map(Number);
    if (year < 1 || month < 1 || month > 12 || day < 1 || day > new Date(Date.UTC(year, month, 0)).getUTCDate()) throw new Error();
    return { at: decoded.at, id: decoded.id };
  } catch { throw new AppError('INVALID_CURSOR', 'This history cursor is invalid or belongs to a different view.', 400); }
}
