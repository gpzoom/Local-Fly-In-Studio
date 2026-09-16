import { describe, it, expect } from 'vitest';
import type { CompiledTimeline, EvaluatedFrame, TimelineSegment } from '../models/timeline';

describe('timeline model types', () => {
  it('allows constructing a valid TimelineSegment and CompiledTimeline', () => {
    const segment: TimelineSegment = {
      id: 'seg-1',
      sourceType: 'image',
      sourceId: 'asset-1',
      sectionId: 'storefront-1',
      kind: 'storefront',
      startMs: 0,
      endMs: 2500,
      startTransform: { centerX: 0.5, centerY: 0.5, scale: 1 },
      endTransform: { centerX: 0.5, centerY: 0.5, scale: 1.05 },
      motionPreset: 'push-in',
    };
    const timeline: CompiledTimeline = {
      segments: [segment],
      totalDurationMs: 2500,
      sections: [{ id: 'storefront-1', type: 'storefront', startMs: 0, endMs: 2500 }],
    };
    expect(timeline.segments).toHaveLength(1);
    expect(timeline.totalDurationMs).toBe(2500);
  });

  it('allows constructing a valid EvaluatedFrame with two layers', () => {
    const frame: EvaluatedFrame = {
      projectTimeMs: 1000,
      layers: [
        { sourceType: 'image', sourceId: 'a', localTimeMs: 500, opacity: 0.5 },
        { sourceType: 'image', sourceId: 'b', localTimeMs: 0, opacity: 0.5 },
      ],
      activeSectionId: 'interior-1',
    };
    expect(frame.layers).toHaveLength(2);
  });
});
