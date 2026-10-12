import { describe, expect, it } from 'vitest';
import { mergeEvents, mergeText,storedActivityCursor } from './realtime-state';
import type { ActivityEvent } from '../shared/types';

const event = (id: number): ActivityEvent => ({ id, taskId: 'task-a', type: 'TOOL_STARTED', data: {}, createdAt: new Date(0).toISOString() });

describe('realtime replay state', () => {
  it('requires a valid scope and safe cursor and ignores legacy or corrupt storage',()=>{
    const scope='a'.repeat(64);expect(storedActivityCursor(JSON.stringify({scope,cursor:12}))).toEqual({scope,cursor:12});
    for(const value of [null,'12','null','{',JSON.stringify({cursor:12}),JSON.stringify({scope,cursor:-1}),JSON.stringify({scope,cursor:1.2}),JSON.stringify({scope,cursor:Number.MAX_SAFE_INTEGER+1}),JSON.stringify({scope:'wrong',cursor:12})])expect(storedActivityCursor(value)).toBeNull();
  });
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
