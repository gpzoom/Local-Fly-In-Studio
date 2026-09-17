import type { CompiledTimeline, EvaluatedFrame } from '../models/timeline';
import { evaluateProjectTimeline } from './evaluator';

export interface PlaybackControllerOptions {
  requestAnimationFrame?: (callback: FrameRequestCallback) => number;
  cancelAnimationFrame?: (handle: number) => void;
  now?: () => number;
}

export type PlaybackListener = (frame: EvaluatedFrame, timeMs: number) => void;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export class PlaybackController {
  private readonly timeline: CompiledTimeline;
  private readonly raf: (callback: FrameRequestCallback) => number;
  private readonly caf: (handle: number) => void;
  private readonly nowFn: () => number;
  private readonly listeners = new Set<PlaybackListener>();
  private playing = false;
  private timeMs = 0;
  private frameHandle: number | null = null;
  private lastTickAt = 0;

  constructor(timeline: CompiledTimeline, options: PlaybackControllerOptions = {}) {
    this.timeline = timeline;
    this.raf =
      options.requestAnimationFrame ??
      (typeof globalThis.requestAnimationFrame !== 'undefined'
        ? (callback: FrameRequestCallback) => globalThis.requestAnimationFrame(callback)
        : () => -1);
    this.caf =
      options.cancelAnimationFrame ??
      (typeof globalThis.cancelAnimationFrame !== 'undefined'
        ? (handle: number) => globalThis.cancelAnimationFrame(handle)
        : () => {});
    this.nowFn =
      options.now ?? (typeof performance !== 'undefined' ? () => performance.now() : () => Date.now());
  }

  get isPlaying(): boolean {
    return this.playing;
  }

  get currentTimeMs(): number {
    return this.timeMs;
  }

  play(): void {
    if (this.playing) return;
    if (this.timeMs >= this.timeline.totalDurationMs) {
      this.timeMs = 0;
    }
    this.playing = true;
    this.lastTickAt = this.nowFn();
    this.frameHandle = this.raf(this.tick);
  }

  pause(): void {
    if (!this.playing) return;
    this.playing = false;
    if (this.frameHandle !== null) {
      this.caf(this.frameHandle);
      this.frameHandle = null;
    }
  }

  seek(timeMs: number): void {
    this.timeMs = clamp(timeMs, 0, this.timeline.totalDurationMs);
    this.notify();
  }

  subscribe(listener: PlaybackListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  destroy(): void {
    if (this.frameHandle !== null) {
      this.caf(this.frameHandle);
      this.frameHandle = null;
    }
    this.playing = false;
    this.listeners.clear();
  }

  private readonly tick = (): void => {
    if (!this.playing) return;
    const currentNow = this.nowFn();
    const deltaMs = currentNow - this.lastTickAt;
    this.lastTickAt = currentNow;
    this.timeMs = clamp(this.timeMs + deltaMs, 0, this.timeline.totalDurationMs);
    this.notify();
    if (this.timeMs >= this.timeline.totalDurationMs) {
      this.pause();
      return;
    }
    this.frameHandle = this.raf(this.tick);
  };

  private notify(): void {
    const frame = evaluateProjectTimeline(this.timeline, this.timeMs);
    for (const listener of this.listeners) {
      listener(frame, this.timeMs);
    }
  }
}
