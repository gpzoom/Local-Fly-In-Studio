import type { CompiledTimeline } from '../models/timeline';

export function findWaypointSegmentStartMs(timeline: CompiledTimeline, waypointId: string): number | undefined {
  const travelSegment = timeline.segments.find(
    (segment) => segment.kind === 'map-travel' && segment.toWaypoint?.id === waypointId,
  );
  if (travelSegment) return travelSegment.startMs;

  const holdSegment = timeline.segments.find(
    (segment) => segment.kind === 'map-hold' && segment.fromWaypoint?.id === waypointId,
  );
  return holdSegment?.startMs;
}
