import type {
  Waypoint,
  CameraState,
  VisualTransform,
  Transition,
  StorefrontMotionPreset,
  PhotoMotionPreset,
  FitMode,
} from './scenes';

export type SegmentKind =
  | 'map-hold'
  | 'map-travel'
  | 'storefront'
  | 'photo'
  | 'video'
  | 'black';

export interface TimelineSegment {
  id: string;
  sourceType: 'map' | 'image' | 'video';
  sourceId: string;
  sectionId: string;
  itemId?: string;
  kind: SegmentKind;
  startMs: number;
  endMs: number;
  transitionIn?: Transition;

  fromWaypoint?: Waypoint;
  toWaypoint?: Waypoint;

  startTransform?: VisualTransform;
  endTransform?: VisualTransform;
  motionPreset?: StorefrontMotionPreset | PhotoMotionPreset;

  trimStartMs?: number;
  trimEndMs?: number;
  playbackRate?: number;
  fitMode?: FitMode;
  audioEnabled?: boolean;
}

export interface CompiledTimelineSection {
  id: string;
  type: 'map' | 'storefront' | 'interior-tour';
  startMs: number;
  endMs: number;
}

export interface CompiledTimeline {
  segments: TimelineSegment[];
  totalDurationMs: number;
  sections: CompiledTimelineSection[];
}

export interface EvaluatedLayer {
  sourceType: 'map' | 'image' | 'video';
  sourceId: string;
  localTimeMs: number;
  opacity: number;
  transform?: VisualTransform;
  camera?: CameraState;
}

export interface EvaluatedFrame {
  projectTimeMs: number;
  layers: EvaluatedLayer[];
  activeSectionId: string;
  activeItemId?: string;
}
