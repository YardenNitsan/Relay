import { describe, expect, it } from 'vitest';
import { mergeEvents, mergeText } from './realtime-state';
import type { ActivityEvent } from '../shared/types';

const event = (id: number): ActivityEvent => ({ id, taskId: 'task-a', type: 'TOOL_STARTED', data: {}, createdAt: new Date(0).toISOString() });

describe('realtime replay state', () => {
  it('deduplicates overlapping replay without losing event order', () => {
    expect(mergeEvents([event(2), event(3)], [event(1), event(3), event(4)]).map(item => item.id)).toEqual([1, 2, 3, 4]);
  });
  it('bounds the in-memory event window, keeping newest events', () => {
    expect(mergeEvents([event(1), event(2)], [event(3), event(4)], 2).map(item => item.id)).toEqual([3, 4]);
  });
  it('bounds streaming text without treating it as authoritative completion', () => {
    expect(mergeText('1234', '56789', 6)).toEqual('123456');
  });
});
