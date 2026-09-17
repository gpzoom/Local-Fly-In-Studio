import { useUiStore } from '../../store/uiStore';
import { findWaypointSegmentStartMs } from '../../timeline/findWaypointSegmentStartMs';
import type { MapScene } from '../../models/scenes';
import type { CompiledTimeline } from '../../models/timeline';

interface WaypointBlocksProps {
  mapScene: MapScene;
  timeline: CompiledTimeline;
  onSeek: (timeMs: number) => void;
}

export function WaypointBlocks({ mapScene, timeline, onSeek }: WaypointBlocksProps) {
  const select = useUiStore((state) => state.select);
  const selection = useUiStore((state) => state.selection);

  const totalMs = mapScene.waypoints.reduce(
    (sum, wp, i) => sum + (i > 0 ? wp.travelDurationMs : 0) + wp.holdDurationMs,
    0,
  );

  return (
    <div className="waypoint-blocks">
      {mapScene.waypoints.map((waypoint, i) => {
        const durationMs = (i > 0 ? waypoint.travelDurationMs : 0) + waypoint.holdDurationMs;
        const widthPercent = totalMs > 0 ? (durationMs / totalMs) * 100 : 0;
        const isSelected =
          selection?.type === 'waypoint' &&
          selection.sceneId === mapScene.id &&
          selection.waypointId === waypoint.id;

        return (
          <button
            key={waypoint.id}
            type="button"
            className={isSelected ? 'timeline-block timeline-block--selected' : 'timeline-block'}
            style={{ width: `${widthPercent}%` }}
            onClick={() => {
              select({ type: 'waypoint', sceneId: mapScene.id, waypointId: waypoint.id });
              const startMs = findWaypointSegmentStartMs(timeline, waypoint.id);
              if (startMs !== undefined) onSeek(startMs);
            }}
          >
            {waypoint.name}
          </button>
        );
      })}
    </div>
  );
}
