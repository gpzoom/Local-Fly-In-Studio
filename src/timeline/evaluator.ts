import type { CompiledTimeline, EvaluatedFrame, EvaluatedLayer, TimelineSegment } from '../models/timeline';
import { getEasingFunction } from './easing';
import { interpolateCameraState } from './cameraInterpolation';
import type { VisualTransform } from '../models/scenes';

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function interpolateTransform(from: VisualTransform, to: VisualTransform, t: number): VisualTransform {
  return {
    centerX: from.centerX + (to.centerX - from.centerX) * t,
    centerY: from.centerY + (to.centerY - from.centerY) * t,
    scale: from.scale + (to.scale - from.scale) * t,
    rotation: (from.rotation ?? 0) + ((to.rotation ?? 0) - (from.rotation ?? 0)) * t,
  };
}

function evaluateSegmentLayer(segment: TimelineSegment, timeMs: number): EvaluatedLayer {
  const localTimeMs = timeMs - segment.startMs;
  const durationMs = segment.endMs - segment.startMs;
  const rawT = durationMs > 0 ? clamp(localTimeMs / durationMs, 0, 1) : 0;

  if (segment.kind === 'map-hold') {
    const camera = segment.fromWaypoint?.type === 'absolute' ? segment.fromWaypoint.camera : undefined;
    return {
      segmentId: segment.id,
      sourceType: 'map',
      sourceId: segment.sourceId,
      kind: segment.kind,
      localTimeMs,
      opacity: 1,
      camera,
    };
  }

  if (segment.kind === 'map-travel') {
    const from = segment.fromWaypoint!;
    const to = segment.toWaypoint!;
    const eased = getEasingFunction(to.easing)(rawT);
    const camera =
      from.type === 'absolute' && to.type === 'absolute'
        ? interpolateCameraState(from.camera, to.camera, eased)
        : undefined;
    return {
      segmentId: segment.id,
      sourceType: 'map',
      sourceId: segment.sourceId,
      kind: segment.kind,
      localTimeMs,
      opacity: 1,
      camera,
    };
  }

  if (segment.kind === 'storefront' || segment.kind === 'photo') {
    const transform =
      segment.startTransform && segment.endTransform
        ? interpolateTransform(segment.startTransform, segment.endTransform, rawT)
        : segment.startTransform;
    return {
      segmentId: segment.id,
      sourceType: segment.sourceType,
      sourceId: segment.sourceId,
      kind: segment.kind,
      localTimeMs,
      opacity: 1,
      transform,
    };
  }

  if (segment.kind === 'video') {
    const videoLocalMs = (segment.trimStartMs ?? 0) + localTimeMs * (segment.playbackRate ?? 1);
    return {
      segmentId: segment.id,
      sourceType: 'video',
      sourceId: segment.sourceId,
      kind: segment.kind,
      localTimeMs: videoLocalMs,
      opacity: 1,
      fitMode: segment.fitMode,
      audioEnabled: segment.audioEnabled,
    };
  }

  return {
    segmentId: segment.id,
    sourceType: 'image',
    sourceId: '__black__',
    kind: segment.kind,
    localTimeMs,
    opacity: 1,
  };
}

function isActiveAt(segment: TimelineSegment, timeMs: number, totalDurationMs: number): boolean {
  if (timeMs < segment.startMs) return false;
  if (timeMs < segment.endMs) return true;
  return timeMs === segment.endMs && segment.endMs === totalDurationMs;
}

export function evaluateProjectTimeline(timeline: CompiledTimeline, timeMs: number): EvaluatedFrame {
  const clampedTimeMs = clamp(timeMs, 0, timeline.totalDurationMs);
  const activeSegments = timeline.segments
    .filter((s) => isActiveAt(s, clampedTimeMs, timeline.totalDurationMs))
    .sort((a, b) => a.startMs - b.startMs);

  if (activeSegments.length === 0) {
    return { projectTimeMs: clampedTimeMs, layers: [], activeSectionId: timeline.sections[0]?.id ?? '' };
  }

  const layers: EvaluatedLayer[] = activeSegments.map((segment) => evaluateSegmentLayer(segment, clampedTimeMs));

  if (activeSegments.length === 2) {
    const [outgoing, incoming] = activeSegments;
    const overlapStart = incoming.startMs;
    const overlapEnd = outgoing.endMs;
    const overlapDurationMs = overlapEnd - overlapStart;
    const overlapT = overlapDurationMs > 0 ? clamp((clampedTimeMs - overlapStart) / overlapDurationMs, 0, 1) : 1;
    layers[0].opacity = 1 - overlapT;
    layers[1].opacity = overlapT;
  }

  const primary = activeSegments[activeSegments.length - 1];
  return {
    projectTimeMs: clampedTimeMs,
    layers,
    activeSectionId: primary.sectionId,
    activeItemId: primary.itemId,
  };
}
