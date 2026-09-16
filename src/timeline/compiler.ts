import type { Project } from '../models/project';
import type {
  MapScene,
  StorefrontScene,
  InteriorTourScene,
  InteriorTourItem,
  Waypoint,
  Transition,
} from '../models/scenes';
import type { TimelineSegment, CompiledTimeline, CompiledTimelineSection, SegmentKind } from '../models/timeline';

interface PendingUnit {
  sectionId: string;
  itemId?: string;
  kind: SegmentKind;
  sourceType: 'map' | 'image' | 'video';
  sourceId: string;
  durationMs: number;
  incomingTransition?: Transition;
  fromWaypoint?: Waypoint;
  toWaypoint?: Waypoint;
  startTransform?: TimelineSegment['startTransform'];
  endTransform?: TimelineSegment['endTransform'];
  motionPreset?: TimelineSegment['motionPreset'];
  trimStartMs?: number;
  trimEndMs?: number;
  playbackRate?: number;
  fitMode?: TimelineSegment['fitMode'];
  audioEnabled?: boolean;
}

function videoEffectiveDurationMs(item: Extract<InteriorTourItem, { type: 'video' }>): number {
  return (item.trimEndMs - item.trimStartMs) / item.playbackRate;
}

function buildMapUnits(scene: MapScene): PendingUnit[] {
  const units: PendingUnit[] = [];
  scene.waypoints.forEach((waypoint, index) => {
    if (index > 0) {
      const prev = scene.waypoints[index - 1];
      units.push({
        sectionId: scene.id,
        kind: 'map-travel',
        sourceType: 'map',
        sourceId: 'map',
        durationMs: waypoint.travelDurationMs,
        fromWaypoint: prev,
        toWaypoint: waypoint,
      });
    }
    units.push({
      sectionId: scene.id,
      kind: 'map-hold',
      sourceType: 'map',
      sourceId: 'map',
      durationMs: waypoint.holdDurationMs,
      fromWaypoint: waypoint,
    });
  });
  return units;
}

function buildStorefrontUnits(scene: StorefrontScene): PendingUnit[] {
  return [{
    sectionId: scene.id,
    kind: 'storefront',
    sourceType: 'image',
    sourceId: scene.assetId,
    durationMs: scene.durationMs,
    incomingTransition: scene.transitionIn,
    startTransform: scene.startTransform,
    endTransform: scene.endTransform,
    motionPreset: scene.motionPreset,
  }];
}

function buildInteriorTourUnits(scene: InteriorTourScene, incomingTransition: Transition | undefined): PendingUnit[] {
  return scene.items.map((item, index) => {
    const transitionIn = index === 0 ? incomingTransition : scene.items[index - 1].transitionToNext;
    if (item.type === 'photo') {
      return {
        sectionId: scene.id,
        itemId: item.id,
        kind: 'photo' as const,
        sourceType: 'image' as const,
        sourceId: item.assetId,
        durationMs: item.durationMs,
        incomingTransition: transitionIn,
        startTransform: item.startTransform,
        endTransform: item.endTransform,
        motionPreset: item.motionPreset,
      };
    }
    return {
      sectionId: scene.id,
      itemId: item.id,
      kind: 'video' as const,
      sourceType: 'video' as const,
      sourceId: item.assetId,
      durationMs: videoEffectiveDurationMs(item),
      incomingTransition: transitionIn,
      trimStartMs: item.trimStartMs,
      trimEndMs: item.trimEndMs,
      playbackRate: item.playbackRate,
      fitMode: item.fitMode,
      audioEnabled: item.audioEnabled,
    };
  });
}

export function compileProjectTimeline(project: Project): CompiledTimeline {
  const mapScene = project.scenes.find((s): s is MapScene => s.type === 'map');
  const storefrontScene = project.scenes.find((s): s is StorefrontScene => s.type === 'storefront');
  const interiorScene = project.scenes.find((s): s is InteriorTourScene => s.type === 'interior-tour');

  const units: PendingUnit[] = [];
  if (mapScene) units.push(...buildMapUnits(mapScene));
  if (storefrontScene) units.push(...buildStorefrontUnits(storefrontScene));
  if (interiorScene) units.push(...buildInteriorTourUnits(interiorScene, storefrontScene?.transitionOut));

  const segments: TimelineSegment[] = [];
  let cursorMs = 0;
  let segmentCounter = 0;

  for (const unit of units) {
    const transition = unit.incomingTransition;
    // A transition only means something when there is a preceding segment to fade from or
    // overlap with. The very first segment emitted in the whole timeline has nothing before
    // it, so it never gets a fade-black lead-in and never gets crossfade overlap applied —
    // otherwise its startMs would go negative and its leading content would be unreachable.
    const hasPrecedingSegment = segments.length > 0;

    if (hasPrecedingSegment && transition?.type === 'fade-black' && transition.durationMs > 0) {
      segments.push({
        id: `black-${segmentCounter++}`,
        sourceType: 'image',
        sourceId: '__black__',
        sectionId: unit.sectionId,
        kind: 'black',
        startMs: cursorMs,
        endMs: cursorMs + transition.durationMs,
      });
      cursorMs += transition.durationMs;
    }

    const overlapMs = hasPrecedingSegment && transition?.type === 'crossfade' ? transition.durationMs : 0;
    const startMs = cursorMs - overlapMs;
    const endMs = startMs + unit.durationMs;

    segments.push({
      id: `seg-${segmentCounter++}`,
      sourceType: unit.sourceType,
      sourceId: unit.sourceId,
      sectionId: unit.sectionId,
      itemId: unit.itemId,
      kind: unit.kind,
      startMs,
      endMs,
      transitionIn: unit.incomingTransition,
      fromWaypoint: unit.fromWaypoint,
      toWaypoint: unit.toWaypoint,
      startTransform: unit.startTransform,
      endTransform: unit.endTransform,
      motionPreset: unit.motionPreset,
      trimStartMs: unit.trimStartMs,
      trimEndMs: unit.trimEndMs,
      playbackRate: unit.playbackRate,
      fitMode: unit.fitMode,
      audioEnabled: unit.audioEnabled,
    });

    cursorMs = endMs;
  }

  // CompiledTimeline.segments is documented as sorted by startMs. A crossfade whose duration
  // exceeds the incoming unit's own duration can emit segments out of order, so enforce it.
  segments.sort((a, b) => a.startMs - b.startMs);

  const sections: CompiledTimelineSection[] = [];
  for (const scene of [mapScene, storefrontScene, interiorScene]) {
    if (!scene) continue;
    const sceneSegments = segments.filter((s) => s.sectionId === scene.id);
    if (sceneSegments.length === 0) continue;
    sections.push({
      id: scene.id,
      type: scene.type,
      startMs: Math.min(...sceneSegments.map((s) => s.startMs)),
      endMs: Math.max(...sceneSegments.map((s) => s.endMs)),
    });
  }

  return {
    segments,
    totalDurationMs: Math.max(...segments.map((s) => s.endMs), 0),
    sections,
  };
}
